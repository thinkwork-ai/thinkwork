/**
 * Exact-user AgentCore Gateway target for ThinkWork-owned platform tools.
 *
 * Brain is a bounded read-only query. Email is a governed side effect: the
 * target claims a deterministic per-turn idempotency key before invoking the
 * existing email policy/approval path, so a retry can never send twice.
 */

import { createHash } from "node:crypto";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  harnessGovernedToolExecutions,
  harnessParticipantSessions,
} from "@thinkwork/database-pg/schema";
import {
  verifyProofProviderAccessToken,
  type AccessTokenClaims,
} from "@thinkwork/lambda/agentcore-proof-oauth-provider";
import {
  resolveHarnessCapabilityContext,
  type HarnessCapabilityClaims,
  type HarnessCapabilityContext,
} from "./harness-capability-mcp.js";
import { sendDirectRoutineEmail } from "./email-send.js";
import { getContextEngineService } from "../lib/context-engine/service.js";
import type { ContextEngineResponse } from "../lib/context-engine/types.js";
import { toolPolicyAliases } from "../lib/builtin-tool-policy-aliases.js";
import { validateTemplateContextEngine } from "../lib/templates/context-engine-config.js";
import { validateTemplateSendEmail } from "../lib/templates/send-email-config.js";
import {
  appendToolExecutionStarted,
  appendToolExecutionTerminal,
  drizzleToolExecutionLedgerStore,
  type ToolExecutionCorrelation,
  type ToolExecutionLedgerStore,
} from "../lib/harness/tool-execution-ledger.js";

const BRAIN_PATH = "/agentcore/capabilities/brain/query";
const EMAIL_PATH = "/agentcore/capabilities/email/send";
const MAX_BODY_BYTES = 80 * 1024;
const MAX_QUERY_CHARS = 2_000;
const MAX_EMAIL_SUBJECT_CHARS = 500;
const MAX_EMAIL_BODY_CHARS = 60_000;

interface BrainBody {
  tenant_id?: unknown;
  query?: unknown;
  mode?: unknown;
  limit?: unknown;
}

interface EmailBody {
  tenant_id?: unknown;
  to?: unknown;
  subject?: unknown;
  content?: unknown;
  body?: unknown;
}

interface PlatformAccess {
  brain: boolean;
  email: boolean;
}

type EmailClaim =
  | { state: "claimed" }
  | { state: "replay"; result: Record<string, unknown> }
  | { state: "in_progress" | "failed" | "ambiguous" };

interface EmailClaimInput {
  context: HarnessCapabilityContext;
  idempotencyKey: string;
  inputDigest: string;
  toolUseId: string;
}

export interface HarnessPlatformToolsDeps {
  verifyAccessToken(token: string): HarnessCapabilityClaims;
  resolveCanonicalContext(
    claims: HarnessCapabilityClaims,
  ): Promise<HarnessCapabilityContext | null>;
  resolveAccess(context: HarnessCapabilityContext): Promise<PlatformAccess>;
  queryBrain(input: {
    context: HarnessCapabilityContext;
    query: string;
    mode: "results" | "answer";
    limit: number;
  }): Promise<ContextEngineResponse>;
  sendEmail(input: {
    context: HarnessCapabilityContext;
    to: string[];
    subject: string;
    body: string;
    idempotencyKey: string;
  }): Promise<Record<string, unknown>>;
  claimEmail(input: EmailClaimInput): Promise<EmailClaim>;
  finishEmail(input: {
    context: HarnessCapabilityContext;
    idempotencyKey: string;
    state: "completed" | "failed" | "ambiguous";
    result?: Record<string, unknown>;
    failureReason?: string;
  }): Promise<void>;
  ledgerStore: ToolExecutionLedgerStore;
  policyRevision: string;
  now(): number;
}

