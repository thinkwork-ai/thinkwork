import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockClaimNextOpenEngineWorkItem,
  mockListEligibleOpenEngineWorkItems,
  mockRecordOpenEngineReceipt,
  mockRequireAdminOrServiceCaller,
  mockResolveCallerUserId,
  mockResolveWorkItemTenant,
  mockRouteOpenEngineWorkItem,
} = vi.hoisted(() => ({
  mockClaimNextOpenEngineWorkItem: vi.fn(),
  mockListEligibleOpenEngineWorkItems: vi.fn(),
  mockRecordOpenEngineReceipt: vi.fn(),
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockResolveCallerUserId: vi.fn(async () => "user-1"),
  mockResolveWorkItemTenant: vi.fn(async () => "tenant-1"),
  mockRouteOpenEngineWorkItem: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("../../../lib/work-items/auth.js", () => ({
  resolveWorkItemTenant: mockResolveWorkItemTenant,
}));

vi.mock("../../../lib/work-items/open-engine-queue-service.js", () => ({
  claimNextOpenEngineWorkItem: mockClaimNextOpenEngineWorkItem,
  listEligibleOpenEngineWorkItems: mockListEligibleOpenEngineWorkItems,
  normalizeOpenEngineQueueKey: (value: unknown) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || null,
  routeOpenEngineWorkItem: mockRouteOpenEngineWorkItem,
}));

vi.mock("../../../lib/work-items/open-engine-receipt-service.js", () => ({
  recordOpenEngineReceipt: mockRecordOpenEngineReceipt,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

import { claimNextOpenEngineWorkItem } from "./claimNextOpenEngineWorkItem.mutation.js";
import { openEngineEligibleWorkItems } from "./openEngineEligibleWorkItems.query.js";
import { recordOpenEngineWorkItemReceipt } from "./recordOpenEngineWorkItemReceipt.mutation.js";
import { routeOpenEngineWorkItem } from "./routeOpenEngineWorkItem.mutation.js";

const ctx = { auth: { authType: "service", tenantId: "tenant-1" } } as any;

beforeEach(() => {
  mockClaimNextOpenEngineWorkItem.mockReset();
  mockListEligibleOpenEngineWorkItems.mockReset();
  mockRecordOpenEngineReceipt.mockReset();
  mockRequireAdminOrServiceCaller.mockReset().mockResolvedValue(undefined);
  mockResolveCallerUserId.mockReset().mockResolvedValue("user-1");
  mockResolveWorkItemTenant.mockReset().mockResolvedValue("tenant-1");
  mockRouteOpenEngineWorkItem.mockReset();
});

describe("Open Engine Work Item resolvers", () => {
  it("lists eligible Work Items through the queue service", async () => {
    mockListEligibleOpenEngineWorkItems.mockResolvedValue([
      {
        id: "work-item-1",
        priority: "urgent",
        open_engine_dependency_state: "ready",
      },
    ]);

    const result = await openEngineEligibleWorkItems(
      null,
      {
        input: {
          tenantId: "tenant-1",
          queueKey: "default",
          ownerAgentId: "owner-agent-1",
          labelSlugs: ["codex"],
          now: "2026-06-27T13:00:00.000Z",
          limit: 10,
        },
      },
      ctx,
    );

    expect(mockResolveWorkItemTenant).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "open_engine_work_items:read",
    );
    expect(mockListEligibleOpenEngineWorkItems).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      queueKey: "default",
      spaceId: null,
      statusId: null,
      labelSlugs: ["codex"],
      ownerUserId: null,
      ownerAgentId: "owner-agent-1",
      now: new Date("2026-06-27T13:00:00.000Z"),
      limit: 10,
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: "work-item-1",
        priority: "URGENT",
        openEngineDependencyState: "READY",
      }),
    ]);
  });

  it("claims the next eligible Work Item through the queue service", async () => {
    mockClaimNextOpenEngineWorkItem.mockResolvedValue({
      id: "work-item-1",
      priority: "normal",
      open_engine_dependency_state: "ready",
    });

    const result = await claimNextOpenEngineWorkItem(
      null,
      {
        input: {
          tenantId: "tenant-1",
          queueKey: "default",
          spaceId: "space-1",
          statusId: "status-1",
          labelSlugs: ["codex"],
          ownerUserId: "user-owner",
          ownerAgentId: "owner-agent-1",
          agentId: "agent-1",
          now: "2026-06-27T13:00:00.000Z",
          leaseSeconds: 120,
        },
      },
      ctx,
    );

    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "open_engine_work_items:claim",
    );
    expect(mockClaimNextOpenEngineWorkItem).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      queueKey: "default",
      spaceId: "space-1",
      statusId: "status-1",
      labelSlugs: ["codex"],
      ownerUserId: "user-owner",
      ownerAgentId: "owner-agent-1",
      agentId: "agent-1",
      now: new Date("2026-06-27T13:00:00.000Z"),
      leaseSeconds: 120,
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: "work-item-1",
        priority: "NORMAL",
        openEngineDependencyState: "READY",
      }),
    );
  });

  it("returns null when no Work Item can be claimed", async () => {
    mockClaimNextOpenEngineWorkItem.mockResolvedValue(null);

    await expect(
      claimNextOpenEngineWorkItem(null, { input: { agentId: "agent-1" } }, ctx),
    ).resolves.toBeNull();
    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "open_engine_work_items:claim",
    );
  });

  it("records an Open Engine receipt and parses AWSJSON fields", async () => {
    mockRecordOpenEngineReceipt.mockResolvedValue({
      id: "event-1",
      event_type: "agent_action",
    });

    const result = await recordOpenEngineWorkItemReceipt(
      null,
      {
        input: {
          tenantId: "tenant-1",
          workItemId: "work-item-1",
          agentId: "agent-1",
          receiptType: "BLOCKED",
          threadId: "thread-1",
          message: "Need EIN.",
          evidence: JSON.stringify({ questionId: "q-1" }),
          metadata: { attempt: 1 },
          idempotencyKey: "receipt-key-1",
          now: "2026-06-27T13:00:00.000Z",
        },
      },
      ctx,
    );

    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "open_engine_work_item_receipts:create",
    );
    expect(mockRecordOpenEngineReceipt).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      workItemId: "work-item-1",
      agentId: "agent-1",
      receiptType: "BLOCKED",
      threadId: "thread-1",
      message: "Need EIN.",
      evidence: { questionId: "q-1" },
      metadata: { attempt: 1 },
      idempotencyKey: "receipt-key-1",
      now: new Date("2026-06-27T13:00:00.000Z"),
    });
    expect(result).toEqual({
      id: "event-1",
      eventType: "AGENT_ACTION",
    });
  });

  it("routes a Work Item through the Open Engine queue service", async () => {
    mockRouteOpenEngineWorkItem.mockResolvedValue({
      workItem: { id: "work-item-1" },
      event: {
        id: "event-1",
        event_type: "assigned",
        message: "Hand off to Codex.",
      },
    });

    const result = await routeOpenEngineWorkItem(
      null,
      {
        input: {
          tenantId: "tenant-1",
          workItemId: "work-item-1",
          targetQueueKey: "Codex",
          targetOwnerUserId: "user-2",
          agentId: "agent-router",
          message: "Hand off to Codex.",
          metadata: JSON.stringify({ reason: "needs-codex" }),
          idempotencyKey: "route-key-1",
          now: "2026-06-27T13:00:00.000Z",
        },
      },
      { auth: { authType: "cognito", tenantId: "tenant-1" } } as any,
    );

    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "open_engine_work_items:route",
    );
    expect(mockRouteOpenEngineWorkItem).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      workItemId: "work-item-1",
      targetQueueKey: "codex",
      targetOwnerUserId: "user-2",
      targetOwnerAgentId: undefined,
      actorUserId: "user-1",
      actorAgentId: "agent-router",
      message: "Hand off to Codex.",
      metadata: { reason: "needs-codex" },
      idempotencyKey: "route-key-1",
      now: new Date("2026-06-27T13:00:00.000Z"),
    });
    expect(result).toEqual({
      id: "event-1",
      eventType: "ASSIGNED",
      message: "Hand off to Codex.",
    });
  });

  it("does not claim Work Items when the admin or service gate rejects", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValue(
      Object.assign(new Error("FORBIDDEN"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      claimNextOpenEngineWorkItem(null, { input: { agentId: "agent-1" } }, ctx),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    expect(mockClaimNextOpenEngineWorkItem).not.toHaveBeenCalled();
  });
});
