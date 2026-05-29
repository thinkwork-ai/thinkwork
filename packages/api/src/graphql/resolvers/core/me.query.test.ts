/**
 * Plan 2026-05-29-006 U5 (R9) — the `me` query resolves its cognito path
 * through the stable-sub resolver, so a healed Google user whose token lost
 * its `email` claim is not reported as signed-out. Non-cognito callers keep
 * the x-principal-id impersonation path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, selectQueue, mockResolveCallerUserId } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const mockDb = {
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
      };
      return chain;
    }),
  };
  return {
    mockDb,
    selectQueue,
    mockResolveCallerUserId: vi.fn(async () => null as string | null),
  };
});

vi.mock("../../utils.js", () => ({
  db: mockDb,
  eq: vi.fn((field: unknown, value: unknown) => ({ __eq: { field, value } })),
  users: { __table__: "users" },
  snakeToCamel: (row: Record<string, unknown>) => ({ ...row, __camel: true }),
}));

vi.mock("./resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

import { me } from "./me.query.js";

beforeEach(() => {
  selectQueue.length = 0;
  mockResolveCallerUserId.mockReset();
  mockResolveCallerUserId.mockResolvedValue(null);
});

describe("me query", () => {
  it("resolves a healed cognito user with an email-less token via resolveCallerUserId", async () => {
    mockResolveCallerUserId.mockResolvedValue("user-9");
    selectQueue.push([{ id: "user-9", email: "eric@example.com" }]);

    const result = await me(
      {},
      {},
      { auth: { authType: "cognito", principalId: "sub-G", email: null }, headers: {} } as any,
    );

    expect(mockResolveCallerUserId).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: "user-9", __camel: true });
  });

  it("returns null for a cognito caller the resolver cannot resolve", async () => {
    mockResolveCallerUserId.mockResolvedValue(null);

    const result = await me(
      {},
      {},
      { auth: { authType: "cognito", principalId: "sub-G", email: null }, headers: {} } as any,
    );

    expect(result).toBeNull();
  });

  it("uses the x-principal-id header path for non-cognito callers (no resolver call)", async () => {
    selectQueue.push([{ id: "imp-user", email: "ops@example.com" }]);

    const result = await me(
      {},
      {},
      {
        auth: { authType: "apikey", principalId: null },
        headers: { "x-principal-id": "imp-user" },
      } as any,
    );

    expect(mockResolveCallerUserId).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: "imp-user" });
  });
});
