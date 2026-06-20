import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { n8nAgentStepRuns } from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import {
  createSecretsManagerPluginSecrets,
  type PluginSecretsClient,
} from "../plugins/secrets.js";

type DbLike = typeof defaultDb;
type RunRow = typeof n8nAgentStepRuns.$inferSelect;
type FetchLike = typeof fetch;

export interface N8nAgentStepResumeDeps {
  db?: DbLike;
  secrets?: PluginSecretsClient;
  fetch?: FetchLike;
  now?: () => Date;
  maxAttempts?: number;
  callbackTimeoutMs?: number;
}

export interface N8nAgentStepResumeResult {
  runId: string;
  action: "not_ready" | "resumed" | "retry_scheduled" | "resume_failed";
  httpStatus?: number | null;
  error?: string | null;
}

export interface N8nAgentStepSweepResult {
  resumeAttempted: number;
  resumed: number;
  retryScheduled: number;
  resumeFailed: number;
  expiredQueued: number;
}

const ACTIVE_EXPIRY_STATUSES = ["accepted", "waiting", "awaiting_human"];
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_CALLBACK_TIMEOUT_MS = 8_000;

export async function resumeN8nAgentStepRun(
  input: { tenantId: string; runId: string },
  deps: N8nAgentStepResumeDeps = {},
): Promise<N8nAgentStepResumeResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now?.() ?? new Date();
  const [run] = await db
    .update(n8nAgentStepRuns)
    .set({
      status: "resuming",
      resume_status: "resuming",
      last_resume_attempt_at: now,
      resume_attempt_count: sql`${n8nAgentStepRuns.resume_attempt_count} + 1`,
      updated_at: now,
    })
    .where(
      and(
        eq(n8nAgentStepRuns.tenant_id, input.tenantId),
        eq(n8nAgentStepRuns.id, input.runId),
        eq(n8nAgentStepRuns.status, "resume_pending"),
        or(
          isNull(n8nAgentStepRuns.next_resume_attempt_at),
          lte(n8nAgentStepRuns.next_resume_attempt_at, now),
        ),
      ),
    )
    .returning();

  if (!run) {
    return { runId: input.runId, action: "not_ready" };
  }

  const resumeUrlResult = await loadResumeUrl(run, deps);
  if (!resumeUrlResult.ok) {
    return markResumeFailed({
      db,
      run,
      now,
      error: resumeUrlResult.error,
      httpStatus: null,
    });
  }

  const payload = resumePayloadForRun(run);
  try {
    const response = await postResumePayload(
      resumeUrlResult.resumeUrl,
      payload,
      deps,
    );
    if (response.status >= 200 && response.status < 300) {
      await db
        .update(n8nAgentStepRuns)
        .set({
          status: "resumed",
          resume_status: "resumed",
          last_resume_http_status: response.status,
          last_resume_error: null,
          resumed_at: now,
          terminal_at: now,
          updated_at: now,
        })
        .where(eq(n8nAgentStepRuns.id, run.id));
      return { runId: run.id, action: "resumed", httpStatus: response.status };
    }

    const responseText = await safeResponseText(response);
    const error = `n8n resume returned HTTP ${response.status}${responseText ? `: ${responseText}` : ""}`;
    if (response.status >= 500) {
      return scheduleRetryOrFail({
        db,
        run,
        now,
        httpStatus: response.status,
        error,
        maxAttempts: deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      });
    }
    return markResumeFailed({
      db,
      run,
      now,
      httpStatus: response.status,
      error,
    });
  } catch (err) {
    return scheduleRetryOrFail({
      db,
      run,
      now,
      httpStatus: null,
      error: err instanceof Error ? err.message : String(err),
      maxAttempts: deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    });
  }
}

