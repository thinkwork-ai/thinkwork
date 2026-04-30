import { createHash } from "node:crypto";
import { HeadObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import {
  agentWakeupRequests,
  agentWorkspaceEvents,
  agentWorkspaceRuns,
  and,
  db as defaultDb,
  desc,
  eq,
  threadTurns,
} from "../../graphql/utils.js";
import {
  applyBrainEnrichmentWorkspaceReview,
  cancelBrainEnrichmentWorkspaceReview,
  isBrainEnrichmentReviewPayload,
} from "../brain/enrichment-apply.js";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

export type WorkspaceReviewDecision = "accepted" | "cancelled" | "resumed";

export interface WorkspaceReviewDecisionInput {
  notes?: string | null;
  idempotencyKey?: string | null;
  expectedReviewEtag?: string | null;
  responseMarkdown?: string | null;
}

interface WorkspaceRunRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  target_path: string;
  status: string;
  current_wakeup_request_id: string | null;
  current_thread_turn_id: string | null;
  completed_at?: Date | null;
  last_event_at?: Date;
  updated_at?: Date;
}

interface WorkspaceEventRow {
  id: number;
  tenant_id: string;
  agent_id: string | null;
  run_id: string | null;
  event_type: string;
  bucket: string;
  source_object_key: string;
  object_etag: string | null;
  reason: string | null;
  payload: unknown;
  created_at: Date;
}

interface WakeupRequestRow {
  id: string;
  status: string;
}

interface WorkspaceEventInsert {
  tenant_id: string;
  agent_id: string;
  run_id: string;
  event_type: string;
  idempotency_key: string;
  bucket: string;
  source_object_key: string;
  sequencer: string;
  reason: string;
  payload: Record<string, unknown>;
  actor_type: string;
  actor_id: string | null;
}

interface WakeupInsert {
  tenant_id: string;
  agent_id: string;
  source: string;
  trigger_detail: string;
  reason: string;
  payload: Record<string, unknown>;
  status: string;
  idempotency_key: string;
  requested_by_actor_type: string;
  requested_by_actor_id: string | null;
}

export interface WorkspaceReviewActionStore {
  findRunById(runId: string): Promise<WorkspaceRunRow | null>;
  findLatestReviewEvent(
    runId: string,
    tenantId: string,
  ): Promise<WorkspaceEventRow | null>;
  findEventByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<WorkspaceEventRow | null>;
  findWakeupById(
    tenantId: string,
    wakeupId: string,
  ): Promise<WakeupRequestRow | null>;
  findThreadIdForTurn(
    tenantId: string,
    threadTurnId: string,
  ): Promise<string | null>;
  headReviewObject(event: WorkspaceEventRow): Promise<{ etag: string | null }>;
  insertEvent(values: WorkspaceEventInsert): Promise<{ id: number } | null>;
  updateRun(
    runId: string,
    tenantId: string,
    updates: Partial<WorkspaceRunRow>,
  ): Promise<WorkspaceRunRow | null>;
  insertWakeup(values: WakeupInsert): Promise<{ id: string }>;
  updateRunWakeup(
    runId: string,
    tenantId: string,
    wakeupRequestId: string,
  ): Promise<void>;
}

export interface WorkspaceReviewActionResult {
  run: WorkspaceRunRow;
  eventId?: number;
  wakeupRequestId?: string;
  duplicate: boolean;
}

export class WorkspaceReviewActionError extends Error {
  constructor(
    message: string,
    readonly code: "CONFLICT" | "NOT_FOUND" | "BAD_USER_INPUT",
  ) {
    super(message);
  }
}

