/**
 * internal-clusters tests (THINK-239). Exercises the listInternalClusters
 * orchestration + alreadyRegistered accounting and the fail-soft-per-cluster
 * behavior, all with injected deps (no AWS / no Postgres).
 */

import { describe, expect, it } from "vitest";

import {
  adminDbSecretName,
  internalClusterIdPrefix,
  InternalSchemaDiscoveryError,
  listInternalClusters,
  listInternalSchemas,
  type AdminCredential,
  type RawInternalCluster,
} from "./internal-clusters.js";

function fakeDb(rows: { slug: string; runtime_metadata: unknown }[]) {
  return {
    select: () => ({
      from: () => ({
        where: async () => rows,
      }),
    }),
  } as never;
}

const admin: AdminCredential = { username: "master", password: "secret" };

describe("name helpers", () => {
  it("derives the stage-scoped prefix and admin secret name", () => {
    expect(internalClusterIdPrefix("dev")).toBe("thinkwork-dev-");
    expect(adminDbSecretName("prod")).toBe("thinkwork-prod-db-credentials");
  });
});

describe("listInternalClusters", () => {
  const cluster: RawInternalCluster = {
    clusterId: "thinkwork-dev-aurora",
    endpoint: "aurora.dev.rds.amazonaws.com",
    port: 5432,
  };

  it("flags already-registered databases (builtin thinkwork + sourced host/db match)", async () => {
    const rows = [
      { slug: "postgres-dev", runtime_metadata: {} },
      {
        slug: "sales-pg",
        runtime_metadata: {
          analyst_source: {
            host: "aurora.dev.rds.amazonaws.com",
            database: "sales",
          },
        },
      },
    ];
    const result = await listInternalClusters({
      tenantId: "t1",
      stage: "dev",
      db: fakeDb(rows),
      describeClusters: async () => [cluster],
      resolveAdmin: async () => admin,
      enumerate: async () => ["analytics", "sales", "thinkwork"],
    });

    expect(result).toHaveLength(1);
    const byName = Object.fromEntries(
      result[0]!.databases.map((d) => [d.name, d.alreadyRegistered]),
    );
    expect(byName).toEqual({
      analytics: false,
      sales: true, // sourced row on this endpoint
      thinkwork: true, // builtin postgres-dev row exists
    });
  });

  it("does not flag thinkwork when no builtin row exists", async () => {
    const result = await listInternalClusters({
      tenantId: "t1",
      stage: "dev",
      db: fakeDb([]),
      describeClusters: async () => [cluster],
      resolveAdmin: async () => admin,
      enumerate: async () => ["thinkwork"],
    });
    expect(result[0]!.databases).toEqual([
      { name: "thinkwork", alreadyRegistered: false },
    ]);
  });

  it("returns an empty database list when no admin credential resolves", async () => {
    const result = await listInternalClusters({
      tenantId: "t1",
      stage: "dev",
      db: fakeDb([]),
      describeClusters: async () => [cluster],
      resolveAdmin: async () => null,
      enumerate: async () => {
        throw new Error("should not be called without a credential");
      },
    });
    expect(result[0]!.databases).toEqual([]);
  });

  it("fails soft (empty databases) when a cluster cannot be enumerated", async () => {
    const result = await listInternalClusters({
      tenantId: "t1",
      stage: "dev",
      db: fakeDb([]),
      describeClusters: async () => [cluster],
      resolveAdmin: async () => admin,
      enumerate: async () => {
        throw new Error("connect timeout");
      },
    });
    expect(result[0]!.databases).toEqual([]);
  });
});

