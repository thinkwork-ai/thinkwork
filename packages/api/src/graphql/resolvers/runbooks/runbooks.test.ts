import { GraphQLError } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockResolveRunbookCaller,
  mockRequireRunbookRunAccess,
  mockConfirmRunbookRunState,
} = vi.hoisted(() => ({
  mockResolveRunbookCaller: vi.fn(),
  mockRequireRunbookRunAccess: vi.fn(),
  mockConfirmRunbookRunState: vi.fn(),
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

import { confirmRunbookRun } from "./confirmRunbookRun.mutation.js";

const ctx = {} as Parameters<typeof confirmRunbookRun>[2];

describe("runbook GraphQL resolvers", () => {
  beforeEach(() => {
    mockResolveRunbookCaller.mockReset();
    mockRequireRunbookRunAccess.mockReset();
    mockConfirmRunbookRunState.mockReset();
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
