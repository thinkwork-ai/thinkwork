import { describe, expect, it } from "vitest";
import {
  loadWorkspaceReviewDetail,
  parseWorkspaceReviewProposedChanges,
  type WorkspaceReviewDetailStore,
} from "../lib/workspace-events/review-detail.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const AGENT_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";
const THREAD_ID = "00000000-0000-4000-8000-000000000004";
const THREAD_TURN_ID = "00000000-0000-4000-8000-000000000005";
const CREATED_AT = new Date("2026-04-26T12:00:00.000Z");

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    tenant_id: TENANT_ID,
    agent_id: AGENT_ID,
    target_path: "customers/acme",
    status: "awaiting_review",
    source_object_key: null,
    request_object_key: null,
    current_wakeup_request_id: null,
    current_thread_turn_id: null,
    parent_run_id: null,
    depth: 1,
    inbox_write_count: 1,
    wakeup_retry_count: 0,
    last_event_at: CREATED_AT,
    completed_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  } as any;
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 215,
    tenant_id: TENANT_ID,
    agent_id: AGENT_ID,
    run_id: RUN_ID,
    event_type: "review.requested",
    bucket: "bucket",
    source_object_key:
      "tenants/acme/agents/marco/workspace/review/run.needs-human.md",
    audit_object_key: null,
    object_etag: '"old"',
    object_version_id: null,
    sequencer: "001",
    mirror_status: "ok",
    reason: "needs_approval",
    payload: {
      proposedChanges: [
        {
          path: "work/runs/result.md",
          kind: "update",
          summary: "Publish result",
          diff: "+result",
        },
      ],
    },
    actor_type: "system",
    actor_id: null,
    parent_event_id: null,
    created_at: CREATED_AT,
    ...overrides,
  } as any;
}

describe("workspace review detail", () => {
  it("loads review body, etag, events, and proposed changes", async () => {
    const store: WorkspaceReviewDetailStore = {
      async findRunById() {
        return run({ current_thread_turn_id: THREAD_TURN_ID });
      },
      async findThreadIdForTurn(tenantId, threadTurnId) {
        expect(tenantId).toBe(TENANT_ID);
        expect(threadTurnId).toBe(THREAD_TURN_ID);
        return THREAD_ID;
      },
      async listEvents() {
        return [
          event(),
          event({
            id: 216,
            event_type: "run.blocked",
            reason: "review",
            payload: { reason: "review" },
          }),
          event({
            id: 217,
            event_type: "run.failed",
            reason: "runtime_error",
            payload: { reason: "runtime_error" },
          }),
          event({
            id: 218,
            event_type: "review.responded",
            reason: "review_accepted",
            payload: { decision: "accepted" },
          }),
        ];
      },
      async readReviewObject() {
        return {
          body: "# Needs review\n\nPlease approve the result.",
          etag: '"etag-1"',
          missing: false,
        };
      },
    };

    const result = await loadWorkspaceReviewDetail(RUN_ID, { store });

    expect(result?.run.tenant_id).toBe(TENANT_ID);
    expect(result?.detail.threadId).toBe(THREAD_ID);
    expect(result?.detail.reviewBody).toContain("Needs review");
    expect(result?.detail.reviewEtag).toBe('"etag-1"');
    expect(result?.detail.reviewMissing).toBe(false);
    expect(result?.detail.proposedChanges).toEqual([
      {
        path: "work/runs/result.md",
        kind: "update",
        summary: "Publish result",
        diff: "+result",
        before: null,
        after: null,
      },
    ]);
    expect(result?.detail.events).toHaveLength(4);
    expect(result?.detail.decisionEvents).toHaveLength(1);
    expect(result?.detail.decisionEvents[0]).toMatchObject({
      eventType: "review.responded",
    });
  });

  it("keeps raw markdown when proposed changes are free form", async () => {
    const store: WorkspaceReviewDetailStore = {
      async findRunById() {
        return run();
      },
      async listEvents() {
        return [event({ payload: { fileName: "run.needs-human.md" } })];
      },
      async readReviewObject() {
        return {
          body: "Can I continue?",
          etag: '"etag-1"',
          missing: false,
        };
      },
    };

    const result = await loadWorkspaceReviewDetail(RUN_ID, { store });

    expect(result?.detail.reviewBody).toBe("Can I continue?");
    expect(result?.detail.proposedChanges).toEqual([]);
  });

  it("reports missing review objects without hiding run metadata", async () => {
    const store: WorkspaceReviewDetailStore = {
      async findRunById() {
        return run();
      },
      async listEvents() {
        return [event()];
      },
      async readReviewObject() {
        return { body: null, etag: null, missing: true };
      },
    };

    const result = await loadWorkspaceReviewDetail(RUN_ID, { store });

    expect(result?.detail.reviewMissing).toBe(true);
    expect(result?.detail.reviewBody).toBeNull();
    expect(result?.detail.reviewObjectKey).toContain(
      "review/run.needs-human.md",
    );
  });
});

describe("parseWorkspaceReviewProposedChanges", () => {
  it("falls back to diff fences when payload is not structured", () => {
    expect(
      parseWorkspaceReviewProposedChanges("```diff\n-old\n+new\n```", null),
    ).toEqual([
      {
        kind: "diff",
        summary: "Review includes proposed diff",
        diff: "-old\n+new",
      },
    ]);
  });
});
