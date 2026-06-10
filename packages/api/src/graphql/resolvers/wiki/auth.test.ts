import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMemoryTenantScope: vi.fn(),
  requireMemoryUserScope: vi.fn(),
}));

vi.mock("../core/require-user-scope.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../core/require-user-scope.js")>()),
  requireMemoryTenantScope: mocks.requireMemoryTenantScope,
  requireMemoryUserScope: mocks.requireMemoryUserScope,
}));

import { UserScopeAuthError } from "../core/require-user-scope.js";
import {
  assertCanReadWikiScope,
  assertCanReadWikiTenantScope,
  WikiAuthError,
} from "./auth.js";

const ctx = { auth: { tenantId: "tenant-1", authType: "jwt" } } as never;

describe("wiki auth (plan 2026-06-09-004 U9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("assertCanReadWikiTenantScope delegates to the tenant-membership rule", async () => {
    mocks.requireMemoryTenantScope.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "member-1",
    });

    await expect(
      assertCanReadWikiTenantScope(ctx, { tenantId: "tenant-1" }),
    ).resolves.toEqual({ tenantId: "tenant-1", userId: "member-1" });
    expect(mocks.requireMemoryTenantScope).toHaveBeenCalledWith(ctx, {
      tenantId: "tenant-1",
    });
    // The user-scope rule (owner-match-or-admin) is NOT consulted for
    // tenant-scope reads.
    expect(mocks.requireMemoryUserScope).not.toHaveBeenCalled();
  });

  it("wraps tenant-scope denials in WikiAuthError", async () => {
    mocks.requireMemoryTenantScope.mockRejectedValue(
      new UserScopeAuthError("Access denied: tenant mismatch"),
    );

    await expect(
      assertCanReadWikiTenantScope(ctx, { tenantId: "tenant-b" }),
    ).rejects.toThrow(WikiAuthError);
  });

  it("rethrows non-authz errors unwrapped", async () => {
    mocks.requireMemoryTenantScope.mockRejectedValue(new Error("db down"));

    await expect(
      assertCanReadWikiTenantScope(ctx, { tenantId: "tenant-1" }),
    ).rejects.toThrow("db down");
  });

  it("assertCanReadWikiScope (user-scoped pages) keeps the owner-match-or-admin rule unchanged", async () => {
    mocks.requireMemoryUserScope.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-1",
    });

    await expect(
      assertCanReadWikiScope(ctx, { tenantId: "tenant-1", userId: "user-1" }),
    ).resolves.toEqual({ tenantId: "tenant-1", userId: "user-1" });
    expect(mocks.requireMemoryUserScope).toHaveBeenCalledWith(ctx, {
      tenantId: "tenant-1",
      userId: "user-1",
      allowTenantAdmin: true,
    });
    expect(mocks.requireMemoryTenantScope).not.toHaveBeenCalled();
  });
});