export function createHarnessPlatformToolsHandler(
  deps: HarnessPlatformToolsDeps,
) {
  return async function harnessPlatformTools(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const path = event.rawPath || event.requestContext.http.path;
    if (
      event.requestContext.http.method !== "POST" ||
      (path !== BRAIN_PATH && path !== EMAIL_PATH)
    ) {
      return response(404, { error: "not_found" });
    }
    if (hasIdentityOverride(event.headers)) {
      return response(400, { error: "identity_override_rejected" });
    }
    const authorization =
      event.headers.authorization ?? event.headers.Authorization ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return response(401, { error: "exact_user_token_required" });
    }

    let claims: HarnessCapabilityClaims;
    try {
      claims = deps.verifyAccessToken(authorization.slice(7));
    } catch {
      return response(401, { error: "exact_user_token_invalid" });
    }
    if (!hasCompleteTurnTuple(claims)) {
      return response(401, { error: "turn_bound_token_required" });
    }

    const rawBody = decodeBody(event);
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return response(413, { error: "request_too_large" });
    }
    let body: BrainBody | EmailBody;
    try {
      body = JSON.parse(rawBody || "{}") as BrainBody | EmailBody;
    } catch {
      console.warn("[harness-platform-tools] Invalid Gateway body encoding", {
        path,
        contentType: event.headers["content-type"] ?? null,
        bodyLength: rawBody.length,
        firstCodePoint: rawBody.codePointAt(0) ?? null,
        lastCodePoint: rawBody.codePointAt(rawBody.length - 1) ?? null,
        containsEquals: rawBody.includes("="),
        isBase64Encoded: event.isBase64Encoded === true,
      });
      return response(400, { error: "invalid_json" });
    }
    if (body.tenant_id !== claims.tenant_id) {
      return response(403, { error: "tenant_context_mismatch" });
    }

    const parsed =
      path === BRAIN_PATH
        ? parseBrainBody(body as BrainBody)
        : parseEmailBody(body as EmailBody);
    if (!parsed.ok) return response(400, { error: parsed.error });

    const context = await deps.resolveCanonicalContext(claims);
    if (!context) {
      return response(403, { error: "canonical_turn_not_authorized" });
    }
    const access = await deps.resolveAccess(context);
    const isBrain = path === BRAIN_PATH;
    if ((isBrain && !access.brain) || (!isBrain && !access.email)) {
      return response(403, {
        error: isBrain ? "brain_not_authorized" : "send_email_not_authorized",
      });
    }

    return isBrain
      ? runBrain(deps, context, event, parsed.value as ParsedBrain)
      : runEmail(deps, context, event, parsed.value as ParsedEmail);
  };
}

