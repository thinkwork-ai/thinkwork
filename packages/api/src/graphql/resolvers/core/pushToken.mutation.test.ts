import { beforeEach, describe, expect, it, vi } from "vitest";

const { updates, resolveCallerFromAuth } = vi.hoisted(() => ({
  updates: [] as Array<{ values: unknown; where: unknown }>,
  resolveCallerFromAuth: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  users: { id: "users.id" },
  eq: (left: unknown, right: unknown) => ({ left, right }),
  db: {
    update: vi.fn(() => {
      const entry: { values?: unknown; where?: unknown } = {};
      const chain = {
        set(values: unknown) {
          entry.values = values;
          return chain;
        },
        async where(where: unknown) {
          entry.where = where;
          updates.push(entry as { values: unknown; where: unknown });
        },
      };
      return chain;
    }),
  },
}));

vi.mock("./resolve-auth-user.js", () => ({ resolveCallerFromAuth }));

import { registerPushToken } from "./registerPushToken.mutation.js";
import { unregisterPushToken } from "./unregisterPushToken.mutation.js";

const ctx = {
  auth: {
    authType: "cognito",
    email: "shared@example.com",
    principalId: "unadmitted-subject",
  },
} as any;

beforeEach(() => {
  updates.length = 0;
  resolveCallerFromAuth.mockReset();
});

describe("push-token identity admission", () => {
  it("registers only against the immutable admitted user id", async () => {
    resolveCallerFromAuth.mockResolvedValue({
      userId: "admitted-user",
      tenantId: "tenant-1",
    });

    await expect(
      registerPushToken(null, { input: { token: "ExponentPushToken[secret]" } }, ctx),
    ).resolves.toBe(true);

    expect(resolveCallerFromAuth).toHaveBeenCalledWith(ctx.auth);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.where).toEqual({
      left: "users.id",
      right: "admitted-user",
    });
  });

  it("does not use email or subject fallbacks when admission fails", async () => {
    resolveCallerFromAuth.mockResolvedValue({ userId: null, tenantId: null });

    await expect(
      registerPushToken(null, { input: { token: "ExponentPushToken[secret]" } }, ctx),
    ).rejects.toThrow("Unauthorized");
    await expect(unregisterPushToken(null, {}, ctx)).rejects.toThrow(
      "Unauthorized",
    );
    expect(updates).toHaveLength(0);
  });

  it("unregisters only the admitted user", async () => {
    resolveCallerFromAuth.mockResolvedValue({
      userId: "admitted-user",
      tenantId: "tenant-1",
    });

    await expect(unregisterPushToken(null, {}, ctx)).resolves.toBe(true);
    expect(updates[0]!.where).toEqual({
      left: "users.id",
      right: "admitted-user",
    });
  });
});
