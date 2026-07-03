/**
 * Agent-facing routine lifecycle operations (deterministic routines v1,
 * plan 2026-07-03-004 U6). The five admin-ops MCP tools are mechanical
 * wrappers over these functions; the invariants live HERE, server-side at
 * the commit seam (KTD-5), where the agent cannot bypass them:
 *
 *   R9  — a NEW routine cannot be committed without at least one fixture.
 *   R15 — commits carry a fixed agent author identity and a message
 *         convention linking the routine (and, for repairs, the run).
 *   R16 — repair-mode commits may modify routine code only, never
 *         fixtures (fixture changes go through the birth path).
 *   R18 — repairs auto-publish only inside a constrained diff envelope:
 *         no new imports, no new network/exec primitives, bounded change
 *         size. Out-of-envelope fixes land on a pending branch with an
 *         operator-approval inbox item instead of the live branch.
 *   R20 — birth-path commits verify the initiating actor's operator/admin
 *         role; repair-mode commits are accepted only with a repair
 *         context referencing a real failed execution of that routine.
 *
 * Commit flow uses the GitHub git-data API against a stated parent SHA
 * (updateRef without force → non-fast-forward rejection = 409-style
 * conflict, never a silent overwrite). Fixture file contents are redacted
 * against the routine's resolved credential values before they ever reach
 * the tenant repo.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";
import { Octokit } from "@octokit/rest";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  resolveRepoCredential,
  type RepoCredential,
  type RoutineExecGitInput,
  type RoutineExecGitResult,
} from "./routine-exec-git.js";
import {
  disableRoutineForBudget,
  repairAttemptsToday,
  REPAIR_BUDGET_PER_DAY,
} from "./routine-repair-dispatch.js";

const {
  routines,
  routineExecutions,
  routineRepairEvents,
  tenantCredentials,
  tenantMembers,
  inboxItems,
} = schema;

// Fixed agent author identity (R15).
export const ROUTINE_AGENT_AUTHOR = {
  name: "ThinkWork Agent",
  email: "agent@thinkwork.ai",
} as const;

/** R18 size cap: total added+removed lines a repair may touch. */
export const REPAIR_ENVELOPE_MAX_CHANGED_LINES = 120;

/** Patterns that may not be INTRODUCED by a repair (R18). A module that
 * already uses `requests` keeps using it; a repair adding a primitive the
 * old code never had does not auto-publish. */
const NETWORK_EXEC_PRIMITIVES = [
  "requests",
  "urllib",
  "http.client",
  "httpx",
  "aiohttp",
  "socket",
  "subprocess",
  "os.system",
  "eval(",
  "exec(",
  "__import__",
] as const;

export type RoutineExecInvoker = (
  input: RoutineExecGitInput,
) => Promise<RoutineExecGitResult>;

export interface RoutineRepoToolsDeps {
  database?: ReturnType<typeof getDb>;
  octokitFactory?: (token: string) => Octokit;
  secretsManagerClient?: SecretsManagerClient;
  /** RequestResponse invoke of the routine-exec-git Lambda. */
  invokeExecutor?: RoutineExecInvoker;
}

const _DEFAULT_SECRETS_CLIENT = new SecretsManagerClient({
  requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 },
});

function defaultOctokitFactory(token: string): Octokit {
  return new Octokit({ auth: token });
}

async function defaultInvokeExecutor(
  input: RoutineExecGitInput,
): Promise<RoutineExecGitResult> {
  const { LambdaClient, InvokeCommand } = await import(
    "@aws-sdk/client-lambda"
  );
  const lambda = new LambdaClient({});
  const stage = process.env.STAGE;
  const fnName =
    process.env.ROUTINE_EXEC_GIT_FUNCTION_NAME ??
    (stage ? `thinkwork-${stage}-api-routine-exec-git` : null);
  if (!fnName) {
    throw new Error(
      "ROUTINE_EXEC_GIT_FUNCTION_NAME/STAGE not configured for fixture runs",
    );
  }
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: fnName,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify(input)),
    }),
  );
  if (response.FunctionError) {
    throw new Error(`executor function error: ${response.FunctionError}`);
  }
  const text = response.Payload
    ? new TextDecoder().decode(response.Payload)
    : "{}";
  return JSON.parse(text) as RoutineExecGitResult;
}

// ---------------------------------------------------------------------------
// routine_repo_list
// ---------------------------------------------------------------------------