async function runBrain(
  deps: HarnessPlatformToolsDeps,
  context: HarnessCapabilityContext,
  event: APIGatewayProxyEventV2,
  input: ParsedBrain,
): Promise<APIGatewayProxyStructuredResultV2> {
  const startedAt = deps.now();
  const correlation = correlationFor({
    context,
    event,
    operation: "brain.query",
    policyRevision: deps.policyRevision,
    idempotencyKey: event.requestContext.requestId,
    credentialOwnerAlias: `tenant:${context.tenantId}:brain`,
  });
  await appendToolExecutionStarted(deps.ledgerStore, {
    ...correlation,
    input: { queryLength: input.query.length, mode: input.mode, limit: input.limit },
    inputAllowPaths: ["queryLength", "mode", "limit"],
  });
  try {
    const result = sanitizeBrainResult(
      await deps.queryBrain({ context, ...input }),
    );
    await appendToolExecutionTerminal(deps.ledgerStore, {
      ...correlation,
      status: "completed",
      output: {
        hitCount: result.hits.length,
        providerCount: result.providers.length,
        answered: Boolean(result.answer),
      },
      outputAllowPaths: ["hitCount", "providerCount", "answered"],
      durationMs: Math.max(0, deps.now() - startedAt),
    });
    return response(200, result);
  } catch (error) {
    await recordUncertain(deps, correlation, startedAt, "brain_query_failed");
    console.error("[harness-platform-tools] Brain query failed", {
      tenantId: context.tenantId,
      turnId: context.turnId,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return response(502, { error: "brain_query_failed" });
  }
}

async function runEmail(
  deps: HarnessPlatformToolsDeps,
  context: HarnessCapabilityContext,
  event: APIGatewayProxyEventV2,
  input: ParsedEmail,
): Promise<APIGatewayProxyStructuredResultV2> {
  const inputDigest = digestEmailInput(input);
  const idempotencyKey = `email:${context.turnId}:${inputDigest}`;
  const claim = await deps.claimEmail({
    context,
    idempotencyKey,
    inputDigest,
    toolUseId: event.requestContext.requestId,
  });
  if (claim.state === "replay") {
    return response(200, { ...claim.result, replayed: true });
  }
  if (claim.state !== "claimed") {
    return response(409, { error: `send_email_${claim.state}` });
  }

  const startedAt = deps.now();
  const correlation = correlationFor({
    context,
    event,
    operation: "email.send",
    policyRevision: deps.policyRevision,
    idempotencyKey,
    credentialOwnerAlias: `tenant:${context.tenantId}:email`,
  });
  await appendToolExecutionStarted(deps.ledgerStore, {
    ...correlation,
    input: {
      recipientCount: input.to.length,
      subjectLength: input.subject.length,
      bodyLength: input.body.length,
    },
    inputAllowPaths: ["recipientCount", "subjectLength", "bodyLength"],
  });

  try {
    const result = await deps.sendEmail({
      context,
      ...input,
      idempotencyKey,
    });
    const sanitized = sanitizeEmailResult(result);
    const failed = sanitized.status === "blocked" || sanitized.status === "failed";
    await deps.finishEmail({
      context,
      idempotencyKey,
      state: failed ? "failed" : "completed",
      result: sanitized,
      ...(failed ? { failureReason: String(sanitized.reasonCode ?? "blocked") } : {}),
    });
    await appendToolExecutionTerminal(deps.ledgerStore, {
      ...correlation,
      status: failed ? "failed" : "completed",
      output: {
        status: sanitized.status,
        approvalRequested: sanitized.status === "pending_review",
      },
      outputAllowPaths: ["status", "approvalRequested"],
      ...(failed
        ? { error: { code: String(sanitized.reasonCode ?? "blocked") }, errorAllowPaths: ["code"] }
        : {}),
      durationMs: Math.max(0, deps.now() - startedAt),
    });
    return response(failed ? 503 : sanitized.status === "pending_review" ? 202 : 200, sanitized);
  } catch (error) {
    await deps.finishEmail({
      context,
      idempotencyKey,
      state: "ambiguous",
      failureReason: "provider_result_ambiguous",
    }).catch(() => undefined);
    await recordUncertain(deps, correlation, startedAt, "send_email_ambiguous");
    console.error("[harness-platform-tools] Email send became ambiguous", {
      tenantId: context.tenantId,
      turnId: context.turnId,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return response(502, { error: "send_email_ambiguous" });
  }
}

function correlationFor(input: {
  context: HarnessCapabilityContext;
  event: APIGatewayProxyEventV2;
  operation: string;
  policyRevision: string;
  idempotencyKey: string;
  credentialOwnerAlias: string;
}): ToolExecutionCorrelation {
  return {
    tenantId: input.context.tenantId,
    threadId: input.context.threadId,
    turnId: input.context.turnId,
    principalType: "user",
    principalId: input.context.userId,
    toolUseId: input.event.requestContext.requestId,
    operation: input.operation,
    policyRevision: input.policyRevision,
    idempotencyKey: input.idempotencyKey,
    credentialOwnerAlias: input.credentialOwnerAlias,
  };
}

async function recordUncertain(
  deps: HarnessPlatformToolsDeps,
  correlation: ToolExecutionCorrelation,
  startedAt: number,
  code: string,
) {
  await appendToolExecutionTerminal(deps.ledgerStore, {
    ...correlation,
    status: "uncertain",
    output: {},
    outputAllowPaths: [],
    error: { code },
    errorAllowPaths: ["code"],
    durationMs: Math.max(0, deps.now() - startedAt),
  }).catch(() => undefined);
}

async function resolvePlatformAccess(
  context: HarnessCapabilityContext,
): Promise<PlatformAccess> {
  const [agent] = await getDb()
    .select({
      contextEngine: agents.context_engine,
      sendEmail: agents.send_email,
      blockedTools: agents.blocked_tools,
    })
    .from(agents)
    .where(and(eq(agents.id, context.agentId), eq(agents.tenant_id, context.tenantId)))
    .limit(1);
  if (!agent) return { brain: false, email: false };
  const blocked = new Set(
    Array.isArray(agent.blockedTools)
      ? agent.blockedTools.filter((value): value is string => typeof value === "string")
      : [],
  );
  const isBlocked = (tool: string) =>
    toolPolicyAliases(tool).some((alias) => blocked.has(alias));
  const brain = validateTemplateContextEngine(agent.contextEngine);
  const email = validateTemplateSendEmail(agent.sendEmail);
  return {
    brain: brain.ok && brain.value?.enabled === true && !isBlocked("context_engine"),
    email: email.ok && email.value?.enabled === true && !isBlocked("send_email"),
  };
}

async function queryBrain(input: {
  context: HarnessCapabilityContext;
  query: string;
  mode: "results" | "answer";
  limit: number;
}): Promise<ContextEngineResponse> {
  return getContextEngineService().query({
    query: input.query,
    mode: input.mode,
    scope: "auto",
    depth: "quick",
    limit: input.limit,
    providers: { families: ["brain"] },
    caller: {
      tenantId: input.context.tenantId,
      userId: input.context.userId,
      agentId: input.context.agentId,
      threadId: input.context.threadId,
      spaceId: input.context.spaceId,
    },
  });
}

async function sendEmail(input: {
  context: HarnessCapabilityContext;
  to: string[];
  subject: string;
  body: string;
  idempotencyKey: string;
}): Promise<Record<string, unknown>> {
  const result = await sendDirectRoutineEmail({
    tenantId: input.context.tenantId,
    agentId: input.context.agentId,
    requestingUserId: input.context.userId,
    spaceId: input.context.spaceId ?? undefined,
    threadId: input.context.threadId,
    to: input.to,
    subject: input.subject,
    body: input.body,
    bodyFormat: "markdown",
    source: "agentcore-harness",
    idempotencyKey: input.idempotencyKey,
  });
  if ("statusCode" in result) {
    const parsed = JSON.parse(result.body ?? "{}") as Record<string, unknown>;
    const statusCode =
      typeof result.statusCode === "number" ? result.statusCode : 500;
    // A provider-side 5xx has unknown delivery semantics. Keep the execution
    // ambiguous so an AgentCore retry cannot turn a timeout into a duplicate
    // send. Policy denials are explicit, deterministic `blocked` outcomes.
    if (statusCode >= 500 && parsed.status !== "blocked") {
      throw new Error("email_provider_result_ambiguous");
    }
    return { ...parsed, httpStatus: statusCode };
  }
  return result;
}

async function claimEmail(input: EmailClaimInput): Promise<EmailClaim> {
  const database = getDb();
  const [session] = await database
    .select({ id: harnessParticipantSessions.id })
    .from(harnessParticipantSessions)
    .where(
      and(
        eq(harnessParticipantSessions.tenant_id, input.context.tenantId),
        eq(harnessParticipantSessions.turn_id, input.context.turnId),
        eq(harnessParticipantSessions.participant_user_id, input.context.userId),
      ),
    )
    .limit(1);
  if (!session) return { state: "failed" };
  const [inserted] = await database
    .insert(harnessGovernedToolExecutions)
    .values({
      tenant_id: input.context.tenantId,
      turn_id: input.context.turnId,
      participant_user_id: input.context.userId,
      session_id: session.id,
      idempotency_key: input.idempotencyKey,
      audience: "agentcore-gateway",
      operation: "email.send",
      tool_use_id: input.toolUseId,
      input_digest: input.inputDigest,
      state: "claimed",
      credential_owner_alias: `tenant:${input.context.tenantId}:email`,
    })
    .onConflictDoNothing()
    .returning({ id: harnessGovernedToolExecutions.id });
  if (inserted) return { state: "claimed" };
  const [existing] = await database
    .select({
      state: harnessGovernedToolExecutions.state,
      result: harnessGovernedToolExecutions.sanitized_result,
    })
    .from(harnessGovernedToolExecutions)
    .where(
      and(
        eq(harnessGovernedToolExecutions.tenant_id, input.context.tenantId),
        eq(harnessGovernedToolExecutions.idempotency_key, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing?.state === "completed" && isRecord(existing.result)) {
    return { state: "replay", result: existing.result };
  }
  if (existing?.state === "failed") return { state: "failed" };
  if (existing?.state === "ambiguous") return { state: "ambiguous" };
  return { state: "in_progress" };
}

async function finishEmail(input: {
  context: HarnessCapabilityContext;
  idempotencyKey: string;
  state: "completed" | "failed" | "ambiguous";
  result?: Record<string, unknown>;
  failureReason?: string;
}) {
  await getDb()
    .update(harnessGovernedToolExecutions)
    .set({
      state: input.state,
      sanitized_result: input.result ?? null,
      failure_reason: input.failureReason ?? null,
      completed_at: new Date(),
    })
    .where(
      and(
        eq(harnessGovernedToolExecutions.tenant_id, input.context.tenantId),
        eq(harnessGovernedToolExecutions.idempotency_key, input.idempotencyKey),
      ),
    );
}

interface ParsedBrain {
  query: string;
  mode: "results" | "answer";
  limit: number;
}

interface ParsedEmail {
  to: string[];
  subject: string;
  body: string;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseBrainBody(body: BrainBody): ParseResult<ParsedBrain> {
  if (
    typeof body.query !== "string" ||
    body.query.trim().length === 0 ||
    body.query.length > MAX_QUERY_CHARS
  ) {
    return { ok: false, error: "invalid_query" };
  }
  const mode = body.mode === undefined ? "results" : body.mode;
  if (mode !== "results" && mode !== "answer") {
    return { ok: false, error: "invalid_mode" };
  }
  const limit = body.limit === undefined ? 8 : body.limit;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 10) {
    return { ok: false, error: "invalid_limit" };
  }
  return { ok: true, value: { query: body.query.trim(), mode, limit: Number(limit) } };
}

function parseEmailBody(body: EmailBody): ParseResult<ParsedEmail> {
  // `body` is a reserved AgentCore OpenAPI transport name: when it appears in
  // the published tool schema, Gateway sends that field alone as the raw HTTP
  // body. Publish `content` instead and retain `body` only for direct callers.
  const content = body.content ?? body.body;
  if (
    !Array.isArray(body.to) ||
    body.to.length < 1 ||
    body.to.length > 5 ||
    body.to.some((value) => typeof value !== "string" || value.length > 320)
  ) {
    return { ok: false, error: "invalid_recipients" };
  }
  if (
    typeof body.subject !== "string" ||
    body.subject.trim().length === 0 ||
    body.subject.length > MAX_EMAIL_SUBJECT_CHARS
  ) {
    return { ok: false, error: "invalid_subject" };
  }
  if (
    typeof content !== "string" ||
    content.trim().length === 0 ||
    content.length > MAX_EMAIL_BODY_CHARS
  ) {
    return { ok: false, error: "invalid_email_body" };
  }
  return {
    ok: true,
    value: {
      to: body.to.map((value) => (value as string).trim().toLowerCase()).sort(),
      subject: body.subject.trim(),
      body: content.trim(),
    },
  };
}

function digestEmailInput(input: ParsedEmail): string {
  return createHash("sha256")
    .update(JSON.stringify({ to: input.to, subject: input.subject, body: input.body }))
    .digest("hex");
}

function sanitizeBrainResult(result: ContextEngineResponse) {
  return {
    ...(result.answer?.text
      ? { answer: result.answer.text.slice(0, 12_000) }
      : {}),
    hits: result.hits.slice(0, 10).map((hit) => ({
      id: hit.id,
      title: hit.title.slice(0, 500),
      snippet: hit.snippet.slice(0, 4_000),
      family: hit.family,
      ...(hit.sourceFamily ? { sourceFamily: hit.sourceFamily } : {}),
      ...(typeof hit.score === "number" ? { score: hit.score } : {}),
      provenance: {
        ...(hit.provenance.label ? { label: hit.provenance.label } : {}),
        ...(hit.provenance.uri ? { uri: hit.provenance.uri } : {}),
        ...(hit.provenance.sourceId ? { sourceId: hit.provenance.sourceId } : {}),
      },
    })),
    providers: result.providers.map((provider) => ({
      displayName: provider.displayName,
      state: provider.state,
      ...(typeof provider.hitCount === "number" ? { hitCount: provider.hitCount } : {}),
    })),
  };
}

function sanitizeEmailResult(result: Record<string, unknown>) {
  const status =
    result.status === "sent" ||
    result.status === "pending_review" ||
    result.status === "blocked"
      ? result.status
      : result.httpStatus === 200
        ? "sent"
        : "failed";
  return {
    status,
    ...(typeof result.messageId === "string" ? { messageId: result.messageId } : {}),
    ...(typeof result.conversationId === "string"
      ? { conversationId: result.conversationId }
      : {}),
    ...(typeof result.inboxItemId === "string" ? { inboxItemId: result.inboxItemId } : {}),
    ...(typeof result.reasonCode === "string" ? { reasonCode: result.reasonCode } : {}),
  };
}

function hasIdentityOverride(headers: Record<string, string | undefined>) {
  return Boolean(
    headers["x-thinkwork-user-id"] ||
      headers["x-thinkwork-tenant-id"] ||
      headers["x-thinkwork-agent-id"] ||
      headers["x-thinkwork-turn-id"],
  );
}

function hasCompleteTurnTuple(claims: HarnessCapabilityClaims) {
  return Boolean(
    claims.sub &&
      claims.participant_id &&
      claims.sub === claims.participant_id &&
      claims.tenant_id &&
      claims.agent_id &&
      claims.thread_id &&
      claims.turn_id &&
      Number.isInteger(claims.session_generation) &&
      claims.session_generation > 0,
  );
}

function decodeBody(event: APIGatewayProxyEventV2): string {
  const body = event.body ?? "";
  return event.isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
}

function response(
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      pragma: "no-cache",
    },
    body: JSON.stringify(body),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const deployedHandler = createHarnessPlatformToolsHandler({
  verifyAccessToken(token) {
    return verifyProofProviderAccessToken(token, {
      issuer: requiredEnv("AGENTCORE_PROOF_OAUTH_ISSUER"),
      audience: `${requiredEnv("AGENTCORE_PROOF_OAUTH_ISSUER").replace(/\/+$/, "")}/target`,
      secret: requiredEnv("AGENTCORE_PROOF_OAUTH_CLIENT_SECRET"),
      nowSeconds: Math.floor(Date.now() / 1000),
    }) as AccessTokenClaims & HarnessCapabilityClaims;
  },
  resolveCanonicalContext: resolveHarnessCapabilityContext,
  resolveAccess: resolvePlatformAccess,
  queryBrain,
  sendEmail,
  claimEmail,
  finishEmail,
  ledgerStore: drizzleToolExecutionLedgerStore(),
  policyRevision:
    process.env.AGENTCORE_GATEWAY_POLICY_REVISION?.trim() || "platform-tools-v1",
  now: Date.now,
});

export const handler = deployedHandler;
