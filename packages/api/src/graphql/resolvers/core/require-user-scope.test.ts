import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../utils.js";
import {
  requireMemoryTenantScope,
  requireMemoryUserScope,
} from "./require-user-scope.js";
import { resolveCaller } from "./resolve-auth-user.js";

vi.mock("./resolve-auth-user.js", () => ({
  resolveCaller: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: { execute: vi.fn() },
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    values,
  })),
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

describe("requireMemoryTenantScope (plan 2026-06-09-004 U9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grants a NON-admin tenant member access to tenant scope (no admin check, no db hit)", async () => {
    resolveCallerMock.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "member-1",
    });

    await expect(
      requireMemoryTenantScope(
        { auth: { tenantId: "tenant-1", authType: "jwt" } } as any,
        { tenantId: "tenant-1" },
      ),
    ).resolves.toEqual({ tenantId: "tenant-1", userId: "member-1" });
    // Membership-only rule — the tenant_members admin lookup never runs.
    expect(dbExecuteMock).not.toHaveBeenCalled();
  });

  it("rejects a tenant A member reading tenant B scope", async () => {
    resolveCallerMock.mockResolvedValue({
      tenantId: "tenant-a",
      userId: "member-1",
    });

    await expect(
      requireMemoryTenantScope(
        { auth: { tenantId: "tenant-a", authType: "jwt" } } as any,
        { tenantId: "tenant-b" },
      ),
    ).rejects.toThrow("Access denied: tenant mismatch");
  });

  it("rejects a caller with no resolvable user (non-member)", async () => {
    resolveCallerMock.mockResolvedValue({ tenantId: null, userId: null });

    await expect(
      requireMemoryTenantScope(
        { auth: { tenantId: null, authType: "jwt" } } as any,
        { tenantId: "tenant-1" },
      ),
    ).rejects.toThrow("User context required");
  });

  it("rejects a caller whose membership tenant cannot be resolved", async () => {
    resolveCallerMock.mockResolvedValue({ tenantId: null, userId: "user-1" });

    await expect(
      requireMemoryTenantScope(
        { auth: { tenantId: null, authType: "jwt" } } as any,
        { tenantId: "tenant-1" },
      ),
    ).rejects.toThrow("Access denied: tenant mismatch");
  });

  it("requires a tenant id from somewhere", async () => {
    resolveCallerMock.mockResolvedValue({ tenantId: null, userId: "user-1" });

    await expect(
      requireMemoryTenantScope(
        { auth: { tenantId: null, authType: "jwt" } } as any,
        {},
      ),
    ).rejects.toThrow("Tenant context required");
  });

  it("passes service credentials for any tenant, with a null userId", async () => {
    resolveCallerMock.mockResolvedValue({ tenantId: null, userId: null });

    await expect(
      requireMemoryTenantScope(
        { auth: { tenantId: null, authType: "apikey" } } as any,
        { tenantId: "tenant-1" },
      ),
    ).resolves.toEqual({ tenantId: "tenant-1", userId: null });
  });
});