export async function listGitRoutines(
  tenantId: string,
  deps: RoutineRepoToolsDeps = {},
): Promise<unknown[]> {
  const db = deps.database ?? getDb();
  const rows = await db
    .select({
      id: routines.id,
      name: routines.name,
      description: routines.description,
      status: routines.status,
      module_path: routines.module_path,
      fixture_paths: routines.fixture_paths,
      credential_refs: routines.credential_refs,
      validated_sha: routines.validated_sha,
      disabled_reason: routines.disabled_reason,
    })
    .from(routines)
    .where(
      and(eq(routines.tenant_id, tenantId), eq(routines.engine, "git_python")),
    );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    enabled: row.status === "active",
    modulePath: row.module_path,
    fixturePaths: row.fixture_paths ?? [],
    credentialRefs: row.credential_refs ?? [],
    validatedSha: row.validated_sha,
    disabledReason: row.disabled_reason,
  }));
}

// ---------------------------------------------------------------------------
// routine_repo_read
// ---------------------------------------------------------------------------

export async function readRoutineRepo(
  input: { tenantId: string; routineId: string; ref?: string },
  deps: RoutineRepoToolsDeps = {},
): Promise<{
  routineId: string;
  ref: string;
  files: { path: string; content: string }[];
}> {
  const db = deps.database ?? getDb();
  const routine = await loadGitRoutine(db, input.tenantId, input.routineId);
  const credential = await resolveRepoCredential(input.tenantId, db, {
    secretsManagerClient: deps.secretsManagerClient ?? _DEFAULT_SECRETS_CLIENT,
  } as never);
  const octokit = (deps.octokitFactory ?? defaultOctokitFactory)(
    credential.token,
  );
  const ref = input.ref ?? (await branchHead(octokit, credential));

  const paths = [
    routine.module_path!,
    ...((routine.fixture_paths as string[] | null) ?? []),
  ];
  const files: { path: string; content: string }[] = [];
  for (const path of paths) {
    try {
      files.push({
        path,
        content: await fetchFileAt(octokit, credential, path, ref),
      });
    } catch (err) {
      files.push({
        path,
        content: `<<unreadable: ${(err as Error).message}>>`,
      });
    }
  }
  return { routineId: routine.id, ref, files };
}

// ---------------------------------------------------------------------------
// routine_run_fixtures — U4 gate in dry-run / gate mode (one code path
// with the executor, KTD-5)
// ---------------------------------------------------------------------------

export async function runRoutineFixtures(
  input: {
    tenantId: string;
    routineId: string;
    /** Inline working files (dry run). Omit to gate the repo HEAD. */
    files?: Record<string, string>;
    modulePath?: string;
  },
  deps: RoutineRepoToolsDeps = {},
): Promise<RoutineExecGitResult> {
  const db = deps.database ?? getDb();
  const routine = await loadGitRoutine(db, input.tenantId, input.routineId);
  const invoke = deps.invokeExecutor ?? defaultInvokeExecutor;
  if (input.files && Object.keys(input.files).length > 0) {
    return invoke({
      routineId: routine.id,
      mode: "dry_run",
      files: input.files,
      modulePath: input.modulePath ?? routine.module_path ?? undefined,
    });
  }
  return invoke({ routineId: routine.id, mode: "gate" });
}

// ---------------------------------------------------------------------------
// routine_runs
// ---------------------------------------------------------------------------

export async function listRoutineRuns(
  input: { tenantId: string; routineId: string; limit?: number },
  deps: RoutineRepoToolsDeps = {},
): Promise<unknown[]> {
  const db = deps.database ?? getDb();
  const routine = await loadGitRoutine(db, input.tenantId, input.routineId);
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  const rows = await db
    .select()
    .from(routineExecutions)
    .where(
      and(
        eq(routineExecutions.tenant_id, input.tenantId),
        eq(routineExecutions.routine_id, routine.id),
      ),
    )
    .orderBy(desc(routineExecutions.created_at))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    triggerSource: row.trigger_source,
    commitSha: row.commit_sha,
    validatedSha: row.validated_sha,
    cacheServed: row.cache_served,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    outputJson: row.output_json,
  }));
}

// ---------------------------------------------------------------------------
// routine_repo_commit — the composite seam
// ---------------------------------------------------------------------------

