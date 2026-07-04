import { describe, expect, it } from "vitest";
import type { AuthResult } from "../../../lib/cognito-auth.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";

/**
 * KTD8 identity seam (THINK-145 U9). The canvas mutations
 * (`saveCanvas`/`checkoutCanvas`/`refreshCanvasData`) resolve the ACTING user
 * via `resolveCallerFromAuth` and assert R15 space-membership against THAT
 * user — never the service principal alone. The runtime carries the acting
 * user with the shared service secret + `x-principal-id` (apikey auth), which
 * this resolver honors; a bare `service` caller (no principal) resolves to a
 * null user, so the mutations' `!caller.userId` guard rejects it.
 *
 * These are pure (no-DB) branches of `resolveCallerFromAuth`, so they document
 * the seam without a database.
 */

function apikey(
  principalId: string | null,
  tenantId: string | null,
): AuthResult {
  return {
    principalId,
    tenantId,
    email: null,
    emailVerified: false,
    authType: principalId ? "apikey" : "service",
    agentId: null,
  };
}

describe("canvas acting-user identity seam (KTD8)", () => {
  it("honors an apikey caller's asserted acting user (x-principal-id)", async () => {
    const resolved = await resolveCallerFromAuth(
      apikey("user-acting", "tenant-1"),
    );
    expect(resolved).toEqual({ userId: "user-acting", tenantId: "tenant-1" });
  });

  it("resolves a bare service caller to a null user (mutations reject → no ghost-write)", async () => {
    const resolved = await resolveCallerFromAuth(apikey(null, "tenant-1"));
    expect(resolved.userId).toBeNull();
    expect(resolved.tenantId).toBe("tenant-1");
  });

  it("carries a DIFFERENT acting user per call (per-turn identity, not a fixed principal)", async () => {
    const a = await resolveCallerFromAuth(apikey("user-a", "tenant-1"));
    const b = await resolveCallerFromAuth(apikey("user-b", "tenant-1"));
    expect(a.userId).toBe("user-a");
    expect(b.userId).toBe("user-b");
  });
});
