/**
 * routine-exec-git — deterministic git-backed routine executor
 * (plan 2026-07-03-004 §U3/§U4).
 *
 * Executes a `git_python` routine with zero LLM tokens:
 *
 *   1. Snapshots env at handler entry (completion-callback snapshot
 *      pattern) and loads the routine row (engine git_python, enabled).
 *   2. Serializes per routine: a second invocation while a run is live
 *      returns `skipped_already_running`; `running` rows older than the
 *      stale threshold are swept to `timed_out` first so a crashed
 *      invocation cannot wedge the routine (KTD-3).
 *   3. Resolves the tenant's routine-repo credential (fixed slug
 *      `routine-repo`, kind github_repo) and the branch HEAD SHA via the
 *      GitHub API with rate-limit backoff.
 *   4. New SHA → fetches module + fixtures, caches them in S3 keyed by
 *      SHA (`routine-code-cache/<tenantId>/<routineId>/<sha>/`, DB index
 *      in routine_code_cache), and runs the fixture gate. Green promotes
 *      `routines.validated_sha`; red pins execution to the last-validated
 *      SHA (R5). Zero fixtures is red by definition (R9).
 *   5. Git unreachable → executes the last-validated SHA from the S3
 *      cache with `cache_served = true` (R6); classified as an infra
 *      failure when no cached fallback exists (no repair-budget burn,
 *      R17 — tier-1 consumers read error_code prefixes `infra_` / `code_`).
 *   6. Executes `def run(input) -> dict` in the AgentCore Code
 *      Interpreter by delegating to invokePythonTask (routine-task-python
 *      — sessions, env prelude, credential injection, redaction, and S3
 *      stdout/stderr offload are shared, not reimplemented). Only the
 *      routine's declared credential_refs are resolved into the sandbox
 *      (R19/KTD-11).
 *   7. Writes ledger-compatible routine_executions rows: commit_sha,
 *      validated_sha, cache_served, output_json; terminal updates are
 *      conditional on status='running' (terminal-lock semantics mirroring
 *      routine-execution-callback — this engine writes directly, no SFN).
 *
 * Modes: `execute` (production run), `gate` (fixtures against a SHA,
 * no production run), `dry_run` (fixtures against inline working files —
 * the agent's pre-commit check; shares the gate code path so agent-green
 * cannot drift from gate-green, KTD-5).
 */

import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Octokit } from "@octokit/rest";
import {
  invokePythonTask,
  type PythonTaskInput,
  type PythonTaskResult,
} from "./routine-task-python.js";
import { type CredentialBindingInput } from "./routine-credential-resolver.js";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

const { routines, routineExecutions, routineCodeCache, tenantCredentials } =
  schema;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoutineExecGitInput {
  routineId: string;
  /** Routine input, exposed to sandbox code as `input`. */
  input?: unknown;
  /** manual | schedule | agent_tool | routine_invoke | automation */
  triggerSource?: string;
  /** Optional scheduled_jobs FK. */
  triggerId?: string | null;
  /** execute (default) | gate | dry_run */
  mode?: "execute" | "gate" | "dry_run";
  /** dry_run only: working files keyed by repo path (module + fixtures). */
  files?: Record<string, string>;
  /** dry_run only: module path within `files`. */
  modulePath?: string;
}

export interface FixtureResult {
  path: string;
  mode: "exact" | "shape";
  passed: boolean;
  detail?: string;
}

export interface GateResult {
  status: "green" | "red";
  sha: string | null;
  fixtures: FixtureResult[];
  /** Set when the gate could not run at all (malformed fixture, infra). */
  errorClass?: string;
  errorMessage?: string;
}

export interface RoutineExecGitResult {
  status:
    | "succeeded"
    | "failed"
    | "skipped_already_running"
    | "gate_green"
    | "gate_red";
  executionId?: string;
  commitSha?: string | null;
  validatedSha?: string | null;
  cacheServed?: boolean;
  outputJson?: unknown;
  errorClass?: string;
  errorMessage?: string;
  gate?: GateResult;
}