describe("listInternalSchemas (THINK-283)", () => {
  const cluster: RawInternalCluster = {
    clusterId: "thinkwork-dev-aurora",
    endpoint: "aurora.dev.rds.amazonaws.com",
    port: 5432,
  };

  /** Fake catalog: schema rows the discovery query returns. */
  function fakeOpenClient(
    rows: Record<string, unknown>[],
    opts: { failConnect?: boolean; failQuery?: boolean } = {},
  ) {
    const calls: { database?: string } = {};
    const openClient = (async (params: { database: string }) => {
      calls.database = params.database;
      if (opts.failConnect) throw new Error("connect timeout");
      return {
        query: async () => {
          if (opts.failQuery) throw new Error("permission denied");
          return { rows };
        },
        end: async () => undefined,
      };
    }) as never;
    return { openClient, calls };
  }

  const baseDeps = {
    tenantId: "t1",
    clusterId: "thinkwork-dev-aurora",
    database: "thinkwork_warehouse",
    stage: "dev",
    describeClusters: async () => [cluster],
    resolveAdmin: async () => admin,
    enumerate: async () => ["thinkwork_warehouse", "sales"],
  };

  it("covers AE1: returns raw_jde/platform with counts, includes empty public, marks exact registrations", async () => {
    const { openClient, calls } = fakeOpenClient([
      { name: "platform", eligible: 3 },
      { name: "public", eligible: 0 },
      { name: "raw_jde", eligible: 12 },
    ]);
    const rows = [
      {
        slug: "warehouse-raw",
        runtime_metadata: {
          analyst_source: {
            host: "aurora.dev.rds.amazonaws.com",
            database: "thinkwork_warehouse",
            schema: "raw_jde",
          },
        },
      },
      // Legacy sourced row without a schema counts as public — but on a
      // DIFFERENT database, so it must not mark anything here.
      {
        slug: "sales-pg",
        runtime_metadata: {
          analyst_source: {
            host: "aurora.dev.rds.amazonaws.com",
            database: "sales",
          },
        },
      },
    ];
    const result = await listInternalSchemas({
      ...baseDeps,
      db: fakeDb(rows),
      openClient,
    });
    expect(calls.database).toBe("thinkwork_warehouse");
    expect(result).toEqual([
      { name: "platform", eligibleTableCount: 3, alreadyRegistered: false },
      { name: "public", eligibleTableCount: 0, alreadyRegistered: false },
      { name: "raw_jde", eligibleTableCount: 12, alreadyRegistered: true },
    ]);
  });

  it("a legacy schema-less row marks public on ITS database; another schema stays selectable", async () => {
    const { openClient } = fakeOpenClient([
      { name: "public", eligible: 4 },
      { name: "raw_jde", eligible: 12 },
    ]);
    const rows = [
      {
        slug: "warehouse-legacy",
        runtime_metadata: {
          analyst_source: {
            host: "aurora.dev.rds.amazonaws.com",
            database: "thinkwork_warehouse",
          },
        },
      },
    ];
    const result = await listInternalSchemas({
      ...baseDeps,
      db: fakeDb(rows),
      openClient,
    });
    expect(result).toEqual([
      { name: "public", eligibleTableCount: 4, alreadyRegistered: true },
      { name: "raw_jde", eligibleTableCount: 12, alreadyRegistered: false },
    ]);
  });

  it("unknown cluster, unknown database, missing admin, and connection failures are operator-safe errors", async () => {
    const { openClient } = fakeOpenClient([]);
    await expect(
      listInternalSchemas({
        ...baseDeps,
        clusterId: "nope",
        db: fakeDb([]),
        openClient,
      }),
    ).rejects.toThrow(InternalSchemaDiscoveryError);
    await expect(
      listInternalSchemas({
        ...baseDeps,
        database: "not-there",
        db: fakeDb([]),
        openClient,
      }),
    ).rejects.toThrow(/database "not-there" was not found/);
    await expect(
      listInternalSchemas({
        ...baseDeps,
        resolveAdmin: async () => null,
        db: fakeDb([]),
        openClient,
      }),
    ).rejects.toThrow(/no admin credential/);

    const failing = fakeOpenClient([], { failConnect: true });
    await expect(
      listInternalSchemas({
        ...baseDeps,
        db: fakeDb([]),
        openClient: failing.openClient,
      }),
    ).rejects.toThrow(/could not connect/);

    const queryFailing = fakeOpenClient([], { failQuery: true });
    await expect(
      listInternalSchemas({
        ...baseDeps,
        db: fakeDb([]),
        openClient: queryFailing.openClient,
      }),
    ).rejects.toThrow(/could not read the schema catalog/);
  });
});