export interface CommitRoutineInput {
  tenantId: string;
  /** Initiating user for birth-path commits (R20). */
  principalId?: string | null;
  /** Existing routine id; omit with `register` to birth a new routine. */
  routineId?: string;
  /** Birth registration metadata for a new routine. */
  register?: {
    name: string;
    description?: string;
    modulePath: string;
    fixturePaths: string[];
    credentialRefs?: { alias: string; credentialId: string }[];
  };
  /** Repo files to write, path → content. */
  files: Record<string, string>;
  /** Commit message summary line. */
  message: string;
  /** The commit is applied only if the branch is still at this SHA. */
  parentSha: string;
  /** Repair mode (R16/R18/R20): accepted only with a repair context
   * referencing a failed execution of this routine. */
  repair?: {
    executionId: string;
    /** Thread/wakeup ref for the repair log + message convention. */
    threadRef?: string;
  };
}

export interface CommitRoutineResult {
  status: "committed" | "pending_approval";
  routineId: string;
  commitSha: string;
  branch: string;
  /** Present on in-envelope repair commits: the synchronous gate verdict. */
  gate?: RoutineExecGitResult;
  /** Present on pending_approval: why the envelope rejected auto-publish. */
  envelopeViolations?: string[];
  inboxItemId?: string;
}