export interface RoutineExecGitOptions {
  interpreterId: string;
  bucket: string;
  database?: ReturnType<typeof getDb>;
  s3Client?: S3Client;
  secretsManagerClient?: SecretsManagerClient;
  octokitFactory?: (token: string) => Octokit;
  /** Injectable sandbox runner; defaults to invokePythonTask. */
  pythonTask?: (
    input: PythonTaskInput,
    options: {
      interpreterId: string;
      bucket: string;
      envAllowlist?: string[];
    },
  ) => Promise<PythonTaskResult>;
  /** Stale-`running` sweep threshold in ms; defaults to 420s (Lambda
   * timeout 360s + margin). */
  staleRunningMs?: number;
  now?: () => Date;
}

export interface RepoCredential {
  repoUrl: string;
  token: string;
  branch: string;
  owner: string;
  repo: string;
}

interface FixtureFile {
  path: string;
  input: unknown;
  expected: unknown;
  mode: "exact" | "shape";
  /** shape mode: dot-paths whose values must ALSO match exactly. */
  invariantPaths?: string[];
}

/** Fixed slug — one routine repo per tenant (U2 convention). */
export const ROUTINE_REPO_CREDENTIAL_SLUG = "routine-repo";

/** Reserved input key set on gate/dry-run invocations so effectful
 * routines can no-op side effects (KTD-6). */
export const GATE_INPUT_KEY = "_gate";

const RESULT_MARKER = "__THINKWORK_ROUTINE_RESULT__";
const DEFAULT_STALE_RUNNING_MS = 420_000;
const EXECUTION_TIMEOUT_SECONDS = 300;
const GITHUB_MAX_ATTEMPTS = 3;

