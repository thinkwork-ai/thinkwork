/**
 * Plan 2026-05-29-006 U5 — resolveCallerFromAuth resolution order, guarded
 * backfill, and the email_verified gate.
 *
 * The resolver runs up to three reads in order — by cognito_sub, by id, by
 * email — and an opportunistic UPDATE that backfills cognito_sub onto a row
 * that lacks one. The drizzle builder is mocked: each `await
 * db.select().from().where()` consumes one queued result array (FIFO, in
 * resolution order), and `db.update().set().where()` records the written
 * values and is driven by `updateBehavior` so the conflict (23505) and
 * concurrent-no-op paths can be exercised.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthResult } from "../../../lib/cognito-auth.js";

const { mockDb, selectQueue, updateCalls, updateBehavior } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const updateCalls: Array<{ values: Record<string, unknown> }> = [];
  const updateBehavior = { mode: "ok" as "ok" | "conflict" | "error" };

  const mockDb = {
    select: vi.fn((_cols?: unknown) => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
      };
      return chain;
    }),
    update: vi.fn((_table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => {
          updateCalls.push({ values });
          if (updateBehavior.mode === "conflict") {
            return Promise.reject(
              Object.assign(new Error("duplicate key"), { code: "23505" }),
            );
          }
          if (updateBehavior.mode === "error") {
            return Promise.reject(new Error("transient db error"));
          }
          return Promise.resolve([]); // ok / concurrent no-op both resolve
        }),
      })),
    })),
  };

  return { mockDb, selectQueue, updateCalls, updateBehavior };
});

vi.mock("../../utils.js", () => ({
  db: mockDb,
  eq: vi.fn((field: unknown, value: unknown) => ({ __eq: { field, value } })),
  and: vi.fn((...conds: unknown[]) => ({ __and: conds })),
  isNull: vi.fn((field: unknown) => ({ __isNull: field })),
  users: { __table__: "users" },
}));

import { resolveCallerFromAuth } from "./resolve-auth-user.js";

function cognitoAuth(over: Partial<AuthResult> = {}): AuthResult {
  return {
    authType: "cognito",
    principalId: "sub-default",
    email: null,
    emailVerified: false,
    tenantId: null,
    agentId: null,
    ...over,
  };
}

beforeEach(() => {
  selectQueue.length = 0;
  updateCalls.length = 0;
  updateBehavior.mode = "ok";
  vi.restoreAllMocks();
});

describe("resolveCallerFromAuth", () => {
  it("resolves by stored cognito_sub even when email is null, with no backfill", async () => {
    // Step 1 hit — the core bug fix.
    selectQueue.push([{ id: "user-1", tenant_id: "tenant-1" }]);

    const result = await resolveCallerFromAuth(
      cognitoAuth({ principalId: "sub-G", email: null }),
    );

    expect(result).toEqual({ userId: "user-1", tenantId: "tenant-1" });
    expect(updateCalls).toHaveLength(0); // already linked
  });

  it("resolves a native user by id and backfills cognito_sub tautologically", async () => {
    selectQueue.push([]); // step 1 (by sub) miss
    selectQueue.push([
      { id: "sub-N", tenant_id: "tenant-1", cognito_sub: null },
    ]); // step 2 (by id) hit

    const result = await resolveCallerFromAuth(
      cognitoAuth({ principalId: "sub-N", email: null }),
    );

    expect(result).toEqual({ userId: "sub-N", tenantId: "tenant-1" });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.values).toEqual({ cognito_sub: "sub-N" });
  });

  it("resolves an unhealed Google user by VERIFIED email and backfills the sub", async () => {
    selectQueue.push([]); // by sub miss
    selectQueue.push([]); // by id miss
    selectQueue.push([
      { id: "user-2", tenant_id: "tenant-2", cognito_sub: null },
    ]); // by email hit

    const result = await resolveCallerFromAuth(
      cognitoAuth({
        principalId: "sub-G2",
        email: "eric@example.com",
        emailVerified: true,
      }),
    );

    expect(result).toEqual({ userId: "user-2", tenantId: "tenant-2" });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.values).toEqual({ cognito_sub: "sub-G2" });
  });

  it("resolves by UNVERIFIED email but does NOT backfill (takeover guard, KTD-5)", async () => {
    selectQueue.push([]); // by sub miss
    selectQueue.push([]); // by id miss
    selectQueue.push([
      { id: "user-2", tenant_id: "tenant-2", cognito_sub: null },
    ]); // by email hit

    const result = await resolveCallerFromAuth(
      cognitoAuth({
        principalId: "sub-attacker",
        email: "eric@example.com",
        emailVerified: false,
      }),
    );

    expect(result).toEqual({ userId: "user-2", tenantId: "tenant-2" });
    expect(updateCalls).toHaveLength(0); // no permanent bind on unverified email
  });

  it("does not change identity and logs an error when backfill conflicts (23505)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    updateBehavior.mode = "conflict";
    selectQueue.push([]); // by sub miss
    selectQueue.push([
      { id: "sub-N", tenant_id: "tenant-1", cognito_sub: null },
    ]); // by id hit → backfill conflicts

    const result = await resolveCallerFromAuth(
      cognitoAuth({ principalId: "sub-N" }),
    );

    expect(result).toEqual({ userId: "sub-N", tenantId: "tenant-1" });
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]?.[0]).toContain("23505");
  });

  it("does not change identity when backfill is a concurrent no-op (0 rows)", async () => {
    // updateBehavior stays "ok" — resolves empty, mirroring the loser of a
    // same-user race whose `cognito_sub IS NULL` guard matched 0 rows.
    selectQueue.push([]); // by sub miss
    selectQueue.push([
      { id: "sub-N", tenant_id: "tenant-1", cognito_sub: null },
    ]);

    const result = await resolveCallerFromAuth(
      cognitoAuth({ principalId: "sub-N" }),
    );

    expect(result).toEqual({ userId: "sub-N", tenantId: "tenant-1" });
    expect(updateCalls).toHaveLength(1); // attempted, harmless either way
  });

  it("does not throw when backfill fails transiently (warn, not error)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    updateBehavior.mode = "error";
    selectQueue.push([]);
    selectQueue.push([
      { id: "sub-N", tenant_id: "tenant-1", cognito_sub: null },
    ]);

    const result = await resolveCallerFromAuth(
      cognitoAuth({ principalId: "sub-N" }),
    );

    expect(result).toEqual({ userId: "sub-N", tenantId: "tenant-1" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("returns null when no sub match and the token has no email", async () => {
    selectQueue.push([]); // by sub miss
    selectQueue.push([]); // by id miss

    const result = await resolveCallerFromAuth(
      cognitoAuth({ principalId: "sub-X", email: null }),
    );

    expect(result).toEqual({ userId: null, tenantId: null });
    expect(updateCalls).toHaveLength(0);
  });

  it("returns null when email is present but matches no row", async () => {
    selectQueue.push([]); // by sub miss
    selectQueue.push([]); // by id miss
    selectQueue.push([]); // by email miss

    const result = await resolveCallerFromAuth(
      cognitoAuth({
        principalId: "sub-X",
        email: "nobody@example.com",
        emailVerified: true,
      }),
    );

    expect(result).toEqual({ userId: null, tenantId: null });
    expect(updateCalls).toHaveLength(0);
  });

  it("derives tenantId from the resolved row on the sub path (closes the tenant gap)", async () => {
    // auth.tenantId is null (Google token has no custom:tenant_id) but the
    // resolved row carries it.
    selectQueue.push([{ id: "user-1", tenant_id: "tenant-resolved" }]);

    const result = await resolveCallerFromAuth(
      cognitoAuth({ principalId: "sub-G", tenantId: null }),
    );

    expect(result.tenantId).toBe("tenant-resolved");
  });

  it("returns header-derived identity for apikey/service callers and null for sub-less cognito", async () => {
    expect(
      await resolveCallerFromAuth({
        authType: "apikey",
        principalId: "imp-user",
        email: "ops@example.com",
        emailVerified: false,
        tenantId: "tenant-h",
        agentId: "agent-1",
      }),
    ).toEqual({ userId: "imp-user", tenantId: "tenant-h" });

    expect(
      await resolveCallerFromAuth({
        authType: "service",
        principalId: null,
        email: null,
        emailVerified: false,
        tenantId: "tenant-h",
        agentId: null,
      }),
    ).toEqual({ userId: null, tenantId: "tenant-h" });

    expect(
      await resolveCallerFromAuth(cognitoAuth({ principalId: null })),
    ).toEqual({ userId: null, tenantId: null });

    expect(updateCalls).toHaveLength(0); // no DB writes on these paths
  });
});