export async function decideWorkspaceReview(
  input: {
    runId: string;
    decision: WorkspaceReviewDecision;
    actorId: string | null;
    values?: WorkspaceReviewDecisionInput | null;
  },
  deps: {
    store?: WorkspaceReviewActionStore;
    now?: () => Date;
    logger?: Pick<Console, "warn">;
  } = {},
): Promise<WorkspaceReviewActionResult | null> {
  const store = deps.store ?? createDrizzleWorkspaceReviewActionStore();
  const logger = deps.logger ?? console;
  const now = deps.now ?? (() => new Date());
  const run = await store.findRunById(input.runId);
  if (!run) return null;

  const idempotencyKey =
    input.values?.idempotencyKey ??
    workspaceReviewDecisionIdempotencyKey(run.id, input.decision, input.values);
  const existingEvent = await store.findEventByIdempotencyKey(
    run.tenant_id,
    idempotencyKey,
  );
  if (existingEvent?.run_id === run.id) {
    logger.warn("[workspace-review-action] duplicate_decision", {
      runId: run.id,
      decision: input.decision,
      idempotencyKey,
    });
    return { run, eventId: existingEvent.id, duplicate: true };
  }

  await validateDecisionState(input.decision, run, store);
  const latestReviewEvent = await store.findLatestReviewEvent(
    run.id,
    run.tenant_id,
  );
  await assertExpectedReviewEtag(
    latestReviewEvent,
    input.values?.expectedReviewEtag,
    store,
  );

  const eventType =
    input.decision === "cancelled" ? "run.failed" : "review.responded";
  const reason =
    input.decision === "cancelled"
      ? "review_cancelled"
      : `review_${input.decision}`;
  const event = await store.insertEvent({
    tenant_id: run.tenant_id,
    agent_id: run.agent_id,
    run_id: run.id,
    event_type: eventType,
    idempotency_key: idempotencyKey,
    bucket: "graphql",
    source_object_key: `graphql://workspace-review/${run.id}/${input.decision}`,
    sequencer: idempotencyKey,
    reason,
    payload: {
      decision: input.decision,
      notes: input.values?.notes ?? null,
      responseMarkdown: input.values?.responseMarkdown ?? null,
      targetPath: run.target_path,
      reviewObjectKey: latestReviewEvent?.source_object_key ?? null,
      reviewEtag: latestReviewEvent?.object_etag ?? null,
    },
    actor_type: "user",
    actor_id: input.actorId,
  });
  if (!event) {
    logger.warn("[workspace-review-action] duplicate_decision_insert", {
      runId: run.id,
      decision: input.decision,
      idempotencyKey,
    });
    return { run, duplicate: true };
  }

  const threadId = run.current_thread_turn_id
    ? await store.findThreadIdForTurn(run.tenant_id, run.current_thread_turn_id)
    : null;
  const isBrainEnrichment = isBrainEnrichmentReviewPayload(
    latestReviewEvent?.payload,
  );
  if (isBrainEnrichment && input.decision !== "resumed") {
    const timestamp = now();
    const nextStatus =
      input.decision === "cancelled" ? "cancelled" : "completed";
    const updatedRun = await store.updateRun(run.id, run.tenant_id, {
      status: nextStatus,
      last_event_at: timestamp,
      completed_at: timestamp,
      updated_at: timestamp,
    });
    if (!updatedRun) {
      throw new WorkspaceReviewActionError(
        "Workspace run update failed",
        "CONFLICT",
      );
    }
    if (input.decision === "accepted") {
      await applyBrainEnrichmentWorkspaceReview({
        payload: latestReviewEvent?.payload,
        responseMarkdown: input.values?.responseMarkdown,
        tenantId: run.tenant_id,
        threadId,
        turnId: run.current_thread_turn_id,
        reviewerId: input.actorId,
      });
    } else {
      await cancelBrainEnrichmentWorkspaceReview({
        payload: latestReviewEvent?.payload,
        tenantId: run.tenant_id,
        threadId,
        turnId: run.current_thread_turn_id,
        reviewerId: input.actorId,
      });
    }
    return { run: updatedRun, eventId: event.id, duplicate: false };
  }

  const nextStatus = input.decision === "cancelled" ? "cancelled" : "pending";
  const timestamp = now();
  const updatedRun = await store.updateRun(run.id, run.tenant_id, {
    status: nextStatus,
    last_event_at: timestamp,
    completed_at: input.decision === "cancelled" ? timestamp : null,
    updated_at: timestamp,
  });
  if (!updatedRun) {
    throw new WorkspaceReviewActionError(
      "Workspace run update failed",
      "CONFLICT",
    );
  }

  if (input.decision === "cancelled") {
    return { run: updatedRun, eventId: event.id, duplicate: false };
  }

  const wakeup = await store.insertWakeup({
    tenant_id: run.tenant_id,
    agent_id: run.agent_id,
    source: "workspace_event",
    trigger_detail: `workspace_event:${event.id}`,
    reason: `Workspace review ${input.decision}`,
    payload: {
      workspaceRunId: run.id,
      workspaceEventId: event.id,
      workspaceTargetPath: run.target_path,
      workspaceSourceObjectKey: latestReviewEvent?.source_object_key ?? null,
      workspaceRequestObjectKey: latestReviewEvent?.source_object_key ?? null,
      targetPath: run.target_path,
      decision: input.decision,
      notes: input.values?.notes ?? null,
      responseMarkdown: input.values?.responseMarkdown ?? null,
      threadId,
      causeType: "review.responded",
    },
    status: "queued",
    idempotency_key: idempotencyKey,
    requested_by_actor_type: "user",
    requested_by_actor_id: input.actorId,
  });
  await store.updateRunWakeup(run.id, run.tenant_id, wakeup.id);
  return {
    run: { ...updatedRun, current_wakeup_request_id: wakeup.id },
    eventId: event.id,
    wakeupRequestId: wakeup.id,
    duplicate: false,
  };
}

