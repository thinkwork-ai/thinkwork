import type { TenantMembershipVerdict } from "./tenant-membership.js";

type ResolvedTenantMembership = Extract<TenantMembershipVerdict, { ok: true }>;

export function resolveUserMcpPrincipal(
  membership: ResolvedTenantMembership,
  headers: Record<string, string | undefined>,
):
  | { ok: true; userId: string }
  | { ok: false; status: 400 | 403; reason: string } {
  const requestedUserId = headers["x-principal-id"]?.trim();

  if (
    membership.auth.authType === "apikey" ||
    membership.auth.authType === "service"
  ) {
    if (!requestedUserId) {
      return {
        ok: false,
        status: 400,
        reason: "x-principal-id header required",
      };
    }
    return { ok: true, userId: requestedUserId };
  }

  if (!membership.userId) {
    return { ok: false, status: 403, reason: "Caller has no user record" };
  }

  if (
    !requestedUserId ||
    requestedUserId === membership.userId ||
    requestedUserId === membership.auth.principalId
  ) {
    return { ok: true, userId: membership.userId };
  }

  if (membership.role === "owner" || membership.role === "admin") {
    return { ok: true, userId: requestedUserId };
  }

  return {
    ok: false,
    status: 403,
    reason: "Members may only manage their own MCP tokens",
  };
}