const _DEFAULT_S3_CLIENT = new S3Client({
  requestHandler: { requestTimeout: 15_000, connectionTimeout: 5_000 },
});
const _DEFAULT_SECRETS_CLIENT = new SecretsManagerClient({
  requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 },
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function executeGitRoutine(
  event: RoutineExecGitInput,
  options: RoutineExecGitOptions,
): Promise<RoutineExecGitResult> {
  const db = options.database ?? getDb();
  const now = options.now ?? (() => new Date());

  const [routine] = await db
    .select()
    .from(routines)
    .where(eq(routines.id, event.routineId))
    .limit(1);
  if (!routine) {
    return failResult("infra_routine_not_found", "routine not found");
  }
  if (routine.engine !== "git_python") {
    return failResult(
      "infra_wrong_engine",
      `routine engine is ${routine.engine}, expected git_python`,
    );
  }
  if (!routine.module_path) {
    return failResult("infra_no_module_path", "routine has no module_path");
  }

  const mode = event.mode ?? "execute";

  // dry_run never touches the ledger, the repo HEAD, or validated_sha —
  // it gates inline working files (the agent's pre-commit check).
  if (mode === "dry_run") {
    const gate = await runFixtureGateOnFiles({
      routine,
      files: event.files ?? {},
      modulePath: event.modulePath ?? routine.module_path,
      sha: null,
      options,
    });
    return {
      status: gate.status === "green" ? "gate_green" : "gate_red",
      gate,
    };
  }

  if (routine.status !== "active") {
    return failResult(
      "infra_routine_disabled",
      routine.disabled_reason
        ? `routine is ${routine.status}: ${routine.disabled_reason}`
        : `routine is ${routine.status}`,
    );
  }

  // ---- Per-routine serialization + stale sweep (KTD-3) ------------------
  const staleMs = options.staleRunningMs ?? DEFAULT_STALE_RUNNING_MS;
  const staleBefore = new Date(now().getTime() - staleMs);
  await db
    .update(routineExecutions)
    .set({
      status: "timed_out",
      finished_at: now(),
      error_code: "stale_running_swept",
      error_message: `running row exceeded ${staleMs}ms; swept by a newer invocation`,
    })
    .where(
      and(
        eq(routineExecutions.routine_id, routine.id),
        eq(routineExecutions.status, "running"),
        lt(routineExecutions.created_at, staleBefore),
      ),
    );
  const [liveRun] = await db
    .select({ id: routineExecutions.id })
    .from(routineExecutions)
    .where(
      and(
        eq(routineExecutions.routine_id, routine.id),
        eq(routineExecutions.status, "running"),
      ),
    )
    .limit(1);
  if (liveRun) {
    return { status: "skipped_already_running", executionId: liveRun.id };
  }

  // ---- Resolve repo credential + HEAD ------------------------------------
  let credential: RepoCredential;
  try {
    credential = await resolveRepoCredential(routine.tenant_id, db, options);
  } catch (err) {
    return await recordInfraFailureRun(db, routine, event, now, {
      errorClass: "infra_repo_credential",
      errorMessage: (err as Error).message,
    });
  }

  const octokit = (options.octokitFactory ?? defaultOctokitFactory)(
    credential.token,
  );

  let headSha: string | null = null;
  let gitError: string | null = null;
  try {
    headSha = await withGithubRetry(async () => {
      const ref = await octokit.git.getRef({
        owner: credential.owner,
        repo: credential.repo,
        ref: `heads/${credential.branch}`,
      });
      return ref.data.object.sha;
    });
  } catch (err) {
    gitError = (err as Error).message;
  }

  // ---- Choose the SHA to execute ------------------------------------------
  let execSha: string | null = null;
  let cacheServed = false;
  let gate: GateResult | undefined;

  if (headSha === null) {
    // Git unreachable → cached last-validated SHA (R6) or infra failure.
    if (routine.validated_sha) {
      execSha = routine.validated_sha;
      cacheServed = true;
    } else {
      return await recordInfraFailureRun(db, routine, event, now, {
        errorClass: "infra_git_unreachable",
        errorMessage: `GitHub unreachable and no validated SHA cached: ${gitError}`,
      });
    }
  } else if (headSha === routine.validated_sha) {
    execSha = headSha;
  } else {
    // New SHA → fixture gate before first production use (R5).
    gate = await gateSha({
      routine,
      sha: headSha,
      credential,
      octokit,
      db,
      options,
    });
    if (mode === "gate") {
      return {
        status: gate.status === "green" ? "gate_green" : "gate_red",
        gate,
        validatedSha: gate.status === "green" ? headSha : routine.validated_sha,
      };
    }
    if (gate.status === "green") {
      execSha = headSha;
    } else if (routine.validated_sha) {
      // Red: last-validated keeps running; the repair ladder is the
      // caller's next move (tier-0 lives in U7).
      execSha = routine.validated_sha;
    } else {
      return await recordInfraFailureRun(db, routine, event, now, {
        errorClass: "code_gate_red_no_validated_sha",
        errorMessage:
          gate.errorMessage ??
          "fixture gate red and the routine has no validated SHA to fall back to",
      });
    }
  }

  if (mode === "gate") {
    // HEAD already validated (or served from cache) — nothing to gate.
    return {
      status: "gate_green",
      validatedSha: routine.validated_sha,
      gate: { status: "green", sha: execSha, fixtures: [] },
    };
  }

  // ---- Create the ledger row (running) ------------------------------------
  const executionId = randomUUID();
  await db.insert(routineExecutions).values({
    id: executionId,
    tenant_id: routine.tenant_id,
    routine_id: routine.id,
    trigger_id: event.triggerId ?? null,
    trigger_source: event.triggerSource ?? "manual",
    input_json: event.input ?? null,
    status: "running",
    started_at: now(),
    commit_sha: execSha,
    validated_sha: routine.validated_sha,
    cache_served: cacheServed,
  });

  // ---- Load code (S3 cache read-through) + execute -------------------------
  try {
    const moduleCode = await loadModuleCode({
      routine,
      sha: execSha!,
      credential,
      octokit: headSha === null ? null : octokit,
      db,
      options,
    });

    const task = await runRoutineModule({
      routine,
      moduleCode,
      input: event.input,
      executionId,
      options,
      gateMode: false,
    });

    const output = extractResult(task);
    const succeeded = task.exitCode === 0 && !task.errorClass;
    await terminalUpdate(db, executionId, {
      status: succeeded ? "succeeded" : "failed",
      finished_at: now(),
      output_json: succeeded ? (output.value ?? null) : null,
      error_code: succeeded ? null : (task.errorClass ?? "code_run_failed"),
      error_message: succeeded
        ? null
        : (task.errorMessage ??
          `run() exited ${task.exitCode}; stdout: ${task.stdoutPreview.slice(0, 500)}`),
    });
    return {
      status: succeeded ? "succeeded" : "failed",
      executionId,
      commitSha: execSha,
      validatedSha: routine.validated_sha,
      cacheServed,
      outputJson: succeeded ? output.value : undefined,
      ...(succeeded
        ? {}
        : {
            errorClass: task.errorClass ?? "code_run_failed",
            errorMessage: task.errorMessage ?? undefined,
          }),
      gate,
    };
  } catch (err) {
    const message = (err as Error).message ?? "unknown";
    const errorClass =
      (err as { errorClass?: string }).errorClass ?? "infra_execution";
    await terminalUpdate(db, executionId, {
      status: "failed",
      finished_at: now(),
      error_code: errorClass,
      error_message: message,
    });
    return {
      status: "failed",
      executionId,
      commitSha: execSha,
      cacheServed,
      errorClass,
      errorMessage: message,
      gate,
    };
  }
}

// ---------------------------------------------------------------------------
// Repo credential
// ---------------------------------------------------------------------------

export async function resolveRepoCredential(
  tenantId: string,
  db: ReturnType<typeof getDb>,
  options: RoutineExecGitOptions,
): Promise<RepoCredential> {
  const [row] = await db
    .select()
    .from(tenantCredentials)
    .where(
      and(
        eq(tenantCredentials.tenant_id, tenantId),
        eq(tenantCredentials.slug, ROUTINE_REPO_CREDENTIAL_SLUG),
        eq(tenantCredentials.status, "active"),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error(
      "no routine repo configured — connect one under Settings → Routine Repo",
    );
  }
  const secrets = options.secretsManagerClient ?? _DEFAULT_SECRETS_CLIENT;
  const secret = await secrets.send(
    new GetSecretValueCommand({ SecretId: row.secret_ref }),
  );
  const payload = JSON.parse(secret.SecretString ?? "{}") as {
    repoUrl?: string;
    token?: string;
    branch?: string;
  };
  if (!payload.repoUrl || !payload.token || !payload.branch) {
    throw new Error("routine repo credential is missing repoUrl/token/branch");
  }
  const match = payload.repoUrl
    .trim()
    .replace(/\.git$/, "")
    .match(/github\.com[/:]([^/]+)\/([^/]+)\/?$/);
  const bare = payload.repoUrl
    .trim()
    .replace(/\.git$/, "")
    .match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  const ref = match ?? bare;
  if (!ref) {
    throw new Error(`unparseable routine repo URL: ${payload.repoUrl}`);
  }
  return {
    repoUrl: payload.repoUrl,
    token: payload.token,
    branch: payload.branch,
    owner: ref[1],
    repo: ref[2],
  };
}

function defaultOctokitFactory(token: string): Octokit {
  return new Octokit({ auth: token });
}

async function withGithubRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= GITHUB_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      // Retry only rate-limit / transient server errors; 401/403/404 are
      // deterministic and retrying burns the budget for nothing.
      if (status !== 429 && (status === undefined || status < 500)) throw err;
      if (attempt < GITHUB_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, attempt * 500));
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// S3 SHA cache (read-through; DB index in routine_code_cache)
// ---------------------------------------------------------------------------

function cachePrefix(routine: { tenant_id: string; id: string }, sha: string) {
  return `routine-code-cache/${routine.tenant_id}/${routine.id}/${sha}`;
}

async function s3GetText(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<string | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return (await res.Body?.transformToString()) ?? null;
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

async function fetchRepoFile(
  octokit: Octokit,
  credential: RepoCredential,
  path: string,
  sha: string,
): Promise<string> {
  const res = await withGithubRetry(() =>
    octokit.repos.getContent({
      owner: credential.owner,
      repo: credential.repo,
      path,
      ref: sha,
    }),
  );
  const data = res.data as { content?: string; encoding?: string };
  if (!data.content) {
    throw new Error(`repo file ${path}@${sha.slice(0, 12)} has no content`);
  }
  return Buffer.from(
    data.content,
    (data.encoding as BufferEncoding) ?? "base64",
  ).toString("utf-8");
}

/** Read-through: S3 first, GitHub on miss (writing back to S3 + the DB
 * index). `octokit === null` means git is unreachable — cache only. */
async function loadFileCached(args: {
  routine: { tenant_id: string; id: string };
  path: string;
  sha: string;
  credential: RepoCredential;
  octokit: Octokit | null;
  db: ReturnType<typeof getDb>;
  options: RoutineExecGitOptions;
}): Promise<string> {
  const s3 = args.options.s3Client ?? _DEFAULT_S3_CLIENT;
  const key = `${cachePrefix(args.routine, args.sha)}/${args.path}`;
  const cached = await s3GetText(s3, args.options.bucket, key);
  if (cached !== null) return cached;
  if (!args.octokit) {
    const err = new Error(
      `cache miss for ${args.path}@${args.sha.slice(0, 12)} while git is unreachable`,
    );
    (err as { errorClass?: string }).errorClass = "infra_cache_miss";
    throw err;
  }
  const content = await fetchRepoFile(
    args.octokit,
    args.credential,
    args.path,
    args.sha,
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: args.options.bucket,
      Key: key,
      Body: content,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
  await args.db
    .insert(routineCodeCache)
    .values({
      tenant_id: args.routine.tenant_id,
      routine_id: args.routine.id,
      sha: args.sha,
      s3_key: cachePrefix(args.routine, args.sha),
    })
    .onConflictDoNothing();
  return content;
}

async function loadModuleCode(args: {
  routine: {
    tenant_id: string;
    id: string;
    module_path: string | null;
  };
  sha: string;
  credential: RepoCredential;
  octokit: Octokit | null;
  db: ReturnType<typeof getDb>;
  options: RoutineExecGitOptions;
}): Promise<string> {
  return loadFileCached({
    routine: { tenant_id: args.routine.tenant_id, id: args.routine.id },
    path: args.routine.module_path!,
    sha: args.sha,
    credential: args.credential,
    octokit: args.octokit,
    db: args.db,
    options: args.options,
  });
}

// ---------------------------------------------------------------------------
// Sandbox execution
// ---------------------------------------------------------------------------

/** Wraps the routine module so `run(input)` executes and its return value
 * comes back on stdout behind a marker line. The module keeps the fixed
 * entrypoint contract: `def run(input: dict) -> dict` (R3). */
function buildRunnerCode(moduleCode: string): string {
  return (
    moduleCode +
    "\n\n" +
    "if True:\n" +
    "    import json as __tw_json\n" +
    "    __tw_result = run(input)\n" +
    `    print(${JSON.stringify(RESULT_MARKER)} + __tw_json.dumps(__tw_result, default=str))\n`
  );
}

async function runRoutineModule(args: {
  routine: {
    id: string;
    tenant_id: string;
    credential_refs: unknown;
  };
  moduleCode: string;
  input: unknown;
  executionId: string;
  options: RoutineExecGitOptions;
  gateMode: boolean;
}): Promise<PythonTaskResult> {
  const bindings = Array.isArray(args.routine.credential_refs)
    ? (args.routine.credential_refs as CredentialBindingInput[])
    : [];
  const runInput =
    args.gateMode && args.input && typeof args.input === "object"
      ? { ...(args.input as Record<string, unknown>), [GATE_INPUT_KEY]: true }
      : args.input;

  const taskInput: PythonTaskInput = {
    tenantId: args.routine.tenant_id,
    executionId: args.executionId,
    nodeId: args.gateMode ? "gate" : "run",
    language: "python",
    code: buildRunnerCode(args.moduleCode),
    input: runInput ?? {},
    credentialBindings: bindings,
    timeoutSeconds: EXECUTION_TIMEOUT_SECONDS,
  };
  const runner = args.options.pythonTask ?? invokePythonTask;
  return runner(taskInput, {
    interpreterId: args.options.interpreterId,
    bucket: args.options.bucket,
    envAllowlist: [],
  });
}

function extractResult(task: PythonTaskResult): {
  value: unknown | null;
  found: boolean;
} {
  const idx = task.stdoutPreview.lastIndexOf(RESULT_MARKER);
  if (idx === -1) return { value: null, found: false };
  const line = task.stdoutPreview
    .slice(idx + RESULT_MARKER.length)
    .split("\n")[0];
  try {
    return { value: JSON.parse(line), found: true };
  } catch {
    return { value: null, found: false };
  }
}

// ---------------------------------------------------------------------------
// Fixture gate (U4 — shared by execute-time gating, gate mode, dry_run)
// ---------------------------------------------------------------------------

function parseFixture(path: string, raw: string): FixtureFile {
  const parsed = JSON.parse(raw) as {
    input?: unknown;
    expected?: unknown;
    mode?: string;
    invariantPaths?: string[];
  };
  if (parsed.expected === undefined) {
    throw new Error(`fixture ${path} has no "expected" field`);
  }
  const mode = parsed.mode === "shape" ? "shape" : "exact";
  return {
    path,
    input: parsed.input ?? {},
    expected: parsed.expected,
    mode,
    invariantPaths: Array.isArray(parsed.invariantPaths)
      ? parsed.invariantPaths
      : undefined,
  };
}

/** exact: deep equality. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== "object") return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}

/** shape: every key in `expected` exists in `actual` with a matching
 * structure; primitive leaves match by type, not value — so live external
 * data can change values without failing the gate. Named invariant paths
 * (dot notation) are compared exactly on top (KTD-6). */
export function matchesShape(expected: unknown, actual: unknown): boolean {
  if (expected === null) return true;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    if (expected.length === 0 || actual.length === 0) return true;
    return matchesShape(expected[0], actual[0]);
  }
  if (typeof expected === "object") {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual))
      return false;
    return Object.keys(expected as Record<string, unknown>).every((k) =>
      k in (actual as Record<string, unknown>)
        ? matchesShape(
            (expected as Record<string, unknown>)[k],
            (actual as Record<string, unknown>)[k],
          )
        : false,
    );
  }
  return typeof expected === typeof actual;
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[part];
  }, value);
}