export function workspaceReviewDecisionIdempotencyKey(
  runId: string,
  decision: WorkspaceReviewDecision,
  input?: WorkspaceReviewDecisionInput | null,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        runId,
        decision,
        notes: input?.notes ?? "",
        responseMarkdown: input?.responseMarkdown ?? "",
      }),
    )
    .digest("hex");
}

export function createDrizzleWorkspaceReviewActionStore(
  database = defaultDb,
  s3 = new S3Client({ region: REGION }),
): WorkspaceReviewActionStore {
  return {
    async findRunById(runId) {
      const [run] = await database
        .select()
        .from(agentWorkspaceRuns)
        .where(eq(agentWorkspaceRuns.id, runId))
        .limit(1);
      return (run as WorkspaceRunRow | undefined) ?? null;
    },
    async findLatestReviewEvent(runId, tenantId) {
      const [event] = await database
        .select()
        .from(agentWorkspaceEvents)
        .where(
          and(
            eq(agentWorkspaceEvents.tenant_id, tenantId),
            eq(agentWorkspaceEvents.run_id, runId),
            eq(agentWorkspaceEvents.event_type, "review.requested"),
          ),
        )
        .orderBy(desc(agentWorkspaceEvents.created_at))
        .limit(1);
      return (event as WorkspaceEventRow | undefined) ?? null;
    },
    async findEventByIdempotencyKey(tenantId, idempotencyKey) {
      const [event] = await database
        .select()
        .from(agentWorkspaceEvents)
        .where(
          and(
            eq(agentWorkspaceEvents.tenant_id, tenantId),
            eq(agentWorkspaceEvents.idempotency_key, idempotencyKey),
          ),
        )
        .limit(1);
      return (event as WorkspaceEventRow | undefined) ?? null;
    },
    async findWakeupById(tenantId, wakeupId) {
      const [wakeup] = await database
        .select({
          id: agentWakeupRequests.id,
          status: agentWakeupRequests.status,
        })
        .from(agentWakeupRequests)
        .where(
          and(
            eq(agentWakeupRequests.tenant_id, tenantId),
            eq(agentWakeupRequests.id, wakeupId),
          ),
        )
        .limit(1);
      return wakeup ?? null;
    },
    async findThreadIdForTurn(tenantId, threadTurnId) {
      const [turn] = await database
        .select({ thread_id: threadTurns.thread_id })
        .from(threadTurns)
        .where(
          and(
            eq(threadTurns.tenant_id, tenantId),
            eq(threadTurns.id, threadTurnId),
          ),
        )
        .limit(1);
      return turn?.thread_id ?? null;
    },
    async headReviewObject(event) {
      try {
        const response = await s3.send(
          new HeadObjectCommand({
            Bucket: event.bucket,
            Key: event.source_object_key,
          }),
        );
        return { etag: response.ETag ?? event.object_etag };
      } catch (err) {
        if (isNoSuchKey(err)) {
          throw new WorkspaceReviewActionError(
            "Review file no longer exists",
            "NOT_FOUND",
          );
        }
        throw err;
      }
    },
    async insertEvent(values) {
      const [event] = await database
        .insert(agentWorkspaceEvents)
        .values(values)
        .onConflictDoNothing({
          target: [
            agentWorkspaceEvents.tenant_id,
            agentWorkspaceEvents.idempotency_key,
          ],
        })
        .returning({ id: agentWorkspaceEvents.id });
      return event ?? null;
    },
    async updateRun(runId, tenantId, updates) {
      const [run] = await database
        .update(agentWorkspaceRuns)
        .set(updates)
        .where(
          and(
            eq(agentWorkspaceRuns.tenant_id, tenantId),
            eq(agentWorkspaceRuns.id, runId),
          ),
        )
        .returning();
      return (run as WorkspaceRunRow | undefined) ?? null;
    },
    async insertWakeup(values) {
      const [wakeup] = await database
        .insert(agentWakeupRequests)
        .values(values)
        .returning({ id: agentWakeupRequests.id });
      if (!wakeup) throw new Error("workspace_review_wakeup_insert_failed");
      return wakeup;
    },
    async updateRunWakeup(runId, tenantId, wakeupRequestId) {
      await database
        .update(agentWorkspaceRuns)
        .set({
          current_wakeup_request_id: wakeupRequestId,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(agentWorkspaceRuns.tenant_id, tenantId),
            eq(agentWorkspaceRuns.id, runId),
          ),
        );
    },
  };
}

