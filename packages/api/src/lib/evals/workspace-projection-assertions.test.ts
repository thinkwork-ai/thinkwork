import { describe, expect, it, vi } from "vitest";
import type { Database } from "@thinkwork/database-pg";
import {
  evaluateWorkspaceProjectionAssertions,
  isWorkspaceProjectionAssertion,
  partitionEvalAssertions,
  resolveProjectionPath,
} from "./workspace-projection-assertions.js";

/**
 * Minimal drizzle stand-in for
 * `db.select(...).from(...).where(...).limit(1)`. Returns the configured rows
 * and records each call so tests can assert "stored data only, no re-render".
 */
function fakeDb(rowsByCall: Array<Array<{ context_snapshot: unknown }>>) {
  const limit = vi.fn(async () => rowsByCall.shift() ?? []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { db: { select } as unknown as Database, select, limit };
}

const storedProjection = {
  renderedPrefix: "tenants/acme/threads/t-1/rendered/",
  sources: [
    { owner: "agent", prefix: "tenants/acme/agent/", etagSummary: "3:abc123" },
    { owner: "space:growth", prefix: "tenants/acme/spaces/growth/" },
  ],
  agentsMdKey: "tenants/acme/threads/t-1/rendered/AGENTS.md",
  injectedFiles: ["AGENTS.md", "CONTEXT.md"],
  generatedAt: "2026-06-12T00:00:00.000Z",
};

const TURN_ID = "11111111-1111-4111-8111-111111111111";

describe("partitionEvalAssertions", () => {
  it("splits projection-targeting assertions from output assertions", () => {
    const output = { type: "contains", value: "hello" };
    const projection = {
      type: "workspace-projection-contains",
      threadTurnId: TURN_ID,
      value: "AGENTS.md",
    };
    const { outputAssertions, projectionAssertions } = partitionEvalAssertions([
      output,
      projection,
    ]);
    expect(outputAssertions).toEqual([output]);
    expect(projectionAssertions).toEqual([projection]);
    expect(isWorkspaceProjectionAssertion(projection)).toBe(true);
    expect(isWorkspaceProjectionAssertion(output)).toBe(false);
  });
});

describe("resolveProjectionPath", () => {
  it("walks dot-paths through objects and arrays", () => {
    expect(resolveProjectionPath(storedProjection, "agentsMdKey")).toBe(
      storedProjection.agentsMdKey,
    );
    expect(resolveProjectionPath(storedProjection, "sources.1.owner")).toBe(
      "space:growth",
    );
    expect(
      resolveProjectionPath(storedProjection, "sources.9.owner"),
    ).toBeUndefined();
    expect(
      resolveProjectionPath(storedProjection, "nope.deep"),
    ).toBeUndefined();
  });
});

describe("evaluateWorkspaceProjectionAssertions", () => {
  it("passes routing-section assertions from the STORED snapshot and links the turn (AE5)", async () => {
    const { db, select } = fakeDb([
      [{ context_snapshot: { workspace_projection: storedProjection } }],
    ]);

    const outcome = await evaluateWorkspaceProjectionAssertions(
      [
        {
          type: "workspace-projection-contains",
          threadTurnId: TURN_ID,
          path: "injectedFiles",
          value: "AGENTS.md",
        },
        {
          type: "workspace-projection-regex",
          threadTurnId: TURN_ID,
          path: "agentsMdKey",
          value: "rendered/AGENTS\\.md$",
        },
        {
          type: "workspace-projection-contains",
          threadTurnId: TURN_ID,
          path: "sources",
          value: "space:growth",
        },
      ],
      { tenantId: "tenant-1", db },
    );

    expect(outcome.results.map((r) => r.passed)).toEqual([true, true, true]);
    expect(outcome.threadTurnId).toBe(TURN_ID);
    // The turn is loaded ONCE from the stored row — no re-render, no extra
    // reads. Later renders of the workspace cannot affect this outcome.
    expect(select).toHaveBeenCalledTimes(1);
    // Original assertion type is preserved in the persisted result snapshot.
    expect(outcome.results[0].type).toBe("workspace-projection-contains");
    expect(outcome.results[0].reason).toContain(TURN_ID);
  });

  it("fails (not crashes) when the turn exists but has no stored snapshot", async () => {
    const { db } = fakeDb([[{ context_snapshot: { other: true } }]]);
    const outcome = await evaluateWorkspaceProjectionAssertions(
      [
        {
          type: "workspace-projection-contains",
          threadTurnId: TURN_ID,
          value: "AGENTS.md",
        },
      ],
      { tenantId: "tenant-1", db },
    );
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0].passed).toBe(false);
    expect(outcome.results[0].reason).toContain(
      "no stored workspace projection snapshot",
    );
    // No real turn loaded → no FK-able linkage recorded.
    expect(outcome.threadTurnId).toBeNull();
  });

  it("fails clearly when the turn is missing for the tenant", async () => {
    const { db } = fakeDb([[]]);
    const outcome = await evaluateWorkspaceProjectionAssertions(
      [
        {
          type: "workspace-projection-equals",
          threadTurnId: TURN_ID,
          path: "renderedPrefix",
          value: "x",
        },
      ],
      { tenantId: "tenant-1", db },
    );
    expect(outcome.results[0].passed).toBe(false);
    expect(outcome.results[0].reason).toContain("not found for this tenant");
    expect(outcome.threadTurnId).toBeNull();
  });

  it("fails clearly when the assertion omits threadTurnId or names a bad path", async () => {
    const { db, select } = fakeDb([
      [{ context_snapshot: { workspace_projection: storedProjection } }],
    ]);
    const outcome = await evaluateWorkspaceProjectionAssertions(
      [
        { type: "workspace-projection-contains", value: "AGENTS.md" },
        {
          type: "workspace-projection-contains",
          threadTurnId: TURN_ID,
          path: "doesNot.exist",
          value: "AGENTS.md",
        },
      ],
      { tenantId: "tenant-1", db },
    );
    expect(outcome.results[0].passed).toBe(false);
    expect(outcome.results[0].reason).toContain("requires a threadTurnId");
    expect(outcome.results[1].passed).toBe(false);
    expect(outcome.results[1].reason).toContain('path "doesNot.exist"');
    // The missing-threadTurnId assertion never touches the db.
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("treats a db failure as a failed assertion, not an exception", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              throw new Error("connection reset");
            },
          }),
        }),
      }),
    } as unknown as Database;
    const outcome = await evaluateWorkspaceProjectionAssertions(
      [
        {
          type: "workspace-projection-contains",
          threadTurnId: TURN_ID,
          value: "AGENTS.md",
        },
      ],
      { tenantId: "tenant-1", db },
    );
    expect(outcome.results[0].passed).toBe(false);
    expect(outcome.threadTurnId).toBeNull();
  });
});
