import { describe, expect, it, vi } from "vitest";
import {
  materializeReviewAsInboxItem,
  syncInboxStatusForRun,
  type WorkspaceReviewInboxStore,
} from "../lib/workspace-events/inbox-materialization.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const RUN = "00000000-0000-4000-8000-000000000002";
const AGENT = "00000000-0000-4000-8000-000000000003";
const USER_A = "00000000-0000-4000-8000-000000000004";

function fakeStore(
  overrides: Partial<WorkspaceReviewInboxStore> = {},
): WorkspaceReviewInboxStore {
  return {
    findAgentNameAndSlug: vi.fn(async () => ({ name: "marco", slug: "marco" })),
    findInboxItemForRun: vi.fn(async () => null),
    insertInboxItem: vi.fn(async () => ({ id: "item-1" })),
    updateInboxItemStatus: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("materializeReviewAsInboxItem", () => {
  it("inserts an inbox item for a system run", async () => {
    const store = fakeStore();
    const result = await materializeReviewAsInboxItem(
      {
        tenantId: TENANT,
        runId: RUN,
        agentId: AGENT,
        targetPath: "smoke/",
        classification: { kind: "system", responsibleUserId: null },
        reviewObjectKey: "tenants/x/agents/marco/workspace/review/run.md",
        reason: "needs_approval",
      },
      { store },
    );

    expect(result.status).toBe("created");
    expect(store.insertInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT,
        type: "workspace_review",
        status: "pending",
        entity_type: "agent_workspace_run",
        entity_id: RUN,
        title: "Workspace review: marco on smoke/",
        requester_type: "agent",
        requester_id: AGENT,
      }),
    );
  });

  it("inserts an unrouted-marked inbox item for an unrouted run", async () => {
    const store = fakeStore();
    await materializeReviewAsInboxItem(
      {
        tenantId: TENANT,
        runId: RUN,
        agentId: AGENT,
        targetPath: "",
        classification: { kind: "unrouted", responsibleUserId: null },
      },
      { store },
    );
    expect(store.insertInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/^Workspace review \(unrouted\)/),
      }),
    );
  });

  it("skips paired runs (those live on mobile)", async () => {
    const store = fakeStore();
    const result = await materializeReviewAsInboxItem(
      {
        tenantId: TENANT,
        runId: RUN,
        agentId: AGENT,
        targetPath: "x/",
        classification: { kind: "paired", responsibleUserId: USER_A },
      },
      { store },
    );
    expect(result.status).toBe("skipped_paired");
    expect(store.insertInboxItem).not.toHaveBeenCalled();
  });

  it("is idempotent — skips when an inbox item already exists for the run", async () => {
    const store = fakeStore({
      findInboxItemForRun: vi.fn(async () => ({
        id: "existing",
        status: "pending",
      })),
    });
    const result = await materializeReviewAsInboxItem(
      {
        tenantId: TENANT,
        runId: RUN,
        agentId: AGENT,
        targetPath: "y/",
        classification: { kind: "system", responsibleUserId: null },
      },
      { store },
    );
    expect(result.status).toBe("skipped_exists");
    expect(result.inboxItemId).toBe("existing");
    expect(store.insertInboxItem).not.toHaveBeenCalled();
  });

  it("falls back to short agent id if the agent record can't be resolved", async () => {
    const store = fakeStore({
      findAgentNameAndSlug: vi.fn(async () => null),
    });
    await materializeReviewAsInboxItem(
      {
        tenantId: TENANT,
        runId: RUN,
        agentId: AGENT,
        targetPath: "",
        classification: { kind: "system", responsibleUserId: null },
      },
      { store },
    );
    expect(store.insertInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining(AGENT.slice(0, 8)),
      }),
    );
  });
});

describe("syncInboxStatusForRun", () => {
  it("updates the linked inbox item to the new status", async () => {
    const store = fakeStore({
      findInboxItemForRun: vi.fn(async () => ({
        id: "item-1",
        status: "pending",
      })),
    });
    const result = await syncInboxStatusForRun(
      {
        tenantId: TENANT,
        runId: RUN,
        status: "approved",
        decidedBy: USER_A,
        reviewNotes: "ok",
      },
      { store },
    );
    expect(result.status).toBe("updated");
    expect(store.updateInboxItemStatus).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({
        status: "approved",
        decided_by: USER_A,
        review_notes: "ok",
      }),
    );
  });

  it("no-ops when no linked inbox item exists (paired runs never had one)", async () => {
    const store = fakeStore({
      findInboxItemForRun: vi.fn(async () => null),
    });
    const result = await syncInboxStatusForRun(
      { tenantId: TENANT, runId: RUN, status: "approved" },
      { store },
    );
    expect(result.status).toBe("skipped_no_item");
    expect(store.updateInboxItemStatus).not.toHaveBeenCalled();
  });

  it("recursion guard: skips when status is already at target", async () => {
    const store = fakeStore({
      findInboxItemForRun: vi.fn(async () => ({
        id: "item-1",
        status: "approved",
      })),
    });
    const result = await syncInboxStatusForRun(
      { tenantId: TENANT, runId: RUN, status: "approved" },
      { store },
    );
    expect(result.status).toBe("skipped_no_change");
    expect(store.updateInboxItemStatus).not.toHaveBeenCalled();
  });
});