async function validateDecisionState(
  decision: WorkspaceReviewDecision,
  run: WorkspaceRunRow,
  store: WorkspaceReviewActionStore,
): Promise<void> {
  if (decision === "accepted" || decision === "cancelled") {
    if (run.status !== "awaiting_review") {
      throw new WorkspaceReviewActionError(
        `Workspace run is not awaiting review: ${run.status}`,
        "CONFLICT",
      );
    }
    return;
  }

  if (run.status === "awaiting_review") return;
  if (run.status === "pending") {
    if (!run.current_wakeup_request_id) return;
    const wakeup = await store.findWakeupById(
      run.tenant_id,
      run.current_wakeup_request_id,
    );
    if (!wakeup || !["queued", "claimed"].includes(wakeup.status)) return;
  }

  throw new WorkspaceReviewActionError(
    `Workspace run cannot be resumed from status: ${run.status}`,
    "CONFLICT",
  );
}

async function assertExpectedReviewEtag(
  latestReviewEvent: WorkspaceEventRow | null,
  expectedReviewEtag: string | null | undefined,
  store: WorkspaceReviewActionStore,
): Promise<void> {
  if (!expectedReviewEtag) return;
  if (!latestReviewEvent) {
    throw new WorkspaceReviewActionError(
      "No review file is attached to this run",
      "NOT_FOUND",
    );
  }
  const current = await store.headReviewObject(latestReviewEvent);
  if (normalizeEtag(current.etag) !== normalizeEtag(expectedReviewEtag)) {
    throw new WorkspaceReviewActionError(
      "Review changed since you opened it",
      "CONFLICT",
    );
  }
}

function normalizeEtag(etag: string | null | undefined): string | null {
  return etag?.replace(/^"|"$/g, "") ?? null;
}

function isNoSuchKey(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return (
    err instanceof NoSuchKey || name === "NoSuchKey" || name === "NotFound"
  );
}
