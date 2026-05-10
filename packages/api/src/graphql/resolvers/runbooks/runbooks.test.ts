import { GraphQLError } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockResolveRunbookCaller,
  mockRequireRunbookRunAccess,
  mockConfirmRunbookRunState,
  mockQueueConfirmedRunbookRun,
} = vi.hoisted(() => ({
  mockResolveRunbookCaller: vi.fn(),
  mockRequireRunbookRunAccess: vi.fn(),
  mockConfirmRunbookRunState: vi.fn(),
  mockQueueConfirmedRunbookRun: vi.fn(),
}));

vi.mock("./shared.js", () => ({
  resolveRunbookCaller: mockResolveRunbookCaller,
  requireRunbookRunAccess: mockRequireRunbookRunAccess,
}));

vi.mock("../../../lib/runbooks/runs.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/runbooks/runs.js")
  >("../../../lib/runbooks/runs.js");
  return {
    ...actual,
    confirmRunbookRun: mockConfirmRunbookRunState,
  };
});

vi.mock("../../../lib/computers/thread-cutover.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/computers/thread-cutover.js")
  >("../../../lib/computers/thread-cutover.js");
  return {
    ...actual,
    queueConfirmedRunbookRun: mockQueueConfirmedRunbookRun,
  };
});

import { confirmRunbookRun } from "./confirmRunbookRun.mutation.js";

const ctx = {} as Parameters<typeof confirmRunbookRun>[2];

describe("runbook GraphQL resolvers", () => {
  beforeEach(() => {
    mockResolveRunbookCaller.mockReset();
    mockRequireRunbookRunAccess.mockReset();
    mockConfirmRunbookRunState.mockReset();
    mockQueueConfirmedRunbookRun.mockReset();
    mockResolveRunbookCaller.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-1",
    });
    mockConfirmRunbookRunState.mockResolvedValue({
      id: "run-1",
      status: "QUEUED",
      tasks: [],
    });
  });

  it("confirms a run after tenant-scoped access is checked", async () => {
    const result = await confirmRunbookRun(null, { id: "run-1" }, ctx);

    expect(result?.status).toBe("QUEUED");
    expect(mockRequireRunbookRunAccess).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "run-1",
    );
    expect(mockConfirmRunbookRunState).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      runId: "run-1",
      userId: "user-1",
    });
    expect(mockQueueConfirmedRunbookRun).not.toHaveBeenCalled();
  });

  it("queues a runbook execution task when a thread-backed run is approved", async () => {
    mockConfirmRunbookRunState.mockResolvedValue({
      id: "run-1",
      status: "QUEUED",
      computerId: "computer-1",
      threadId: "thread-1",
      selectedByMessageId: "message-1",
      tasks: [],
    });

    await confirmRunbookRun(null, { id: "run-1" }, ctx);

    expect(mockQueueConfirmedRunbookRun).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      computerId: "computer-1",
      threadId: "thread-1",
      runbookRunId: "run-1",
      sourceMessageId: "message-1",
      actorType: "user",
      actorId: "user-1",
    });
  });

  it("does not confirm a cross-tenant run when access resolution fails", async () => {
    mockRequireRunbookRunAccess.mockRejectedValue(
      new GraphQLError("Runbook run not found", {
        extensions: { code: "NOT_FOUND" },
      }),
    );

    await expect(confirmRunbookRun(null, { id: "run-2" }, ctx)).rejects.toThrow(
      "Runbook run not found",
    );
    expect(mockConfirmRunbookRunState).not.toHaveBeenCalled();
  });
});
