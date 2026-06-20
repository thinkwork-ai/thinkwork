import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getConfig } from "@thinkwork/runtime-config";
import {
  agentWakeupRequests,
  n8nAgentStepRuns,
  pendingUserQuestions,
  threadTurns,
  threads,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import { previewN8nAgentStepValue } from "./types.js";

type DbLike = typeof defaultDb;
type BridgeRun = typeof n8nAgentStepRuns.$inferSelect;

export type N8nAgentStepFinalizeResolution =
  | "turn_completed"
  | "turn_failed"
  | "human_input_resolved"
  | "thread_status_changed";

export interface FinalizeN8nAgentStepRunInput {
  tenantId: string;
  threadId: string;
  threadTurnId?: string | null;
  resolution: N8nAgentStepFinalizeResolution;
  summary?: string | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
}

export interface FinalizeN8nAgentStepRunResult {
  action: "no_run" | "noop" | "awaiting_human" | "waiting" | "resume_pending";
  runId: string | null;
  status: string | null;
}

export interface FinalizeN8nAgentStepRunDeps {
  db?: DbLike;
  now?: () => Date;
  appUrl?: string | null;
}

const ACTIVE_RUN_STATUSES = ["accepted", "waiting", "awaiting_human"] as const;
const TERMINAL_OR_DELIVERY_STATUSES = new Set([
  "resume_pending",
  "resuming",
  "resumed",
  "resume_failed",
  "failed",
  "expired",
]);
const THREAD_HOLD_STATUSES = new Set(["in_review", "blocked"]);

export async function finalizeN8nAgentStepRun(
  input: FinalizeN8nAgentStepRunInput,
  deps: FinalizeN8nAgentStepRunDeps = {},
): Promise<FinalizeN8nAgentStepRunResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now?.() ?? new Date();
  const run = await findBridgeRun(db, input);
  if (!run) return { action: "no_run", runId: null, status: null };
  if (TERMINAL_OR_DELIVERY_STATUSES.has(run.status)) {
    return { action: "noop", runId: run.id, status: run.status };
  }

  const thread = await loadThread(db, input);
  const threadStatus = String(thread?.status ?? "").toLowerCase();
  const pendingQuestion = await hasPendingQuestion(db, input);
  const activeHumanResumeWakeup = await hasActiveHumanResumeWakeup(db, input);
  const turn = input.threadTurnId
    ? await loadThreadTurn(db, input)
    : { status: null, error: null, result: null };

  if (input.resolution === "turn_failed") {
    return markResumePending({
      db,
      run,
      input,
      now,
      status: "failed",
      summary:
        input.summary ??
        input.error ??
        turn.error ??
        "ThinkWork agent step failed.",
      output: null,
      error: input.error ?? turn.error ?? "ThinkWork agent step failed.",
      appUrl: deps.appUrl,
    });
  }

  if (pendingQuestion || THREAD_HOLD_STATUSES.has(threadStatus)) {
    return markAwaitingHuman({
      db,
      run,
      now,
      threadTurnId: input.threadTurnId ?? run.thread_turn_id,
      summary: pendingQuestion
        ? "ThinkWork is waiting for human input."
        : `ThinkWork thread is ${threadStatus.replace("_", " ")}.`,
      appUrl: deps.appUrl,
    });
  }

  if (input.resolution === "human_input_resolved") {
    return markWaiting({
      db,
      run,
      now,
      summary: "Human input resolved; waiting for the resumed agent turn.",
      appUrl: deps.appUrl,
    });
  }

  if (input.resolution === "thread_status_changed") {
    if (threadStatus === "done") {
      return markResumePending({
        db,
        run,
        input,
        now,
        status: "succeeded",
        summary:
          input.summary ??
          thread?.last_response_preview ??
          "ThinkWork thread completed.",
        output:
          input.output ??
          outputFromTurnResult(turn.result) ??
          outputFromSummary(thread?.last_response_preview),
        error: null,
        appUrl: deps.appUrl,
      });
    }
    if (threadStatus === "cancelled") {
      return markResumePending({
        db,
        run,
        input,
        now,
        status: "failed",
        summary: input.summary ?? "ThinkWork thread was cancelled.",
        output: null,
        error: input.error ?? "ThinkWork thread was cancelled.",
        appUrl: deps.appUrl,
      });
    }
    return { action: "noop", runId: run.id, status: run.status };
  }

  if (activeHumanResumeWakeup) {
    return markWaiting({
      db,
      run,
      now,
      summary: "Human input resolved; waiting for the resumed agent turn.",
      appUrl: deps.appUrl,
    });
  }

  const summary =
    input.summary ??
    responseFromTurnResult(turn.result) ??
    thread?.last_response_preview ??
    "ThinkWork agent step completed.";
  return markResumePending({
    db,
    run,
    input,
    now,
    status: "succeeded",
    summary,
    output:
      input.output ??
      outputFromTurnResult(turn.result) ??
      outputFromSummary(summary),
    error: null,
    appUrl: deps.appUrl,
  });
}

