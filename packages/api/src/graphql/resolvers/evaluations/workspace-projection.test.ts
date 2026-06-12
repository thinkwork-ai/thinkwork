/**
 * EvalResult.workspaceProjection field resolver (plan 2026-06-12-002 U10).
 *
 * The resolver reads the linked turn's STORED
 * `context_snapshot.workspace_projection` through a tenant-scoped join to
 * the parent run — it never re-renders a workspace.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRows } = vi.hoisted(() => ({ mockRows: vi.fn() }));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () => Promise.resolve(mockRows()),
          }),
        }),
        // evalResultSpans-style chain, unused here but keeps the mock honest
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
    }),
  },
  eq: (...args: unknown[]) => ({ eq: args }),
  and: (...args: unknown[]) => ({ and: args }),
  asc: (arg: unknown) => ({ asc: arg }),
  desc: (arg: unknown) => ({ desc: arg }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
  sql: (...args: unknown[]) => ({ sql: args }),
}));

vi.mock("../../../lib/agentcore-spans.js", () => ({
  fetchSpansForSession: vi.fn(),
}));

import { evalResultTypeResolvers } from "./index.js";

const TURN_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

const storedProjection = {
  renderedPrefix: "tenants/acme/threads/t-1/rendered/",
  agentsMdKey: "tenants/acme/threads/t-1/rendered/AGENTS.md",
  injectedFiles: ["AGENTS.md"],
  generatedAt: "2026-06-12T00:00:00.000Z",
};

beforeEach(() => {
  mockRows.mockReset();
});

describe("EvalResult.workspaceProjection", () => {
  it("returns the linked turn's stored projection as JSON", async () => {
    mockRows.mockReturnValue([
      { context_snapshot: { workspace_projection: storedProjection } },
    ]);
    const value = await evalResultTypeResolvers.workspaceProjection({
      threadTurnId: TURN_ID,
      runId: RUN_ID,
    });
    expect(value).toBe(JSON.stringify(storedProjection));
  });

  it("returns null without querying when no turn is linked", async () => {
    const value = await evalResultTypeResolvers.workspaceProjection({
      threadTurnId: null,
      runId: RUN_ID,
    });
    expect(value).toBeNull();
    expect(mockRows).not.toHaveBeenCalled();
  });

  it("returns null when the turn row is gone or carries no projection", async () => {
    mockRows.mockReturnValueOnce([]);
    expect(
      await evalResultTypeResolvers.workspaceProjection({
        threadTurnId: TURN_ID,
        runId: RUN_ID,
      }),
    ).toBeNull();

    mockRows.mockReturnValueOnce([{ context_snapshot: { other: 1 } }]);
    expect(
      await evalResultTypeResolvers.workspaceProjection({
        threadTurnId: TURN_ID,
        runId: RUN_ID,
      }),
    ).toBeNull();
  });
});
