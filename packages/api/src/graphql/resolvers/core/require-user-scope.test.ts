import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../utils.js";
import { requireMemoryUserScope } from "./require-user-scope.js";
import { resolveCaller } from "./resolve-auth-user.js";

vi.mock("./resolve-auth-user.js", () => ({
  resolveCaller: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: { execute: vi.fn() },
  sql: vi.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: Array.from(strings),
      values,
    }),
  ),
}));

const resolveCallerMock = vi.mocked(resolveCaller);
const dbExecuteMock = vi.mocked(db.execute);

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

  it("allows tenant admins to read another user's memory scope with case-insensitive membership type", async () => {
    resolveCallerMock.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "admin-1",
    });
    dbExecuteMock.mockResolvedValue({ rows: [{ role: "owner" }] } as any);

    await expect(
      requireMemoryUserScope(
        { auth: { tenantId: "tenant-1", authType: "jwt" } } as any,
        {
          tenantId: "tenant-1",
          userId: "user-2",
          allowTenantAdmin: true,
        },
      ),
    ).resolves.toEqual({ tenantId: "tenant-1", userId: "user-2" });

    const [query] = dbExecuteMock.mock.calls[0] ?? [];
    expect(
      (query as unknown as { strings: string[] }).strings.join(""),
    ).toContain("lower(principal_type) = 'user'");
  });
});
