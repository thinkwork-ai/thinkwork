import { describe, expect, it, vi } from "vitest";
import {
  decideWorkspaceReview,
  WorkspaceReviewActionError,
  type WorkspaceReviewActionStore,
} from "../lib/workspace-events/review-actions.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const AGENT_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";
const WAKEUP_ID = "00000000-0000-4000-8000-000000000004";
const THREAD_TURN_ID = "00000000-0000-4000-8000-000000000005";
const THREAD_ID = "00000000-0000-4000-8000-000000000006";
const NOW = new Date("2026-04-26T12:00:00.000Z");

function createStore(
  options: {
    status?: string;
    currentWakeupStatus?: string | null;
    existingEvent?: boolean;
    reviewEtag?: string | null;
  } = {},
) {
  const run = {
    id: RUN_ID,
    tenant_id: TENANT_ID,
    agent_id: AGENT_ID,
    target_path: "customers/acme",
    status: options.status ?? "awaiting_review",
    current_wakeup_request_id:
      options.currentWakeupStatus === undefined ? null : WAKEUP_ID,
    current_thread_turn_id: THREAD_TURN_ID,
    completed_at: null as Date | null,
    last_event_at: NOW,
    updated_at: NOW,
  };
  const events: any[] = [];
  const wakeups: any[] = [];
  const reviewEvent = {
    id: 10,
    tenant_id: TENANT_ID,
    agent_id: AGENT_ID,
    run_id: RUN_ID,
    event_type: "review.requested",
    bucket: "bucket",
    source_object_key:
      "tenants/acme/agents/marco/workspace/review/run.needs-human.md",
    object_etag: options.reviewEtag ?? '"etag-1"',
    reason: "review",
    payload: {},
    created_at: NOW,
  };

  const store: WorkspaceReviewActionStore = {
    async findRunById() {
      return run as any;
    },
    async findLatestReviewEvent() {
      return reviewEvent as any;
    },
    async findEventByIdempotencyKey(tenantId, idempotencyKey) {
      if (!options.existingEvent) return null;
      return {
        ...reviewEvent,
        id: 42,
        tenant_id: tenantId,
        run_id: RUN_ID,
        event_type: "review.responded",
        idempotency_key: idempotencyKey,
      } as any;
    },
    async findWakeupById() {
      if (options.currentWakeupStatus === null) return null;
      return { id: WAKEUP_ID, status: options.currentWakeupStatus ?? "queued" };
    },
    async findThreadIdForTurn() {
      return THREAD_ID;
    },
    async headReviewObject() {
      return { etag: options.reviewEtag ?? '"etag-1"' };
    },
    async insertEvent(values) {
      if (options.existingEvent) return null;
      const event = { id: 42, ...values };
      events.push(event);
      return { id: event.id };
    },
    async updateRun(_runId, _tenantId, updates) {
      Object.assign(run, updates);
      return run as any;
    },
    async insertWakeup(values) {
      const wakeup = { id: WAKEUP_ID, ...values };
      wakeups.push(wakeup);
      return { id: wakeup.id };
    },
    async updateRunWakeup(_runId, _tenantId, wakeupRequestId) {
      run.current_wakeup_request_id = wakeupRequestId;
    },
  };

  return { store, run, events, wakeups };
}

describe("workspace review actions", () => {
  it("accepts a review and queues one workspace wakeup", async () => {
    const { store, run, events, wakeups } = createStore();

    const result = await decideWorkspaceReview(
      {
        runId: RUN_ID,
        decision: "accepted",
        actorId: "user-1",
        values: {
          notes: "Looks good",
          expectedReviewEtag: "etag-1",
          responseMarkdown: "Approved.",
        },
      },
      { store, now: () => NOW },
    );

    expect(result).toMatchObject({
      eventId: 42,
      wakeupRequestId: WAKEUP_ID,
      duplicate: false,
    });
    expect(run.status).toBe("pending");
    expect(events[0]).toMatchObject({
      event_type: "review.responded",
      reason: "review_accepted",
      actor_id: "user-1",
    });
    expect(events[0].payload).toMatchObject({
      decision: "accepted",
      notes: "Looks good",
      responseMarkdown: "Approved.",
    });
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0].payload).toMatchObject({
      workspaceRunId: RUN_ID,
      workspaceEventId: 42,
      threadId: THREAD_ID,
      causeType: "review.responded",
    });
  });

  it("rejects stale review etags without side effects", async () => {
    const { store, events, wakeups } = createStore({
      reviewEtag: '"new-etag"',
    });

    await expect(
      decideWorkspaceReview(
        {
          runId: RUN_ID,
          decision: "accepted",
          actorId: "user-1",
          values: { expectedReviewEtag: "old-etag" },
        },
        { store, now: () => NOW },
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Review changed since you opened it",
    });
    expect(events).toEqual([]);
    expect(wakeups).toEqual([]);
  });

  it("cancels a review without queuing a wakeup", async () => {
    const { store, run, events, wakeups } = createStore();

    const result = await decideWorkspaceReview(
      {
        runId: RUN_ID,
        decision: "cancelled",
        actorId: "user-1",
        values: { notes: "Not acceptable" },
      },
      { store, now: () => NOW },
    );

    expect(result).toMatchObject({ eventId: 42, duplicate: false });
    expect(run.status).toBe("cancelled");
    expect(run.completed_at).toBe(NOW);
    expect(events[0]).toMatchObject({
      event_type: "run.failed",
      reason: "review_cancelled",
    });
    expect(wakeups).toEqual([]);
  });

  it("does not duplicate events or wakeups for an existing idempotency key", async () => {
    const { store, events, wakeups } = createStore({ existingEvent: true });
    const logger = { warn: vi.fn() };

    const result = await decideWorkspaceReview(
      {
        runId: RUN_ID,
        decision: "accepted",
        actorId: "user-1",
        values: { idempotencyKey: "same-key" },
      },
      { store, now: () => NOW, logger },
    );

    expect(result).toEqual({
      run: expect.objectContaining({ id: RUN_ID }),
      eventId: 42,
      duplicate: true,
    });
    expect(events).toEqual([]);
    expect(wakeups).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "[workspace-review-action] duplicate_decision",
      expect.objectContaining({ idempotencyKey: "same-key" }),
    );
  });

  it("allows resume for pending runs only when no active wakeup is queued", async () => {
    const blocked = createStore({
      status: "pending",
      currentWakeupStatus: "queued",
    });

    await expect(
      decideWorkspaceReview(
        { runId: RUN_ID, decision: "resumed", actorId: "user-1" },
        { store: blocked.store, now: () => NOW },
      ),
    ).rejects.toBeInstanceOf(WorkspaceReviewActionError);

    const allowed = createStore({
      status: "pending",
      currentWakeupStatus: "completed",
    });
    await expect(
      decideWorkspaceReview(
        { runId: RUN_ID, decision: "resumed", actorId: "user-1" },
        { store: allowed.store, now: () => NOW },
      ),
    ).resolves.toMatchObject({ wakeupRequestId: WAKEUP_ID });
  });
});
