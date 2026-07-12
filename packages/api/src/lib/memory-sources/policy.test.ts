import { describe, expect, it } from "vitest";

import {
  assertBoundaryWithin,
  grantInactiveReason,
  MemoryAuthorizationError,
} from "./policy.js";

describe("MemoryAuthorizationError", () => {
  it("has a stable name for callers that switch on it", () => {
    const err = new MemoryAuthorizationError("nope");
    expect(err.name).toBe("MemoryAuthorizationError");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("nope");
  });
});

describe("assertBoundaryWithin", () => {
  it("passes when the config boundary is a subset of the grant envelope", () => {
    expect(() =>
      assertBoundaryWithin(
        { maxRecords: 100, pageSize: 50, objects: ["companies", "people"] },
        { maxRecords: 100, pageSize: 10, objects: ["companies"] },
      ),
    ).not.toThrow();
  });

  it("rejects a numeric cap above the grant's, naming the key", () => {
    expect(() =>
      assertBoundaryWithin({ maxRecords: 100 }, { maxRecords: 101 }),
    ).toThrow(/maxRecords/);
    expect(() =>
      assertBoundaryWithin({ maxRecords: 100 }, { maxRecords: 101 }),
    ).toThrow(MemoryAuthorizationError);
  });

  it("rejects an array value outside the grant allowlist, naming the key", () => {
    expect(() =>
      assertBoundaryWithin(
        { objects: ["companies"] },
        { objects: ["companies", "opportunities"] },
      ),
    ).toThrow(/objects/);
    expect(() =>
      assertBoundaryWithin(
        { urls: ["https://a.example"] },
        { urls: ["https://b.example"] },
      ),
    ).toThrow(MemoryAuthorizationError);
  });

  it("rejects a non-numeric config value against a numeric grant cap", () => {
    expect(() =>
      assertBoundaryWithin({ pageSize: 50 }, { pageSize: "all" }),
    ).toThrow(/pageSize/);
  });

  it("rejects a non-array config value against a grant allowlist", () => {
    expect(() =>
      assertBoundaryWithin({ labels: ["a"] }, { labels: "a" }),
    ).toThrow(/labels/);
  });

  it("leaves keys the grant does not set unconstrained", () => {
    expect(() =>
      assertBoundaryWithin({}, { maxRecords: 10_000, domains: ["anything"] }),
    ).not.toThrow();
    expect(() =>
      assertBoundaryWithin({ maxRecords: 5 }, { maxRecords: 5, extra: true }),
    ).not.toThrow();
  });
});

describe("grantInactiveReason (pure expiry logic)", () => {
  const now = new Date("2026-07-11T00:00:00.000Z");

  it("returns null for an active grant with no expiry", () => {
    expect(
      grantInactiveReason({ status: "active", expires_at: null }, now),
    ).toBeNull();
  });

  it("returns null for an active grant expiring in the future", () => {
    expect(
      grantInactiveReason(
        { status: "active", expires_at: new Date("2026-08-01T00:00:00.000Z") },
        now,
      ),
    ).toBeNull();
  });

  it("reports 'expired' when expires_at has passed, even if status is stale-active", () => {
    expect(
      grantInactiveReason(
        { status: "active", expires_at: new Date("2026-07-10T23:59:59.000Z") },
        now,
      ),
    ).toBe("expired");
  });

  it("reports 'revoked' and 'expired' statuses", () => {
    expect(
      grantInactiveReason({ status: "revoked", expires_at: null }, now),
    ).toBe("revoked");
    expect(
      grantInactiveReason({ status: "expired", expires_at: null }, now),
    ).toBe("expired");
  });
});

// getActiveGrant / requireActiveGrant / revokeGrant query real drizzle table
// objects (memory_source_authorizations); exercising them needs either the
// landed schema plus a pg test double or a dev-stage run. Deferred to dev
// verification per the U1 precedent — the pure decision logic they lean on
// (grantInactiveReason, assertBoundaryWithin) is covered above.