async function findBridgeRun(
  db: DbLike,
  input: FinalizeN8nAgentStepRunInput,
): Promise<BridgeRun | null> {
  if (input.threadTurnId) {
    const [run] = await db
      .select()
      .from(n8nAgentStepRuns)
      .where(
        and(
          eq(n8nAgentStepRuns.tenant_id, input.tenantId),
          eq(n8nAgentStepRuns.thread_turn_id, input.threadTurnId),
        ),
      )
      .orderBy(desc(n8nAgentStepRuns.created_at))
      .limit(1);
    if (run) return run;
  }

  const [run] = await db
    .select()
    .from(n8nAgentStepRuns)
    .where(
      and(
        eq(n8nAgentStepRuns.tenant_id, input.tenantId),
        eq(n8nAgentStepRuns.thread_id, input.threadId),
        inArray(n8nAgentStepRuns.status, [...ACTIVE_RUN_STATUSES]),
      ),
    )
    .orderBy(desc(n8nAgentStepRuns.created_at))
    .limit(1);
  return run ?? null;
}

async function loadThread(
  db: DbLike,
  input: FinalizeN8nAgentStepRunInput,
): Promise<{ status: string; last_response_preview: string | null } | null> {
  const [thread] = await db
    .select({
      status: threads.status,
      last_response_preview: threads.last_response_preview,
    })
    .from(threads)
    .where(
      and(
        eq(threads.tenant_id, input.tenantId),
        eq(threads.id, input.threadId),
      ),
    )
    .limit(1);
  return thread ?? null;
}

async function loadThreadTurn(
  db: DbLike,
  input: FinalizeN8nAgentStepRunInput,
): Promise<{
  status: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
}> {
  const threadTurnId = input.threadTurnId;
  if (!threadTurnId) return { status: null, error: null, result: null };

  const [turn] = await db
    .select({
      status: threadTurns.status,
      error: threadTurns.error,
      result: threadTurns.result_json,
    })
    .from(threadTurns)
    .where(
      and(
        eq(threadTurns.tenant_id, input.tenantId),
        eq(threadTurns.id, threadTurnId),
      ),
    )
    .limit(1);
  return {
    status: typeof turn?.status === "string" ? turn.status : null,
    error: typeof turn?.error === "string" ? turn.error : null,
    result: recordOrNull(turn?.result),
  };
}

async function hasPendingQuestion(
  db: DbLike,
  input: FinalizeN8nAgentStepRunInput,
): Promise<boolean> {
  const [question] = await db
    .select({ id: pendingUserQuestions.id })
    .from(pendingUserQuestions)
    .where(
      and(
        eq(pendingUserQuestions.tenant_id, input.tenantId),
        eq(pendingUserQuestions.thread_id, input.threadId),
        eq(pendingUserQuestions.status, "pending"),
      ),
    )
    .limit(1);
  return Boolean(question?.id);
}

async function hasActiveHumanResumeWakeup(
  db: DbLike,
  input: FinalizeN8nAgentStepRunInput,
): Promise<boolean> {
  const [wakeup] = await db
    .select({ id: agentWakeupRequests.id })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.tenant_id, input.tenantId),
        eq(agentWakeupRequests.source, "question_answer"),
        inArray(agentWakeupRequests.status, ["queued", "running", "deferred"]),
        sql`${agentWakeupRequests.payload}->>'threadId' = ${input.threadId}`,
      ),
    )
    .limit(1);
  return Boolean(wakeup?.id);
}