async function postResumePayload(
  resumeUrl: string,
  payload: Record<string, unknown>,
  deps: N8nAgentStepResumeDeps,
): Promise<Response> {
  const timeoutMs = deps.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await (deps.fetch ?? fetch)(resumeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function sweepN8nAgentStepRuns(
  input: { limit?: number } = {},
  deps: N8nAgentStepResumeDeps = {},
): Promise<N8nAgentStepSweepResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now?.() ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const result: N8nAgentStepSweepResult = {
    resumeAttempted: 0,
    resumed: 0,
    retryScheduled: 0,
    resumeFailed: 0,
    expiredQueued: 0,
  };

  const expired = await findExpiredRuns(db, now, limit);
  for (const run of expired) {
    const queued = await queueExpiredRun({ db, run, now });
    if (queued) result.expiredQueued += 1;
  }

  const due = await findDueResumeRuns(db, now, limit);
  for (const run of due) {
    result.resumeAttempted += 1;
    const delivered = await resumeN8nAgentStepRun(
      { tenantId: run.tenant_id, runId: run.id },
      { ...deps, db, now: () => now },
    );
    if (delivered.action === "resumed") result.resumed += 1;
    if (delivered.action === "retry_scheduled") result.retryScheduled += 1;
    if (delivered.action === "resume_failed") result.resumeFailed += 1;
  }

  return result;
}

async function findExpiredRuns(
  db: DbLike,
  now: Date,
  limit: number,
): Promise<RunRow[]> {
  return db
    .select()
    .from(n8nAgentStepRuns)
    .where(
      and(
        inArray(n8nAgentStepRuns.status, ACTIVE_EXPIRY_STATUSES),
        lte(n8nAgentStepRuns.expires_at, now),
      ),
    )
    .orderBy(asc(n8nAgentStepRuns.expires_at))
    .limit(limit);
}

async function findDueResumeRuns(
  db: DbLike,
  now: Date,
  limit: number,
): Promise<RunRow[]> {
  return db
    .select()
    .from(n8nAgentStepRuns)
    .where(
      and(
        eq(n8nAgentStepRuns.status, "resume_pending"),
        or(
          isNull(n8nAgentStepRuns.next_resume_attempt_at),
          lte(n8nAgentStepRuns.next_resume_attempt_at, now),
        ),
      ),
    )
    .orderBy(asc(n8nAgentStepRuns.next_resume_attempt_at))
    .limit(limit);
}

async function queueExpiredRun(input: {
  db: DbLike;
  run: RunRow;
  now: Date;
}): Promise<boolean> {
  const summary = "ThinkWork agent step expired before completion.";
  const resultPayload = {
    status: "expired",
    runId: input.run.id,
    threadId: input.run.thread_id,
    correlationId: input.run.correlation_id,
    output: null,
    error: { message: summary },
    summary,
    links: input.run.links ?? {},
  };
  const [updated] = await input.db
    .update(n8nAgentStepRuns)
    .set({
      status: "resume_pending",
      resume_status: "pending",
      result_payload: resultPayload,
      output_payload: null,
      error_payload: { message: summary },
      summary,
      next_resume_attempt_at: input.now,
      updated_at: input.now,
    })
    .where(
      and(
        eq(n8nAgentStepRuns.id, input.run.id),
        eq(n8nAgentStepRuns.tenant_id, input.run.tenant_id),
        inArray(n8nAgentStepRuns.status, ACTIVE_EXPIRY_STATUSES),
        lte(n8nAgentStepRuns.expires_at, input.now),
      ),
    )
    .returning({ id: n8nAgentStepRuns.id });
  return Boolean(updated?.id);
}

async function loadResumeUrl(
  run: RunRow,
  deps: N8nAgentStepResumeDeps,
): Promise<{ ok: true; resumeUrl: string } | { ok: false; error: string }> {
  if (!run.resume_url_secret_ref) {
    return { ok: false, error: "Bridge run has no resume URL secret ref" };
  }
  const secrets = deps.secrets ?? createSecretsManagerPluginSecrets();
  const secret = await secrets.getSecret(run.resume_url_secret_ref);
  if (!secret) {
    return { ok: false, error: "Bridge run resume URL secret was not found" };
  }
  try {
    const parsed = JSON.parse(secret) as { resumeUrl?: unknown };
    if (typeof parsed.resumeUrl === "string" && parsed.resumeUrl) {
      return { ok: true, resumeUrl: parsed.resumeUrl };
    }
  } catch {}
  return { ok: false, error: "Bridge run resume URL secret is malformed" };
}

function resumePayloadForRun(run: RunRow): Record<string, unknown> {
  if (run.result_payload && typeof run.result_payload === "object") {
    return run.result_payload;
  }
  return {
    status: "failed",
    runId: run.id,
    threadId: run.thread_id,
    correlationId: run.correlation_id,
    output: null,
    error: { message: "ThinkWork bridge run had no result payload." },
    summary: run.summary ?? "ThinkWork bridge run had no result payload.",
    links: run.links ?? {},
  };
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

async function scheduleRetryOrFail(input: {
  db: DbLike;
  run: RunRow;
  now: Date;
  httpStatus: number | null;
  error: string;
  maxAttempts: number;
}): Promise<N8nAgentStepResumeResult> {
  if (input.run.resume_attempt_count >= input.maxAttempts) {
    return markResumeFailed(input);
  }
  const nextAttempt = new Date(
    input.now.getTime() + retryDelayMs(input.run.resume_attempt_count),
  );
  await input.db
    .update(n8nAgentStepRuns)
    .set({
      status: "resume_pending",
      resume_status: "pending",
      next_resume_attempt_at: nextAttempt,
      last_resume_http_status: input.httpStatus,
      last_resume_error: input.error.slice(0, 1000),
      updated_at: input.now,
    })
    .where(eq(n8nAgentStepRuns.id, input.run.id));
  return {
    runId: input.run.id,
    action: "retry_scheduled",
    httpStatus: input.httpStatus,
    error: input.error,
  };
}

async function markResumeFailed(input: {
  db: DbLike;
  run: RunRow;
  now: Date;
  httpStatus: number | null;
  error: string;
}): Promise<N8nAgentStepResumeResult> {
  await input.db
    .update(n8nAgentStepRuns)
    .set({
      status: "resume_failed",
      resume_status: "failed",
      last_resume_http_status: input.httpStatus,
      last_resume_error: input.error.slice(0, 1000),
      terminal_at: input.now,
      updated_at: input.now,
    })
    .where(eq(n8nAgentStepRuns.id, input.run.id));
  return {
    runId: input.run.id,
    action: "resume_failed",
    httpStatus: input.httpStatus,
    error: input.error,
  };
}

function retryDelayMs(attemptCountBeforeClaim: number): number {
  const seconds = Math.min(
    60 * 60,
    60 * 2 ** Math.max(0, attemptCountBeforeClaim),
  );
  return seconds * 1000;
}
