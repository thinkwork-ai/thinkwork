/**
 * internal-clusters tests (THINK-239). Exercises the listInternalClusters
 * orchestration + alreadyRegistered accounting and the fail-soft-per-cluster
 * behavior, all with injected deps (no AWS / no Postgres).
 */

import { describe, expect, it } from "vitest";

import {
  adminDbSecretName,
  internalClusterIdPrefix,
  listInternalClusters,
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