export async function commitRoutine(
  input: CommitRoutineInput,
  deps: RoutineRepoToolsDeps = {},
): Promise<CommitRoutineResult> {
  const db = deps.database ?? getDb();
  if (!input.files || Object.keys(input.files).length === 0) {
    throw new Error("files is required — nothing to commit");
  }
  if (!input.parentSha) {
    throw new Error(
      "parentSha is required — read the repo first and commit against what you saw",
    );
  }

  const isRepair = Boolean(input.repair);
  let routine: GitRoutineRow | null = null;
  if (input.routineId) {
    routine = await loadGitRoutine(db, input.tenantId, input.routineId);
  }

  // ---- Mode invariants ---------------------------------------------------
  if (isRepair) {
    if (!routine) {
      throw new Error("repair commits require an existing routineId");
    }
    // R20: repair commits are accepted only from a repair dispatch — the
    // context must reference a real failed execution of THIS routine.
    const [failedRun] = await db
      .select({ id: routineExecutions.id, status: routineExecutions.status })
      .from(routineExecutions)
      .where(
        and(
          eq(routineExecutions.id, input.repair!.executionId),
          eq(routineExecutions.routine_id, routine.id),
          eq(routineExecutions.tenant_id, input.tenantId),
        ),
      )
      .limit(1);
    if (!failedRun || failedRun.status !== "failed") {
      throw new Error(
        "repair context rejected: executionId must reference a failed execution of this routine",
      );
    }
    // R16: code only — never fixtures, never other files.
    const allowed = new Set([routine.module_path]);
    for (const path of Object.keys(input.files)) {
      if (!allowed.has(path)) {
        throw new Error(
          `repair commits may modify routine code only (${routine.module_path}); ` +
            `"${path}" is not allowed — fixture changes go through the birth path (R16)`,
        );
      }
    }
  } else {
    // Birth path — R20: the initiating actor must be an operator/admin.
    await assertOperator(db, input.tenantId, input.principalId);
    if (!routine && !input.register) {
      throw new Error("provide routineId (update) or register (new routine)");
    }
    if (!routine && input.register) {
      // R9: no fixture, no publish.
      const fixtureFiles = input.register.fixturePaths.filter(
        (path) => input.files[path] !== undefined,
      );
      if (
        input.register.fixturePaths.length === 0 ||
        fixtureFiles.length === 0
      ) {
        throw new Error(
          "a new routine requires at least one fixture file in this commit (R9)",
        );
      }
      if (input.files[input.register.modulePath] === undefined) {
        throw new Error("the commit must include the routine module file");
      }
    }
  }

  // ---- Repo access --------------------------------------------------------
  const credential = await resolveRepoCredential(input.tenantId, db, {
    secretsManagerClient: deps.secretsManagerClient ?? _DEFAULT_SECRETS_CLIENT,
  } as never);
  const octokit = (deps.octokitFactory ?? defaultOctokitFactory)(
    credential.token,
  );

  // Stale-parent conflict detection (never force).
  const headSha = await branchHead(octokit, credential);
  if (headSha !== input.parentSha) {
    throw new Error(
      `conflict: branch ${credential.branch} is at ${headSha.slice(0, 12)}, ` +
        `not the stated parent ${input.parentSha.slice(0, 12)} — re-read and retry`,
    );
  }

  // ---- R18 envelope (repair mode) -----------------------------------------
  let envelopeViolations: string[] = [];
  if (isRepair && routine) {
    const oldContent = await fetchFileAt(
      octokit,
      credential,
      routine.module_path!,
      headSha,
    ).catch(() => "");
    const newContent = input.files[routine.module_path!] ?? "";
    envelopeViolations = checkRepairEnvelope(oldContent, newContent);
  }

  // ---- Redaction: fixture contents must not carry credential secrets ------
  const redactionValues = await resolveCredentialSecretValues(
    db,
    input.tenantId,
    routine?.credential_refs ?? input.register?.credentialRefs ?? [],
    deps,
  );
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(input.files)) {
    files[path] = isFixturePath(path, routine, input.register)
      ? redactSecrets(content, redactionValues)
      : content;
  }

  // ---- Commit via git-data ------------------------------------------------
  const outOfEnvelope = envelopeViolations.length > 0;
  const targetBranch = outOfEnvelope
    ? `thinkwork/pending/${(routine?.name ?? "routine").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`
    : credential.branch;

  const message = buildCommitMessage({
    routineName: routine?.name ?? input.register?.name ?? "routine",
    summary: input.message,
    repair: input.repair ?? null,
  });

  const commitSha = await createGitCommit({
    octokit,
    credential,
    parentSha: headSha,
    files,
    message,
    branch: targetBranch,
    createBranch: outOfEnvelope,
  });

  // ---- Registration (birth of a new routine) ------------------------------
  let routineId = routine?.id ?? "";
  if (!routine && input.register) {
    routineId = randomUUID();
    await db.insert(routines).values({
      id: routineId,
      tenant_id: input.tenantId,
      name: input.register.name,
      description: input.register.description ?? null,
      type: "scheduled",
      status: "active",
      engine: "git_python",
      visibility: "tenant_shared",
      module_path: input.register.modulePath,
      fixture_paths: input.register.fixturePaths,
      credential_refs: input.register.credentialRefs ?? [],
    });
  }

  // ---- Out-of-envelope repair → pending + operator approval (AE9) ---------
  if (outOfEnvelope && routine) {
    // Ladder history: pending commits count NO repair attempt until an
    // operator decides (R13/KTD-4).
    await db.insert(routineRepairEvents).values({
      tenant_id: input.tenantId,
      routine_id: routine.id,
      execution_id: input.repair?.executionId ?? null,
      event_type: "pending_commit",
      thread_ref: input.repair?.threadRef ?? null,
      from_sha: headSha,
      to_sha: commitSha,
      envelope_verdict: "out_of_envelope",
      detail_json: { envelopeViolations, branch: targetBranch },
    });
    const [inboxRow] = await db
      .insert(inboxItems)
      .values({
        tenant_id: input.tenantId,
        type: "routine_repair_approval",
        status: "pending",
        title: `Routine repair needs approval: ${routine.name}`,
        description:
          `An agent repair for "${routine.name}" is outside the auto-publish envelope ` +
          `(${envelopeViolations.join("; ")}). The fix is parked on branch ${targetBranch} ` +
          `at ${commitSha.slice(0, 12)} — review and merge it to publish, or delete the branch to reject.`,
        entity_type: "routine",
        entity_id: routine.id,
        config: {
          routineId: routine.id,
          branch: targetBranch,
          commitSha,
          envelopeViolations,
          executionId: input.repair?.executionId ?? null,
        },
      })
      .returning({ id: inboxItems.id });
    return {
      status: "pending_approval",
      routineId: routine.id,
      commitSha,
      branch: targetBranch,
      envelopeViolations,
      inboxItemId: inboxRow?.id,
    };
  }

  // ---- In-envelope repair → synchronous gate on the new SHA ---------------
  // Green auto-advances validated_sha (the gate is its only writer); red
  // consumes a repair attempt against the 3/day UTC budget (R13) and trips
  // the breaker on exhaustion (AE4).
  let gate: RoutineExecGitResult | undefined;
  if (isRepair && routine) {
    const invoke = deps.invokeExecutor ?? defaultInvokeExecutor;
    gate = await invoke({ routineId, mode: "gate" });
    const gateGreen = gate.status === "gate_green";
    const now = new Date();
    const attemptsBefore = await repairAttemptsToday(
      db as never,
      routine.id,
      now,
    );
    const attemptsAfter = gateGreen ? attemptsBefore : attemptsBefore + 1;
    await db.insert(routineRepairEvents).values({
      tenant_id: input.tenantId,
      routine_id: routine.id,
      execution_id: input.repair?.executionId ?? null,
      event_type: "repair_attempt",
      thread_ref: input.repair?.threadRef ?? null,
      from_sha: headSha,
      to_sha: commitSha,
      gate_result: gateGreen ? "green" : "red",
      envelope_verdict: "in_envelope",
      budget_snapshot: Math.max(0, REPAIR_BUDGET_PER_DAY - attemptsAfter),
      detail_json: gate.gate ? { fixtures: gate.gate.fixtures } : null,
    });
    if (!gateGreen && attemptsAfter >= REPAIR_BUDGET_PER_DAY) {
      await disableRoutineForBudget(db as never, {
        tenantId: input.tenantId,
        routineId: routine.id,
        routineName: routine.name,
        executionId: input.repair?.executionId ?? null,
        now,
      });
    }
  }

  return {
    status: "committed",
    routineId,
    commitSha,
    branch: targetBranch,
    gate,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type GitRoutineRow = {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
  module_path: string | null;
  fixture_paths: unknown;
  credential_refs: unknown;
  validated_sha: string | null;
};

async function loadGitRoutine(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  routineId: string,
): Promise<GitRoutineRow> {
  const [row] = await db
    .select()
    .from(routines)
    .where(and(eq(routines.id, routineId), eq(routines.tenant_id, tenantId)))
    .limit(1);
  if (!row || row.engine !== "git_python") {
    throw new Error(`git_python routine ${routineId} not found in tenant`);
  }
  return row as GitRoutineRow;
}

/** R20: birth-path actor must be an active owner/admin tenant member. */
async function assertOperator(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  principalId: string | null | undefined,
): Promise<void> {
  if (!principalId) {
    throw new Error(
      "birth-path commits require the initiating operator's principalId (R20)",
    );
  }
  const [member] = await db
    .select({ role: tenantMembers.role, status: tenantMembers.status })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_id, principalId),
      ),
    )
    .limit(1);
  if (
    !member ||
    member.status !== "active" ||
    (member.role !== "owner" && member.role !== "admin")
  ) {
    throw new Error(
      "birth-path commit rejected: the initiating actor is not an operator/admin of this tenant (R20)",
    );
  }
}

