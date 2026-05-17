import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireMemoryUserScope } from "./require-user-scope.js";
import { resolveCaller } from "./resolve-auth-user.js";

vi.mock("./resolve-auth-user.js", () => ({
  resolveCaller: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: { execute: vi.fn() },
  sql: vi.fn(),
}));

const resolveCallerMock = vi.mocked(resolveCaller);

describe("requireMemoryUserScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults memory scope to the authenticated requester when no user id is supplied", async () => {
    resolveCallerMock.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "requester-1",
    });

    await expect(
      requireMemoryUserScope(
        { auth: { tenantId: "tenant-1", authType: "jwt" } } as any,
        { tenantId: "tenant-1" },
      ),
    ).resolves.toEqual({ tenantId: "tenant-1", userId: "requester-1" });
  });

  it("rejects requester defaulting across tenants", async () => {
    resolveCallerMock.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "requester-1",
    });

    await expect(
      requireMemoryUserScope(
        { auth: { tenantId: "tenant-1", authType: "jwt" } } as any,
        { tenantId: "tenant-2" },
      ),
    ).rejects.toThrow("Access denied: tenant mismatch");
  });
});
