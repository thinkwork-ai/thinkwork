/**
 * analyst-connection-reconciler handler tests (THINK-283 U4).
 *
 * getDb() is mocked; the sourced probe is injected. Covers builtin/sourced
 * routing, per-row failure isolation (one broken warehouse never stops the
 * batch), and the stamp's merge discipline: analyst_probe is the ONLY key
 * the reconciler writes — analyst_source and the U5-owned analyst_refresh
 * state must survive every stamp (state isolation).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  updates: [] as { id: string; runtime_metadata: unknown }[],
}));

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(h.rows),
        }),
      }),
      update: () => ({
        set: (values: { runtime_metadata: unknown }) => ({
          where: (cond: unknown) => {
            // Drizzle eq(tenantMcpServers.id, row.id) — capture via closure:
            // the handler stamps rows in order, so record the payloads.
            h.updates.push({
              id: String(h.updates.length),
              runtime_metadata: values.runtime_metadata,
            });
            void cond;
            return Promise.resolve();
          },
        }),
      }),
    }),
  };
});

// eslint-disable-next-line import/first
import { handler } from "./analyst-connection-reconciler.js";

function builtinRow(id: string) {
  return {
    id,
    tenant_id: "tenant-1",
    url: "https://api.example.com/mcp/analyst",
    slug: "postgres-dev",
    runtime_metadata: {},
  };
}

function sourcedRow(id: string, slug: string, extraMeta = {}) {
  return {
    id,
    tenant_id: "tenant-1",
    url: `https://api.example.com/mcp/analyst/${slug}`,
    slug,
    runtime_metadata: {
      analyst_source: {
        host: "wh.example.rds.amazonaws.com",
        port: 5432,
        database: "warehouse",
        dbUser: `${slug}_reader`,
        tls: "required",
        credentialSecretArn: "arn:secret",
        tenantScoped: true,
        schema: "raw_jde",
        kind: "internal",
        sourceGeneration: "gen-1",
      },
      ...extraMeta,
    },
  };
}

const OK_VERDICT = {
  status: "ok" as const,
  checkedAt: "2026-07-13T12:00:00.000Z",
};

beforeEach(() => {
  h.rows = [];
  h.updates = [];
});

describe("analyst-connection-reconciler (THINK-283 U4)", () => {
  it("routes builtin rows to the cluster probe and sourced rows to the per-source probe", async () => {
    h.rows = [builtinRow("b1"), sourcedRow("s1", "warehouse")];
    const probeSourcedRow = vi.fn(async () => OK_VERDICT);
    const result = await handler({
      // Builtin probe path: injected client fails fast → deterministic fail
      // verdict without touching a database.
      getClient: async () => {
        throw new Error("no cluster in unit tests");
      },
      probeSourcedRow,
    });
    expect(result.probed).toBe(true);
    expect(result.rows_updated).toBe(2);
    expect(result.sourced_probed).toBe(1);
    expect(probeSourcedRow).toHaveBeenCalledTimes(1);
    expect(result.verdict?.status).toBe("fail");
  });

  it("a thrown sourced probe stamps a retryable probe_error on THAT row and continues the batch", async () => {
    h.rows = [sourcedRow("s1", "broken"), sourcedRow("s2", "healthy")];
    const probeSourcedRow = vi.fn(async (row: { slug: string }) => {
      if (row.slug === "broken") throw new Error("connect ETIMEDOUT");
      return OK_VERDICT;
    });
    const result = await handler({ probeSourcedRow });
    expect(result.rows_updated).toBe(2);
    const stamped = h.updates.map(
      (u) =>
        (u.runtime_metadata as { analyst_probe: { status: string } })
          .analyst_probe,
    );
    expect(stamped[0]).toMatchObject({ status: "fail", reason: "probe_error" });
    expect((stamped[0] as { detail?: string }).detail).toContain("ETIMEDOUT");
    expect(stamped[1]).toMatchObject({ status: "ok" });
  });

  it("state isolation: stamping analyst_probe preserves analyst_source AND analyst_refresh", async () => {
    h.rows = [
      sourcedRow("s1", "warehouse", {
        analyst_refresh: { status: "failed", attemptId: "a1", detail: "x" },
      }),
    ];
    await handler({ probeSourcedRow: async () => OK_VERDICT });
    expect(h.updates).toHaveLength(1);
    const meta = h.updates[0]!.runtime_metadata as Record<string, unknown>;
    expect(meta.analyst_probe).toMatchObject({ status: "ok" });
    // A successful scheduled probe must NEVER clear the refresh gate.
    expect(meta.analyst_refresh).toEqual({
      status: "failed",
      attemptId: "a1",
      detail: "x",
    });
    expect((meta.analyst_source as { schema?: string }).schema).toBe("raw_jde");
  });

  it("no analyst rows → nothing probed", async () => {
    h.rows = [
      {
        id: "x",
        tenant_id: "t",
        url: "https://api.example.com/mcp/other",
        slug: "other",
        runtime_metadata: {},
      },
    ];
    const result = await handler({
      probeSourcedRow: async () => OK_VERDICT,
    });
    expect(result).toMatchObject({ probed: false, rows_updated: 0 });
  });
});