async function branchHead(
  octokit: Octokit,
  credential: RepoCredential,
): Promise<string> {
  const ref = await octokit.git.getRef({
    owner: credential.owner,
    repo: credential.repo,
    ref: `heads/${credential.branch}`,
  });
  return ref.data.object.sha;
}

async function fetchFileAt(
  octokit: Octokit,
  credential: RepoCredential,
  path: string,
  ref: string,
): Promise<string> {
  const res = await octokit.repos.getContent({
    owner: credential.owner,
    repo: credential.repo,
    path,
    ref,
  });
  const data = res.data as { content?: string; encoding?: string };
  if (!data.content) throw new Error(`repo file ${path}@${ref} has no content`);
  return Buffer.from(
    data.content,
    (data.encoding as BufferEncoding) ?? "base64",
  ).toString("utf-8");
}

/** R18: the constrained diff envelope for auto-publishing repairs. */
export function checkRepairEnvelope(
  oldContent: string,
  newContent: string,
): string[] {
  const violations: string[] = [];
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const oldSet = new Set(oldLines.map((l) => l.trim()));
  const newSet = new Set(newLines.map((l) => l.trim()));
  const addedLines = newLines.filter((l) => !oldSet.has(l.trim()));
  const removedLines = oldLines.filter((l) => !newSet.has(l.trim()));

  if (
    addedLines.length + removedLines.length >
    REPAIR_ENVELOPE_MAX_CHANGED_LINES
  ) {
    violations.push(
      `change too large (${addedLines.length + removedLines.length} lines > ${REPAIR_ENVELOPE_MAX_CHANGED_LINES})`,
    );
  }

  const importRe = /^\s*(import\s+\S+|from\s+\S+\s+import\b)/;
  const oldImports = new Set(
    oldLines.filter((l) => importRe.test(l)).map((l) => l.trim()),
  );
  const newImports = newLines
    .filter((l) => importRe.test(l))
    .map((l) => l.trim())
    .filter((l) => !oldImports.has(l));
  if (newImports.length > 0) {
    violations.push(`adds imports: ${newImports.join(", ")}`);
  }

  for (const primitive of NETWORK_EXEC_PRIMITIVES) {
    const inOld = oldContent.includes(primitive);
    const introduced = addedLines.some((l) => l.includes(primitive));
    if (!inOld && introduced) {
      violations.push(`introduces network/exec primitive: ${primitive}`);
    }
  }
  return violations;
}

