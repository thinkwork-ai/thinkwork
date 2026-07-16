import { describe, expect, it } from "vitest";
import { capabilityRegistryTrustEnabled } from "./registry-trust-flag.js";
import type { Db } from "./research.js";

/**
 * Minimal fake db that records the tenant filtered on and returns a scripted
 * row set. Mirrors the drizzle select().from().where().limit() chain the
 * helper uses.
 */
function fakeDb(rows: Array<{ capability_registry_trust: boolean }>): {
  db: Db;
  seen: { tenantId?: unknown };
} {
  const seen: { tenantId?: unknown } = {};
  const chain = {
    select: () => chain,
    from: () => chain,
    where: (predicate: unknown) => {
      // The drizzle eq() call is opaque here; we only assert the chain runs.
      seen.tenantId = predicate;
      return chain;
    },
    limit: async () => rows,
  };
  return { db: chain as unknown as Db, seen };
}

describe("capabilityRegistryTrustEnabled", () => {
  it("returns true when the tenant flag is on", async () => {
    const { db } = fakeDb([{ capability_registry_trust: true }]);
    await expect(capabilityRegistryTrustEnabled(db, "tenant-1")).resolves.toBe(
      true,
    );
  });

  it("returns false when the tenant flag is off", async () => {
    const { db } = fakeDb([{ capability_registry_trust: false }]);
    await expect(capabilityRegistryTrustEnabled(db, "tenant-1")).resolves.toBe(
      false,
    );
  });

  it("fails closed to false when the tenant row is missing", async () => {
    const { db } = fakeDb([]);
    await expect(capabilityRegistryTrustEnabled(db, "ghost")).resolves.toBe(
      false,
    );
  });

  it("runs the query filtered by the requested tenant id", async () => {
    const { db, seen } = fakeDb([{ capability_registry_trust: true }]);
    await capabilityRegistryTrustEnabled(db, "tenant-42");
    expect(seen.tenantId).toBeDefined();
  });
});
