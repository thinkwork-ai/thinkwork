/**
 * Desktop-local eval run preparation and result callback endpoint.
 *
 * POST /api/desktop/eval-runs
 *   Cognito desktop clients create an eval_runs row and receive sidecar work
 *   items plus a short-lived per-run callback token.
 *
 * POST /api/desktop/eval-runs/{runId}/sessions
 *   Cognito desktop clients prepare one Desktop Pi runtime session for a
 *   specific eval case. Session prep is intentionally per-case so full-catalog
 *   runs do not spend the API Lambda timeout preparing every case upfront.
 *
 * POST /api/desktop/eval-runs/{runId}/results
 *   The local sidecar reports one scored case result with the per-run token.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { authenticate, type AuthResult } from "../lib/cognito-auth.js";
import { requireTenantMembership } from "../lib/tenant-membership.js";
import {
  error,
  forbidden,
  handleCors,
  json,
  unauthorized,
} from "../lib/response.js";
import { resolveTenantPlatformAgent } from "../lib/agents/tenant-platform-agent.js";
import { notifyEvalRunUpdate } from "../lib/eval-notify.js";
import {
  prepareLocalPiEvalRuntimeSession,
  type PreparedLocalPiRuntimeSession,
} from "../lib/desktop-runtime/prepare-local-turn.js";

const { evalRuns, evalResults, evalTestCases, spaces, spaceMembers } = schema;

const TOKEN_PREFIX = "dpe_";
const DEFAULT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StartDesktopEvalRunBody {
  tenantId?: string;
  categories?: string[] | null;
  testCaseIds?: string[] | null;
  model?: string | null;
  spaceId?: string | null;
}

export interface DesktopEvalResultBody {
  testCaseId?: string;
  status?: "pass" | "fail" | "error";
  score?: number | null;
  durationMs?: number | null;
  agentSessionId?: string | null;
  input?: string | null;
  expected?: string | null;
  actualOutput?: string | null;
  systemPrompt?: string | null;
  evaluatorResults?: unknown[] | null;
  assertions?: unknown[] | null;
  errorMessage?: string | null;
}

export interface PrepareDesktopEvalSessionBody {
  testCaseId?: string | null;
  spaceId?: string | null;
}

export interface DesktopEvalWorkItem {
  runId: string;
  testCaseId: string;
  index: number;
  name: string;
  category: string;
  query: string;
  systemPrompt: string | null;
  assertions: unknown;
  agentcoreEvaluatorIds: string[];
  tags: string[];
  session?: PreparedLocalPiRuntimeSession;
}

interface DesktopEvalCaseRow {
  id: string;
  name: string;
  category: string;
  query: string;
  system_prompt: string | null;
  assertions: unknown;
  agentcore_evaluator_ids: string[];
  tags: string[];
}

interface DesktopEvalRunRow {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  execution_target: string;
  runtime_host: string;
  status: string;
  categories: string[];
  selected_test_case_ids: string[];
  total_tests: number;
}

interface DesktopEvalSpaceRow {
  id: string;
  slug: string;
}

interface EvalResultSummary {
  completed: number;
  passed: number;
  failed: number;
  passRate: number;
}

export interface DesktopEvalRunsDeps {
  authenticate(
    headers: Record<string, string | undefined>,
  ): Promise<AuthResult | null>;
  requireTenantMember(
    event: APIGatewayProxyEventV2,
    tenantId: string,
  ): Promise<
    | { ok: true; userId: string | null }
    | { ok: false; status: number; reason: string }
  >;
  resolvePlatformAgent(tenantId: string): Promise<{ id: string }>;
  resolveSpace(input: {
    tenantId: string;
    requestedSpaceId?: string | null;
    userId: string | null;
  }): Promise<DesktopEvalSpaceRow>;
  selectCases(input: {
    tenantId: string;
    categories: string[];
    testCaseIds: string[];
  }): Promise<DesktopEvalCaseRow[]>;
  insertRun(input: {
    tenantId: string;
    agentId: string;
    model: string | null;
    categories: string[];
    selectedTestCaseIds: string[];
    totalTests: number;
    now: Date;
  }): Promise<DesktopEvalRunRow>;
  prepareCaseSession(input: {
    auth: AuthResult;
    agentId: string;
    spaceId: string;
    runId: string;
    testCaseId: string;
    query: string;
  }): Promise<PreparedLocalPiRuntimeSession>;
  loadRun(runId: string): Promise<DesktopEvalRunRow | null>;
  loadTestCase(input: {
    tenantId: string;
    testCaseId: string;
  }): Promise<{ id: string; category: string; query: string } | null>;
  insertResultIfMissing(input: {
    run: DesktopEvalRunRow;
    testCase: { id: string; query: string };
    result: RequiredDesktopEvalResult;
  }): Promise<{ inserted: boolean }>;
  summarizeRun(runId: string): Promise<EvalResultSummary>;
  updateRunProgress(input: {
    run: DesktopEvalRunRow;
    summary: EvalResultSummary;
    now: Date;
  }): Promise<void>;
  notifyRunUpdate(input: {
    run: DesktopEvalRunRow;
    summary?: EvalResultSummary;
    status: string;
  }): Promise<void>;
  now(): Date;
  tokenSecret(): string;
}

type RequiredDesktopEvalResult = Required<
  Pick<DesktopEvalResultBody, "testCaseId" | "status">
> &
  Omit<DesktopEvalResultBody, "testCaseId" | "status">;

export interface DesktopEvalRunTokenPayload {
  runId: string;
  expiresAt: number;
  nonce: string;
}

export function signDesktopEvalRunToken(
  payload: DesktopEvalRunTokenPayload,
  secret: string,
): string {
  if (!secret) throw new Error("Desktop eval callback signing secret missing");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  return `${TOKEN_PREFIX}${encodedPayload}.${signature}`;
}

export function verifyDesktopEvalRunToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): DesktopEvalRunTokenPayload | null {
  if (!secret || !token.startsWith(TOKEN_PREFIX)) return null;
  const [encodedPayload, signature] = token
    .slice(TOKEN_PREFIX.length)
    .split(".");
  if (!encodedPayload || !signature) return null;
  const expected = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  if (!safeEqual(signature, expected)) return null;

  let payload: DesktopEvalRunTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as DesktopEvalRunTokenPayload;
  } catch {
    return null;
  }
  if (!UUID_RE.test(payload.runId)) return null;
  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= nowMs) {
    return null;
  }
  if (typeof payload.nonce !== "string" || payload.nonce.length < 8) {
    return null;
  }
  return payload;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function desktopEvalWorkItems(
  runId: string,
  cases: DesktopEvalCaseRow[],
  sessions: Map<string, PreparedLocalPiRuntimeSession> = new Map(),
): DesktopEvalWorkItem[] {
  return cases.map((testCase, index) => {
    const item: DesktopEvalWorkItem = {
      runId,
      testCaseId: testCase.id,
      index,
      name: testCase.name,
      category: testCase.category,
      query: testCase.query,
      systemPrompt: testCase.system_prompt,
      assertions: testCase.assertions,
      agentcoreEvaluatorIds: testCase.agentcore_evaluator_ids ?? [],
      tags: testCase.tags ?? [],
    };
    const session = sessions.get(testCase.id);
    if (session) item.session = session;
    return item;
  });
}

export function createDesktopEvalRunsHandler(
  deps: DesktopEvalRunsDeps = defaultDesktopEvalRunsDeps(),
) {
  return async function desktopEvalRunsHandler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const preflight = handleCors(event);
    if (preflight) return preflight;

    if (event.requestContext.http.method !== "POST") {
      return error("Method not allowed", 405);
    }

    const sessionPathMatch = desktopEvalSessionPath(event);
    const resultPathMatch = desktopEvalResultPath(event);
    try {
      if (sessionPathMatch) {
        return await handlePrepareCaseSession(
          event,
          sessionPathMatch.runId,
          deps,
        );
      }

      if (resultPathMatch) {
        return await handleResultCallback(event, resultPathMatch.runId, deps);
      }

      if (isStartDesktopEvalRunPath(event)) {
        return await handleStartRun(event, deps);
      }
    } catch (err) {
      if (err instanceof SyntaxError || err instanceof InvalidJsonError) {
        return error("Invalid JSON body", 400);
      }
      console.error("[desktop-eval-runs] request failed:", err);
      return json(
        {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: "INTERNAL",
        },
        500,
      );
    }

    return error("Desktop eval route not found", 404);
  };
}

async function handleStartRun(
  event: APIGatewayProxyEventV2,
  deps: DesktopEvalRunsDeps,
): Promise<APIGatewayProxyStructuredResultV2> {
  const auth = await deps.authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth || auth.authType !== "cognito" || !auth.email) {
    return unauthorized("Desktop eval runs require user auth");
  }

  const body = parseJson<StartDesktopEvalRunBody>(event);
  const tenantId = stringValue(body.tenantId);
  if (!tenantId) return error("tenantId is required", 400);

  const membership = await deps.requireTenantMember(event, tenantId);
  if (!membership.ok) {
    if (membership.status === 401) return unauthorized(membership.reason);
    if (membership.status === 403) return forbidden(membership.reason);
    return error(membership.reason, membership.status);
  }

  const categories = stringList(body.categories);
  const testCaseIds = stringList(body.testCaseIds);
  const [agent, space, cases] = await Promise.all([
    deps.resolvePlatformAgent(tenantId),
    deps.resolveSpace({
      tenantId,
      requestedSpaceId: body.spaceId ?? null,
      userId: membership.userId,
    }),
    deps.selectCases({ tenantId, categories, testCaseIds }),
  ]);

  const now = deps.now();
  const run = await deps.insertRun({
    tenantId,
    agentId: agent.id,
    model: stringValue(body.model),
    categories,
    selectedTestCaseIds: testCaseIds,
    totalTests: cases.length,
    now,
  });

  await deps.notifyRunUpdate({ run, status: run.status });

  const expiresAt = now.getTime() + DEFAULT_TOKEN_TTL_MS;
  const token = signDesktopEvalRunToken(
    {
      runId: run.id,
      expiresAt,
      nonce: randomBytes(12).toString("base64url"),
    },
    deps.tokenSecret(),
  );

  return json({
    ok: true,
    run: runPayload(run),
    target: {
      agentId: agent.id,
      spaceId: space.id,
      spaceSlug: space.slug,
      executionTarget: "desktop-pi",
      runtimeHost: "desktop-local",
    },
    resultCallback: {
      url: desktopEvalResultCallbackUrl(event, run.id),
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      authScheme: "bearer",
    },
    workItems: desktopEvalWorkItems(run.id, cases),
  });
}

async function handlePrepareCaseSession(
  event: APIGatewayProxyEventV2,
  runId: string,
  deps: DesktopEvalRunsDeps,
): Promise<APIGatewayProxyStructuredResultV2> {
  const auth = await deps.authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth || auth.authType !== "cognito" || !auth.email) {
    return unauthorized("Desktop eval sessions require user auth");
  }

  const body = parseJson<PrepareDesktopEvalSessionBody>(event);
  const testCaseId = stringValue(body.testCaseId);
  if (!testCaseId || !UUID_RE.test(testCaseId)) {
    return error("testCaseId is required", 400);
  }

  const run = await deps.loadRun(runId);
  if (!run) return error("Eval run not found", 404);
  if (
    run.execution_target !== "desktop-pi" ||
    run.runtime_host !== "desktop-local"
  ) {
    return forbidden(
      "Eval session preparation is only valid for Desktop Pi runs",
    );
  }
  if (["completed", "failed", "cancelled"].includes(run.status)) {
    return error("Eval run is no longer running", 409);
  }
  if (!run.agent_id) {
    return error("Eval run is missing its target agent", 409);
  }

  const membership = await deps.requireTenantMember(event, run.tenant_id);
  if (!membership.ok) {
    if (membership.status === 401) return unauthorized(membership.reason);
    if (membership.status === 403) return forbidden(membership.reason);
    return error(membership.reason, membership.status);
  }

  const [space, testCase] = await Promise.all([
    deps.resolveSpace({
      tenantId: run.tenant_id,
      requestedSpaceId: body.spaceId ?? null,
      userId: membership.userId,
    }),
    deps.loadTestCase({ tenantId: run.tenant_id, testCaseId }),
  ]);
  if (!testCase) return error("Eval test case not found", 404);
  if (!isTestCaseSelectedForRun(run, testCase)) {
    return forbidden("Eval test case is not part of this run");
  }

  const session = await deps.prepareCaseSession({
    auth,
    agentId: run.agent_id,
    spaceId: space.id,
    runId,
    testCaseId,
    query: testCase.query,
  });

  return json({ ok: true, session });
}

async function handleResultCallback(
  event: APIGatewayProxyEventV2,
  runId: string,
  deps: DesktopEvalRunsDeps,
): Promise<APIGatewayProxyStructuredResultV2> {
  const token = bearerToken(event.headers);
  if (!token) return unauthorized("Missing callback token");
  const tokenPayload = verifyDesktopEvalRunToken(
    token,
    deps.tokenSecret(),
    deps.now().getTime(),
  );
  if (!tokenPayload || tokenPayload.runId !== runId) {
    return unauthorized("Invalid callback token");
  }

  const result = normalizeResultBody(parseJson<DesktopEvalResultBody>(event));
  if (!result.ok) return error(result.reason, 400);

  const run = await deps.loadRun(runId);
  if (!run) return error("Eval run not found", 404);
  if (run.execution_target !== "desktop-pi") {
    return forbidden("Callback token is only valid for Desktop Pi eval runs");
  }
  if (["completed", "failed", "cancelled"].includes(run.status)) {
    return json({ ok: true, idempotent: true, run: runPayload(run) });
  }

  const testCase = await deps.loadTestCase({
    tenantId: run.tenant_id,
    testCaseId: result.value.testCaseId,
  });
  if (!testCase) return error("Eval test case not found", 404);

  const insert = await deps.insertResultIfMissing({
    run,
    testCase,
    result: result.value,
  });
  const summary = await deps.summarizeRun(runId);
  await deps.updateRunProgress({ run, summary, now: deps.now() });
  await deps.notifyRunUpdate({
    run,
    summary,
    status: summary.completed >= run.total_tests ? "completed" : "running",
  });

  return json({
    ok: true,
    idempotent: !insert.inserted,
    completed: summary.completed,
    totalTests: run.total_tests,
  });
}

function defaultDesktopEvalRunsDeps(): DesktopEvalRunsDeps {
  return {
    authenticate,
    async requireTenantMember(event, tenantId) {
      const verdict = await requireTenantMembership(event, tenantId, {
        requiredRoles: ["owner", "admin", "member"],
      });
      return verdict.ok
        ? { ok: true, userId: verdict.userId }
        : {
            ok: false,
            status: verdict.status,
            reason: verdict.reason,
          };
    },
    async resolvePlatformAgent(tenantId) {
      const agent = await resolveTenantPlatformAgent(tenantId);
      return { id: agent.id };
    },
    async resolveSpace(input) {
      return resolveDesktopEvalSpace(input);
    },
    async selectCases(input) {
      const conditions = [
        eq(evalTestCases.tenant_id, input.tenantId),
        eq(evalTestCases.enabled, true),
      ];
      if (input.testCaseIds.length > 0) {
        conditions.push(inArray(evalTestCases.id, input.testCaseIds));
      } else if (input.categories.length > 0) {
        conditions.push(inArray(evalTestCases.category, input.categories));
      }

      return db
        .select({
          id: evalTestCases.id,
          name: evalTestCases.name,
          category: evalTestCases.category,
          query: evalTestCases.query,
          system_prompt: evalTestCases.system_prompt,
          assertions: evalTestCases.assertions,
          agentcore_evaluator_ids: evalTestCases.agentcore_evaluator_ids,
          tags: evalTestCases.tags,
        })
        .from(evalTestCases)
        .where(and(...conditions))
        .orderBy(asc(evalTestCases.category), asc(evalTestCases.name));
    },
    async insertRun(input) {
      const terminal = input.totalTests === 0;
      const [run] = await db
        .insert(evalRuns)
        .values({
          tenant_id: input.tenantId,
          agent_id: input.agentId,
          computer_id: null,
          execution_target: "desktop-pi",
          runtime_host: "desktop-local",
          status: terminal ? "completed" : "running",
          model: input.model,
          categories: input.categories,
          selected_test_case_ids: input.selectedTestCaseIds,
          total_tests: input.totalTests,
          passed: 0,
          failed: 0,
          pass_rate: terminal ? "0.0000" : null,
          cost_usd: "0.000000",
          started_at: input.now,
          completed_at: terminal ? input.now : null,
        })
        .returning();
      if (!run) throw new Error("Failed to create desktop eval run");
      return run;
    },
    async prepareCaseSession(input) {
      return prepareLocalPiEvalRuntimeSession({
        auth: input.auth,
        agentId: input.agentId,
        spaceId: input.spaceId,
        evalRunId: input.runId,
        testCaseId: input.testCaseId,
        userMessage: input.query,
      });
    },
    async loadRun(runId) {
      const [run] = await db
        .select()
        .from(evalRuns)
        .where(eq(evalRuns.id, runId));
      return run ?? null;
    },
    async loadTestCase(input) {
      const [testCase] = await db
        .select({
          id: evalTestCases.id,
          category: evalTestCases.category,
          query: evalTestCases.query,
        })
        .from(evalTestCases)
        .where(
          and(
            eq(evalTestCases.id, input.testCaseId),
            eq(evalTestCases.tenant_id, input.tenantId),
            eq(evalTestCases.enabled, true),
          ),
        );
      return testCase ?? null;
    },
    async insertResultIfMissing(input) {
      return insertDesktopEvalResultIfMissing(input);
    },
    async summarizeRun(runId) {
      const rows = await db
        .select({ status: evalResults.status })
        .from(evalResults)
        .where(eq(evalResults.run_id, runId));
      const passed = rows.filter((row) => row.status === "pass").length;
      const failed = rows.length - passed;
      return {
        completed: rows.length,
        passed,
        failed,
        passRate: rows.length > 0 ? passed / rows.length : 0,
      };
    },
    async updateRunProgress(input) {
      const isComplete = input.summary.completed >= input.run.total_tests;
      await db
        .update(evalRuns)
        .set({
          status: isComplete ? "completed" : "running",
          completed_at: isComplete ? input.now : null,
          passed: input.summary.passed,
          failed: input.summary.failed,
          pass_rate: input.summary.passRate.toFixed(4),
          cost_usd: "0.000000",
        })
        .where(
          and(eq(evalRuns.id, input.run.id), eq(evalRuns.status, "running")),
        );
    },
    async notifyRunUpdate(input) {
      await notifyEvalRunUpdate({
        runId: input.run.id,
        tenantId: input.run.tenant_id,
        agentId: input.run.agent_id,
        status: input.status,
        totalTests: input.run.total_tests,
        passed: input.summary?.passed,
        failed: input.summary?.failed,
        passRate: input.summary?.passRate,
      });
    },
    now: () => new Date(),
    tokenSecret: () =>
      process.env.API_AUTH_SECRET || process.env.THINKWORK_API_SECRET || "",
  };
}

async function resolveDesktopEvalSpace(input: {
  tenantId: string;
  requestedSpaceId?: string | null;
  userId: string | null;
}): Promise<DesktopEvalSpaceRow> {
  const baseConditions = [
    eq(spaces.tenant_id, input.tenantId),
    eq(spaces.status, "active"),
  ];
  if (input.requestedSpaceId) {
    baseConditions.push(eq(spaces.id, input.requestedSpaceId));
  }

  const [space] = await db
    .select({
      id: spaces.id,
      slug: spaces.slug,
      accessMode: spaces.access_mode,
    })
    .from(spaces)
    .where(and(...baseConditions))
    .orderBy(
      sql`CASE WHEN ${spaces.slug} = 'default' THEN 0 ELSE 1 END`,
      asc(spaces.created_at),
    )
    .limit(1);
  if (!space) throw new Error("No active Space is available for desktop evals");

  if (space.accessMode === "private" && input.userId) {
    const [membership] = await db
      .select({ id: spaceMembers.id })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.tenant_id, input.tenantId),
          eq(spaceMembers.space_id, space.id),
          eq(spaceMembers.user_id, input.userId),
        ),
      )
      .limit(1);
    if (!membership) {
      throw new Error("Caller does not have access to the requested Space");
    }
  }

  return { id: space.id, slug: space.slug };
}

async function insertDesktopEvalResultIfMissing(input: {
  run: DesktopEvalRunRow;
  testCase: { id: string; query: string };
  result: RequiredDesktopEvalResult;
}): Promise<{ inserted: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtext(${input.run.id}),
        hashtext(${input.testCase.id})
      )
    `);
    const [duplicate] = await tx
      .select({ id: evalResults.id })
      .from(evalResults)
      .where(
        and(
          eq(evalResults.run_id, input.run.id),
          eq(evalResults.test_case_id, input.testCase.id),
        ),
      );
    if (duplicate) return { inserted: false };

    await tx.insert(evalResults).values({
      run_id: input.run.id,
      test_case_id: input.testCase.id,
      status: input.result.status,
      score:
        typeof input.result.score === "number"
          ? input.result.score.toFixed(4)
          : null,
      duration_ms:
        typeof input.result.durationMs === "number"
          ? Math.max(0, Math.floor(input.result.durationMs))
          : null,
      agent_session_id: input.result.agentSessionId ?? null,
      input: input.result.input ?? input.testCase.query,
      expected: input.result.expected ?? null,
      actual_output: input.result.actualOutput ?? null,
      system_prompt: input.result.systemPrompt ?? null,
      evaluator_results: input.result.evaluatorResults ?? [],
      assertions: input.result.assertions ?? [],
      error_message: input.result.errorMessage ?? null,
    });
    return { inserted: true };
  });
}

function isTestCaseSelectedForRun(
  run: DesktopEvalRunRow,
  testCase: { id: string; category: string },
): boolean {
  if (run.selected_test_case_ids.length > 0) {
    return run.selected_test_case_ids.includes(testCase.id);
  }
  if (run.categories.length > 0) {
    return run.categories.includes(testCase.category);
  }
  return true;
}

function normalizeResultBody(
  body: DesktopEvalResultBody,
):
  | { ok: true; value: RequiredDesktopEvalResult }
  | { ok: false; reason: string } {
  const testCaseId = stringValue(body.testCaseId);
  if (!testCaseId || !UUID_RE.test(testCaseId)) {
    return { ok: false, reason: "testCaseId is required" };
  }
  if (!["pass", "fail", "error"].includes(String(body.status))) {
    return { ok: false, reason: "status must be pass, fail, or error" };
  }
  if (
    body.score !== undefined &&
    body.score !== null &&
    (!Number.isFinite(body.score) || body.score < 0 || body.score > 1)
  ) {
    return { ok: false, reason: "score must be between 0 and 1" };
  }
  return {
    ok: true,
    value: {
      testCaseId,
      status: body.status as "pass" | "fail" | "error",
      score: body.score ?? null,
      durationMs: body.durationMs ?? null,
      agentSessionId: body.agentSessionId ?? null,
      input: body.input ?? null,
      expected: body.expected ?? null,
      actualOutput: body.actualOutput ?? null,
      systemPrompt: body.systemPrompt ?? null,
      evaluatorResults: Array.isArray(body.evaluatorResults)
        ? body.evaluatorResults
        : [],
      assertions: Array.isArray(body.assertions) ? body.assertions : [],
      errorMessage: body.errorMessage ?? null,
    },
  };
}

class InvalidJsonError extends Error {}

function parseJson<T>(event: APIGatewayProxyEventV2): T {
  try {
    return JSON.parse(event.body || "{}") as T;
  } catch {
    throw new InvalidJsonError("Invalid JSON body");
  }
}

function isStartDesktopEvalRunPath(event: APIGatewayProxyEventV2): boolean {
  return event.rawPath === "/api/desktop/eval-runs";
}

function desktopEvalSessionPath(
  event: APIGatewayProxyEventV2,
): { runId: string } | null {
  if (!event.rawPath.endsWith("/sessions")) return null;
  const runId = event.pathParameters?.runId;
  if (runId && UUID_RE.test(runId)) return { runId };
  const match = event.rawPath.match(
    /^\/api\/desktop\/eval-runs\/([0-9a-f-]{36})\/sessions$/i,
  );
  return match ? { runId: match[1]! } : null;
}

function desktopEvalResultPath(
  event: APIGatewayProxyEventV2,
): { runId: string } | null {
  if (!event.rawPath.endsWith("/results")) return null;
  const runId = event.pathParameters?.runId;
  if (runId && UUID_RE.test(runId)) return { runId };
  const match = event.rawPath.match(
    /^\/api\/desktop\/eval-runs\/([0-9a-f-]{36})\/results$/i,
  );
  return match ? { runId: match[1]! } : null;
}

function desktopEvalResultCallbackUrl(
  event: APIGatewayProxyEventV2,
  runId: string,
): string {
  const baseUrl =
    process.env.THINKWORK_API_URL ||
    (event.requestContext.domainName
      ? `https://${event.requestContext.domainName}`
      : "");
  return `${baseUrl}/api/desktop/eval-runs/${runId}/results`;
}

function bearerToken(
  headers: APIGatewayProxyEventV2["headers"],
): string | null {
  const auth = headers.authorization || headers.Authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => stringValue(item))
        .filter((item): item is string => item !== ""),
    ),
  ];
}

function runPayload(run: DesktopEvalRunRow) {
  return {
    id: run.id,
    tenantId: run.tenant_id,
    agentId: run.agent_id,
    status: run.status,
    executionTarget: run.execution_target,
    runtimeHost: run.runtime_host,
    totalTests: run.total_tests,
  };
}

export const handler = createDesktopEvalRunsHandler();