async function markAwaitingHuman(input: {
  db: DbLike;
  run: BridgeRun;
  now: Date;
  threadTurnId?: string | null;
  summary: string;
  appUrl?: string | null;
}): Promise<FinalizeN8nAgentStepRunResult> {
  const [updated] = await input.db
    .update(n8nAgentStepRuns)
    .set({
      status: "awaiting_human",
      resume_status: "not_ready",
      thread_turn_id: input.threadTurnId ?? input.run.thread_turn_id,
      summary: input.summary,
      links: bridgeLinks(input.run, input.threadTurnId ?? null, input.appUrl),
      updated_at: input.now,
    })
    .where(activeRunWhere(input.run))
    .returning({ id: n8nAgentStepRuns.id, status: n8nAgentStepRuns.status });
  return {
    action: updated ? "awaiting_human" : "noop",
    runId: input.run.id,
    status: updated?.status ?? input.run.status,
  };
}

async function markWaiting(input: {
  db: DbLike;
  run: BridgeRun;
  now: Date;
  summary: string;
  appUrl?: string | null;
}): Promise<FinalizeN8nAgentStepRunResult> {
  const [updated] = await input.db
    .update(n8nAgentStepRuns)
    .set({
      status: "waiting",
      resume_status: "not_ready",
      summary: input.summary,
      links: bridgeLinks(input.run, input.run.thread_turn_id, input.appUrl),
      updated_at: input.now,
    })
    .where(activeRunWhere(input.run))
    .returning({ id: n8nAgentStepRuns.id, status: n8nAgentStepRuns.status });
  return {
    action: updated ? "waiting" : "noop",
    runId: input.run.id,
    status: updated?.status ?? input.run.status,
  };
}

async function markResumePending(input: {
  db: DbLike;
  run: BridgeRun;
  input: FinalizeN8nAgentStepRunInput;
  now: Date;
  status: "succeeded" | "failed";
  summary: string;
  output: Record<string, unknown> | null;
  error: string | null;
  appUrl?: string | null;
}): Promise<FinalizeN8nAgentStepRunResult> {
  const links = bridgeLinks(
    input.run,
    input.input.threadTurnId ?? input.run.thread_turn_id,
    input.appUrl,
  );
  const resultPayload = {
    status: input.status,
    runId: input.run.id,
    threadId: input.run.thread_id,
    correlationId: input.run.correlation_id,
    output: input.output,
    error: input.error ? { message: input.error } : null,
    summary: previewN8nAgentStepValue(input.summary).slice(0, 1000),
    links,
  };
  const [updated] = await input.db
    .update(n8nAgentStepRuns)
    .set({
      status: "resume_pending",
      resume_status: "pending",
      thread_turn_id: input.input.threadTurnId ?? input.run.thread_turn_id,
      result_payload: resultPayload,
      output_payload: input.output,
      error_payload: input.error ? { message: input.error } : null,
      summary: resultPayload.summary,
      links,
      next_resume_attempt_at: input.now,
      updated_at: input.now,
    })
    .where(activeRunWhere(input.run))
    .returning({ id: n8nAgentStepRuns.id, status: n8nAgentStepRuns.status });
  return {
    action: updated ? "resume_pending" : "noop",
    runId: input.run.id,
    status: updated?.status ?? input.run.status,
  };
}

function activeRunWhere(run: BridgeRun) {
  return and(
    eq(n8nAgentStepRuns.id, run.id),
    eq(n8nAgentStepRuns.tenant_id, run.tenant_id),
    inArray(n8nAgentStepRuns.status, [...ACTIVE_RUN_STATUSES]),
  );
}

function bridgeLinks(
  run: BridgeRun,
  threadTurnId: string | null | undefined,
  appUrl?: string | null,
): Record<string, string> {
  const origin = normalizeAppUrl(
    appUrl ?? getConfig("ADMIN_URL", "") ?? process.env.APP_URL,
  );
  const threadPath = run.thread_id ? `/threads/${run.thread_id}` : "/threads";
  return {
    thread: `${origin}${threadPath}`,
    trace:
      run.thread_id && threadTurnId
        ? `${origin}${threadPath}?turn=${threadTurnId}`
        : `${origin}${threadPath}`,
  };
}

function normalizeAppUrl(value: string | null | undefined): string {
  const fallback = "https://app.thinkwork.ai";
  if (!value) return fallback;
  return value.replace(/\/+$/, "") || fallback;
}

function responseFromTurnResult(
  result: Record<string, unknown> | null,
): string | null {
  const response = result?.response;
  return typeof response === "string" && response.trim()
    ? response.trim()
    : null;
}

function outputFromTurnResult(
  result: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const response = responseFromTurnResult(result);
  if (!response) return null;
  return { response };
}

function outputFromSummary(
  summary: string | null | undefined,
): Record<string, unknown> | null {
  return summary ? { response: summary } : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