function compareFixture(
  fixture: FixtureFile,
  actual: unknown,
): { passed: boolean; detail?: string } {
  if (fixture.mode === "exact") {
    return deepEqual(fixture.expected, actual)
      ? { passed: true }
      : {
          passed: false,
          detail: `exact mismatch: expected ${JSON.stringify(fixture.expected)?.slice(0, 400)}, got ${JSON.stringify(actual)?.slice(0, 400)}`,
        };
  }
  if (!matchesShape(fixture.expected, actual)) {
    return {
      passed: false,
      detail: `shape mismatch: an expected field is missing or changed type (expected shape of ${JSON.stringify(fixture.expected)?.slice(0, 400)})`,
    };
  }
  for (const path of fixture.invariantPaths ?? []) {
    const want = valueAtPath(fixture.expected, path);
    const got = valueAtPath(actual, path);
    if (!deepEqual(want, got)) {
      return {
        passed: false,
        detail: `invariant field "${path}" changed: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
      };
    }
  }
  return { passed: true };
}

/** Runs the routine's fixtures against files loaded via a provided loader
 * and returns green/red. Zero fixtures → red (R9: no fixture, no use). */
async function runFixtureGate(args: {
  routine: {
    id: string;
    tenant_id: string;
    module_path: string | null;
    fixture_paths: unknown;
    credential_refs: unknown;
  };
  sha: string | null;
  loadFile: (path: string) => Promise<string>;
  options: RoutineExecGitOptions;
}): Promise<GateResult> {
  const fixturePaths = Array.isArray(args.routine.fixture_paths)
    ? (args.routine.fixture_paths as string[])
    : [];
  if (fixturePaths.length === 0) {
    return {
      status: "red",
      sha: args.sha,
      fixtures: [],
      errorClass: "no_fixtures",
      errorMessage:
        "routine has no recorded fixtures — a fixture is required before use (R9)",
    };
  }

  let moduleCode: string;
  try {
    moduleCode = await args.loadFile(args.routine.module_path!);
  } catch (err) {
    return {
      status: "red",
      sha: args.sha,
      fixtures: [],
      errorClass: "module_unreadable",
      errorMessage: (err as Error).message,
    };
  }

  const results: FixtureResult[] = [];
  for (const path of fixturePaths) {
    let fixture: FixtureFile;
    try {
      fixture = parseFixture(path, await args.loadFile(path));
    } catch (err) {
      // Malformed fixture fails safe: red with an actionable error.
      results.push({
        path,
        mode: "exact",
        passed: false,
        detail: `fixture unreadable/malformed: ${(err as Error).message}`,
      });
      continue;
    }

    const gateInput =
      fixture.input && typeof fixture.input === "object"
        ? { ...(fixture.input as Record<string, unknown>) }
        : {};

    const task = await runRoutineModule({
      routine: {
        id: args.routine.id,
        tenant_id: args.routine.tenant_id,
        credential_refs: args.routine.credential_refs,
      },
      moduleCode,
      input: gateInput,
      executionId: `gate-${randomUUID()}`,
      options: args.options,
      gateMode: true,
    });

    if (task.exitCode !== 0 || task.errorClass) {
      results.push({
        path,
        mode: fixture.mode,
        passed: false,
        detail:
          task.errorMessage ?? `run() exited ${task.exitCode} on fixture input`,
      });
      continue;
    }
    const output = extractResult(task);
    if (!output.found) {
      results.push({
        path,
        mode: fixture.mode,
        passed: false,
        detail: "run() produced no parseable result",
      });
      continue;
    }
    results.push({
      path,
      mode: fixture.mode,
      ...compareFixture(fixture, output.value),
    });
  }

  return {
    status: results.every((r) => r.passed) ? "green" : "red",
    sha: args.sha,
    fixtures: results,
  };
}

/** Gate a repo SHA: load files via the S3 read-through cache, run the
 * gate, record the verdict on routine_code_cache, and promote
 * routines.validated_sha on green (the gate is the ONLY writer of the
 * validated pointer, KTD-7). */
async function gateSha(args: {
  routine: {
    id: string;
    tenant_id: string;
    module_path: string | null;
    fixture_paths: unknown;
    credential_refs: unknown;
    validated_sha: string | null;
  };
  sha: string;
  credential: RepoCredential;
  octokit: Octokit;
  db: ReturnType<typeof getDb>;
  options: RoutineExecGitOptions;
}): Promise<GateResult> {
  // Prior verdict for this SHA short-circuits (idempotent gate).
  const [cached] = await args.db
    .select()
    .from(routineCodeCache)
    .where(
      and(
        eq(routineCodeCache.routine_id, args.routine.id),
        eq(routineCodeCache.sha, args.sha),
      ),
    )
    .limit(1);
  if (cached?.fixture_status === "green") {
    return { status: "green", sha: args.sha, fixtures: [] };
  }
  if (cached?.fixture_status === "red") {
    return {
      status: "red",
      sha: args.sha,
      fixtures: [],
      errorMessage: "SHA previously failed its fixture gate",
    };
  }

  const gate = await runFixtureGate({
    routine: args.routine,
    sha: args.sha,
    loadFile: (path) =>
      loadFileCached({
        routine: { tenant_id: args.routine.tenant_id, id: args.routine.id },
        path,
        sha: args.sha,
        credential: args.credential,
        octokit: args.octokit,
        db: args.db,
        options: args.options,
      }),
    options: args.options,
  });

  await args.db
    .insert(routineCodeCache)
    .values({
      tenant_id: args.routine.tenant_id,
      routine_id: args.routine.id,
      sha: args.sha,
      s3_key: cachePrefix(
        { tenant_id: args.routine.tenant_id, id: args.routine.id },
        args.sha,
      ),
      fixture_status: gate.status,
      fixture_result_json: JSON.stringify(gate.fixtures),
      validated_at: gate.status === "green" ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [routineCodeCache.routine_id, routineCodeCache.sha],
      set: {
        fixture_status: gate.status,
        fixture_result_json: JSON.stringify(gate.fixtures),
        validated_at: gate.status === "green" ? new Date() : null,
      },
    });

  if (gate.status === "green") {
    await args.db
      .update(routines)
      .set({ validated_sha: args.sha, updated_at: new Date() })
      .where(eq(routines.id, args.routine.id));
  }
  return gate;
}

/** dry_run: gate inline working files (no repo, no cache, no promotion). */
async function runFixtureGateOnFiles(args: {
  routine: {
    id: string;
    tenant_id: string;
    module_path: string | null;
    fixture_paths: unknown;
    credential_refs: unknown;
  };
  files: Record<string, string>;
  modulePath: string;
  sha: string | null;
  options: RoutineExecGitOptions;
}): Promise<GateResult> {
  // Working fixtures win; declared fixture paths not present inline are
  // ignored (the agent gates exactly what it is about to commit).
  const fixturePaths = Object.keys(args.files).filter(
    (p) => p !== args.modulePath,
  );
  return runFixtureGate({
    routine: {
      id: args.routine.id,
      tenant_id: args.routine.tenant_id,
      module_path: args.modulePath,
      fixture_paths: fixturePaths,
      credential_refs: args.routine.credential_refs,
    },
    sha: args.sha,
    loadFile: async (path) => {
      const content = args.files[path];
      if (content === undefined) {
        throw new Error(`dry_run file ${path} was not provided`);
      }
      return content;
    },
    options: args.options,
  });
}

// ---------------------------------------------------------------------------
// Ledger helpers
// ---------------------------------------------------------------------------

async function terminalUpdate(
  db: ReturnType<typeof getDb>,
  executionId: string,
  set: Record<string, unknown>,
): Promise<void> {
  // Terminal lock: only a live `running` row can be finalized — mirrors
  // routine-execution-callback's idempotency semantics.
  await db
    .update(routineExecutions)
    .set(set)
    .where(
      and(
        eq(routineExecutions.id, executionId),
        eq(routineExecutions.status, "running"),
      ),
    );
}

async function recordInfraFailureRun(
  db: ReturnType<typeof getDb>,
  routine: { id: string; tenant_id: string },
  event: RoutineExecGitInput,
  now: () => Date,
  err: { errorClass: string; errorMessage: string },
): Promise<RoutineExecGitResult> {
  const executionId = randomUUID();
  await db.insert(routineExecutions).values({
    id: executionId,
    tenant_id: routine.tenant_id,
    routine_id: routine.id,
    trigger_id: event.triggerId ?? null,
    trigger_source: event.triggerSource ?? "manual",
    input_json: event.input ?? null,
    status: "failed",
    started_at: now(),
    finished_at: now(),
    error_code: err.errorClass,
    error_message: err.errorMessage,
  });
  return {
    status: "failed",
    executionId,
    errorClass: err.errorClass,
    errorMessage: err.errorMessage,
  };
}

function failResult(
  errorClass: string,
  errorMessage: string,
): RoutineExecGitResult {
  return { status: "failed", errorClass, errorMessage };
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export async function handler(
  event: RoutineExecGitInput,
): Promise<RoutineExecGitResult> {
  // Snapshot env at handler entry; never re-read in async paths.
  const interpreterId = process.env.SANDBOX_INTERPRETER_ID ?? "";
  const bucket = process.env.ROUTINE_OUTPUT_BUCKET ?? "";
  if (!interpreterId || !bucket) {
    return failResult(
      "infra_misconfigured",
      !interpreterId
        ? "SANDBOX_INTERPRETER_ID env var is not set"
        : "ROUTINE_OUTPUT_BUCKET env var is not set",
    );
  }
  if (!event?.routineId) {
    return failResult("infra_bad_input", "routineId is required");
  }
  return executeGitRoutine(event, { interpreterId, bucket });
}
