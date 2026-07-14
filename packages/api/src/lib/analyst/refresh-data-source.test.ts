/**
 * Explicit fail-closed refresh lifecycle tests (THINK-283 U5).
 *
 * All effects injected — no DB/AWS. The central correctness property is the
 * partial-state behavior: a forced failure AFTER EACH external side effect
 * must leave a durable failed state (source withheld) and never a commit;
 * only a fully converged attempt commits, with a NEW generation, via an
 * attempt-owned compare-and-set.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANALYST_REFRESH_LEASE_MS,
  AnalystRefreshConflictError,
  AnalystRefreshInputError,
  AnalystRefreshStepError,
  diffModels,
  refreshAnalystDataSource,
  type RefreshDeps,
  type SourceRow,
} from "./refresh-data-source.js";
import type { StoredAnalystModel } from "@thinkwork/database-pg/analyst";
import type { ConnectionProbeVerdict } from "./connection-probe.js";

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: (key: string) =>
    key === "WORKSPACE_BUCKET" ? "workspace-bucket" : undefined,
}));

// The default-db import chain must never be touched when deps are injected.
vi.mock("../../graphql/utils.js", () => ({ db: {} }));

const TENANT = "11111111-1111-7111-8111-111111111111";
const NOW = Date.parse("2026-07-13T12:00:00.000Z");

const MODEL_V2: StoredAnalystModel = {
  version: 2,
  tables: [
    {
      schema: "raw_jde",
      name: "orders",
      columns: [{ name: "id", pgType: "uuid" }],
    },
    {
      schema: "raw_jde",
      name: "shipments",
      columns: [{ name: "id", pgType: "uuid" }],
    },
  ],
};

const PREVIOUS_MODEL: StoredAnalystModel = {
  version: 2,
  tables: [
    {
      schema: "raw_jde",
      name: "orders",
      columns: [{ name: "id", pgType: "uuid" }],
    },
    {
      schema: "raw_jde",
      name: "legacy_dropped",
      columns: [{ name: "id", pgType: "uuid" }],
    },
  ],
};

function internalRow(over: Partial<SourceRow> = {}): SourceRow {
  return {
    id: "srv-1",
    tenant_id: TENANT,
    name: "Warehouse",
    slug: "warehouse",
    url: "https://api.example.com/mcp/analyst/warehouse",
    status: "approved",
    enabled: true,
    runtime_metadata: {
      analyst_source: {
        host: "wh.example.rds.amazonaws.com",
        port: 5432,
        database: "thinkwork_warehouse",
        dbUser: "warehouse_reader",
        tls: "required",
        credentialSecretArn: "arn:secret:warehouse",
        tenantScoped: true,
        schema: "raw_jde",
        kind: "internal",
        clusterId: "thinkwork-dev-aurora",
        sourceGeneration: "gen-1",
      },
    },
    ...over,
  };
}

interface Harness {
  deps: RefreshDeps;
  calls: string[];
  state: {
    acquireResult: boolean;
    commitResult: boolean;
    failWrites: Record<string, unknown>[];
    committed: Array<{ attemptId: string; generation: string }>;
    row: SourceRow | null;
    failAt?: string;
    probeVerdict: ConnectionProbeVerdict;
  };
}

function harness(over: Partial<Harness["state"]> = {}): Harness {
  const calls: string[] = [];
  const state: Harness["state"] = {
    acquireResult: true,
    commitResult: true,
    failWrites: [],
    committed: [],
    row: internalRow(),
    probeVerdict: { status: "ok", checkedAt: new Date(NOW).toISOString() },
    ...over,
  };
  const step = (name: string) => async () => {
    calls.push(name);
    if (state.failAt === name) throw new Error(`${name} exploded`);
  };
  const deps: RefreshDeps = {
    nowMs: () => NOW,
    loadRow: async () => state.row,
    stateOps: {
      acquire: async (_id, attemptId) => {
        calls.push(`acquire:${attemptId.slice(0, 4)}`);
        return state.acquireResult;
      },
      fail: async (_id, _attemptId, refresh) => {
        calls.push("state:fail");
        state.failWrites.push(refresh);
        return true;
      },
      commit: async (_id, attemptId, generation) => {
        calls.push("state:commit");
        if (!state.commitResult) return false;
        state.committed.push({ attemptId, generation });
        return true;
      },
    },
    resolveTenant: async () => "acme",
    resolvePassword: async () => {
      calls.push("credential");
      if (state.failAt === "credential") throw new Error("secret unreadable");
      return "stored-password";
    },
    reconcileInternalGrants: async (input) => {
      calls.push(`grants:${input.schema}@${input.clusterId}`);
      if (state.failAt === "grants") throw new Error("ACL reconcile failed");
    },
    probeModel: async (input) => {
      calls.push(`model:${input.schema}:pw=${input.password}`);
      if (state.failAt === "model") throw new Error("introspection failed");
      return MODEL_V2;
    },
    fetchPreviousModel: async () => {
      calls.push("previous");
      return PREVIOUS_MODEL;
    },
    writeArtifacts: step("artifacts") as RefreshDeps["writeArtifacts"],
    materializeFolders: step("folders") as RefreshDeps["materializeFolders"],
    immediateProbe: async () => {
      calls.push("probe");
      if (state.failAt === "probe") throw new Error("probe connect failed");
      return state.probeVerdict;
    },
  };
  return { deps, calls, state };
}

const INPUT = {
  tenantId: TENANT,
  serverId: "srv-1",
  signedBy: "operator:op@example.com" as const,
};

describe("refreshAnalystDataSource (THINK-283 U5)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("covers AE3/AE4: internal refresh reconciles ACLs, updates artifacts, probes, then commits with added/removed results", async () => {
    const h = harness();
    const result = await refreshAnalystDataSource(INPUT, h.deps);

    expect(result).toEqual({
      serverId: "srv-1",
      slug: "warehouse",
      addedTables: ["raw_jde.shipments"],
      removedTables: ["raw_jde.legacy_dropped"],
      tables: 2,
    });
    // Lifecycle order: lease FIRST (withhold before any side effect), then
    // credential → grants → model → artifacts → folders → probe → commit.
    expect(h.calls[0]).toMatch(/^acquire:/);
    expect(h.calls.slice(1)).toEqual([
      "credential",
      "grants:raw_jde@thinkwork-dev-aurora",
      "model:raw_jde:pw=stored-password",
      "previous",
      "artifacts",
      "folders",
      "probe",
      "state:commit",
    ]);
    // Commit minted a NEW opaque generation.
    expect(h.state.committed).toHaveLength(1);
    expect(h.state.committed[0]!.generation).not.toBe("gen-1");
    expect(h.state.failWrites).toHaveLength(0);
  });

  it("external refresh executes NO ACL step (DBA-granted surface only)", async () => {
    const h = harness({
      row: internalRow({
        runtime_metadata: {
          analyst_source: {
            host: "ext.example.com",
            port: 5432,
            database: "sales",
            dbUser: "analyst_ro",
            tls: "verify-full",
            credentialSecretArn: "arn:secret:sales",
            tenantScoped: true,
            schema: "sales",
            kind: "external",
            sourceGeneration: "gen-1",
          },
        },
      }),
    });
    await refreshAnalystDataSource(INPUT, h.deps);
    expect(h.calls.some((c) => c.startsWith("grants:"))).toBe(false);
    expect(h.calls).toContain("model:sales:pw=stored-password");
  });

  it("legacy rows without kind/schema refresh as external/public (no grants issued)", async () => {
    const h = harness({
      row: internalRow({
        runtime_metadata: {
          analyst_source: {
            host: "legacy.example.com",
            port: 5432,
            database: "sales",
            dbUser: "analyst_ro",
            tls: "verify-full",
            credentialSecretArn: "arn:secret:legacy",
            tenantScoped: true,
          },
        },
      }),
    });
    await refreshAnalystDataSource(INPUT, h.deps);
    expect(h.calls.some((c) => c.startsWith("grants:"))).toBe(false);
    expect(h.calls).toContain("model:public:pw=stored-password");
  });

  it("authorization: unknown row, non-sourced (builtin) row, and malformed metadata reject with NO writes", async () => {
    const missing = harness({ row: null });
    await expect(refreshAnalystDataSource(INPUT, missing.deps)).rejects.toThrow(
      AnalystRefreshInputError,
    );
    expect(missing.calls).toEqual([]);

    const builtin = harness({
      row: internalRow({
        url: "https://api.example.com/mcp/analyst",
        slug: "postgres-dev",
      }),
    });
    await expect(refreshAnalystDataSource(INPUT, builtin.deps)).rejects.toThrow(
      /built-in connector/,
    );
    expect(builtin.calls).toEqual([]);

    const malformed = harness({
      row: internalRow({ runtime_metadata: { analyst_source: { host: 7 } } }),
    });
    await expect(
      refreshAnalystDataSource(INPUT, malformed.deps),
    ).rejects.toThrow(/malformed runtime metadata/);
    expect(malformed.calls).toEqual([]);
  });

  it("concurrency: a live lease loses with CONFLICT and performs no side effects", async () => {
    const h = harness({ acquireResult: false });
    await expect(refreshAnalystDataSource(INPUT, h.deps)).rejects.toThrow(
      AnalystRefreshConflictError,
    );
    // Only the acquire attempt ran.
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatch(/^acquire:/);
  });

  it("concurrency: a superseded attempt's late completion cannot commit (CAS returns false)", async () => {
    const h = harness({ commitResult: false });
    await expect(refreshAnalystDataSource(INPUT, h.deps)).rejects.toThrow(
      /superseded/,
    );
    expect(h.state.committed).toHaveLength(0);
  });

  it("failure path: a forced failure after EACH side effect persists a durable failed step and never commits", async () => {
    for (const failAt of [
      "credential",
      "grants",
      "model",
      "artifacts",
      "folders",
      "probe",
    ]) {
      const h = harness({ failAt });
      const err = await refreshAnalystDataSource(INPUT, h.deps).catch(
        (e: unknown) => e,
      );
      expect(err, `failAt=${failAt}`).toBeInstanceOf(AnalystRefreshStepError);
      expect((err as AnalystRefreshStepError).step).toBe(failAt);
      // Durable failed state with the sanitized step detail (survives
      // reloads; dispatch + broker stay withheld until a retry succeeds).
      expect(h.state.failWrites, `failAt=${failAt}`).toHaveLength(1);
      expect(h.state.failWrites[0]).toMatchObject({
        status: "failed",
        step: failAt,
      });
      expect(String(h.state.failWrites[0]!.detail)).toContain("retry");
      expect(h.state.committed).toHaveLength(0);
    }
  });

  it("failure path: an immediate probe returning a FAIL verdict withholds (no commit)", async () => {
    const h = harness({
      probeVerdict: {
        status: "fail",
        reason: "unexpected_surface",
        detail: "platform.mirror_batch readable",
        checkedAt: new Date(NOW).toISOString(),
      },
    });
    const err = await refreshAnalystDataSource(INPUT, h.deps).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AnalystRefreshStepError);
    expect((err as AnalystRefreshStepError).step).toBe("probe");
    expect(String(h.state.failWrites[0]!.detail)).toContain("mirror_batch");
    expect(h.state.committed).toHaveLength(0);
  });

  it("internal refresh with no stored clusterId fails at grants with re-register remediation", async () => {
    const meta = internalRow().runtime_metadata as Record<string, unknown>;
    const source = {
      ...(meta.analyst_source as Record<string, unknown>),
    };
    delete source.clusterId;
    const h = harness({
      row: internalRow({ runtime_metadata: { analyst_source: source } }),
    });
    const err = await refreshAnalystDataSource(INPUT, h.deps).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AnalystRefreshStepError);
    expect(String((err as Error).message)).toContain("clusterId");
  });

  it("diffModels: qualified add/remove; a missing previous model reads as all-added", () => {
    expect(diffModels(PREVIOUS_MODEL, MODEL_V2)).toEqual({
      addedTables: ["raw_jde.shipments"],
      removedTables: ["raw_jde.legacy_dropped"],
    });
    expect(diffModels(null, MODEL_V2)).toEqual({
      addedTables: ["raw_jde.orders", "raw_jde.shipments"],
      removedTables: [],
    });
  });

  it("lease constant is bounded (operator takeover is possible)", () => {
    expect(ANALYST_REFRESH_LEASE_MS).toBeGreaterThan(0);
    expect(ANALYST_REFRESH_LEASE_MS).toBeLessThanOrEqual(30 * 60 * 1000);
  });
});