function isFixturePath(
  path: string,
  routine: GitRoutineRow | null,
  register: CommitRoutineInput["register"],
): boolean {
  const fixturePaths = new Set([
    ...((routine?.fixture_paths as string[] | null) ?? []),
    ...(register?.fixturePaths ?? []),
  ]);
  return fixturePaths.has(path) || /\/fixtures\//.test(path);
}

function redactSecrets(content: string, values: string[]): string {
  let redacted = content;
  for (const value of values) {
    if (value && value.length >= 6) {
      redacted = redacted.split(value).join("[REDACTED]");
    }
  }
  return redacted;
}

async function resolveCredentialSecretValues(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  refs: unknown,
  deps: RoutineRepoToolsDeps,
): Promise<string[]> {
  const bindings = Array.isArray(refs)
    ? (refs as { credentialId?: string }[])
    : [];
  const ids = bindings
    .map((b) => b.credentialId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: tenantCredentials.id,
      slug: tenantCredentials.slug,
      secret_ref: tenantCredentials.secret_ref,
    })
    .from(tenantCredentials)
    .where(
      and(
        eq(tenantCredentials.tenant_id, tenantId),
        inArray(tenantCredentials.id, ids),
      ),
    );
  const secrets = deps.secretsManagerClient ?? _DEFAULT_SECRETS_CLIENT;
  const values: string[] = [];
  for (const row of rows) {
    try {
      const secret = await secrets.send(
        new GetSecretValueCommand({ SecretId: row.secret_ref }),
      );
      const payload = JSON.parse(secret.SecretString ?? "{}") as Record<
        string,
        unknown
      >;
      for (const value of Object.values(payload)) {
        if (typeof value === "string") values.push(value);
      }
    } catch {
      // A missing credential must not block a commit; redaction is
      // best-effort defense in depth over content the agent authored.
    }
  }
  return values;
}

function buildCommitMessage(input: {
  routineName: string;
  summary: string;
  repair: { executionId: string; threadRef?: string } | null;
}): string {
  const slug = input.routineName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const header = input.repair
    ? `routine(${slug}): repair — ${input.summary}`
    : `routine(${slug}): ${input.summary}`;
  const trailerLines = [
    "",
    `Authored-By: ${ROUTINE_AGENT_AUTHOR.name} <${ROUTINE_AGENT_AUTHOR.email}>`,
  ];
  if (input.repair) {
    trailerLines.push(`Repairs-Execution: ${input.repair.executionId}`);
    if (input.repair.threadRef) {
      trailerLines.push(`Repair-Thread: ${input.repair.threadRef}`);
    }
  }
  return header + "\n" + trailerLines.join("\n");
}

async function createGitCommit(args: {
  octokit: Octokit;
  credential: RepoCredential;
  parentSha: string;
  files: Record<string, string>;
  message: string;
  branch: string;
  createBranch: boolean;
}): Promise<string> {
  const { octokit, credential } = args;
  const owner = credential.owner;
  const repo = credential.repo;

  const parentCommit = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: args.parentSha,
  });

  const tree = await octokit.git.createTree({
    owner,
    repo,
    base_tree: parentCommit.data.tree.sha,
    tree: Object.entries(args.files).map(([path, content]) => ({
      path,
      mode: "100644" as const,
      type: "blob" as const,
      content,
    })),
  });

  const commit = await octokit.git.createCommit({
    owner,
    repo,
    message: args.message,
    tree: tree.data.sha,
    parents: [args.parentSha],
    author: {
      name: ROUTINE_AGENT_AUTHOR.name,
      email: ROUTINE_AGENT_AUTHOR.email,
    },
  });

  if (args.createBranch) {
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${args.branch}`,
      sha: commit.data.sha,
    });
  } else {
    // Fast-forward only — a race after our head check surfaces as a
    // GitHub non-fast-forward error rather than a silent overwrite.
    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${args.branch}`,
      sha: commit.data.sha,
      force: false,
    });
  }
  return commit.data.sha;
}
