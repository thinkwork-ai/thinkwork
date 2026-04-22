/**
 * Scoped role-check query for the thinkwork-admin skill wrapper.
 *
 * Returns the *caller's own role on their own tenant* — no args, so it
 * cannot be used as an enumeration oracle to probe arbitrary
 * (userId, tenantId) pairs. The admin skill calls this once per
 * tool-call to pre-flight the server-side role gate (R11/R12/R16:
 * DB-live, no caching). Resolver-side `requireAdminOrApiKeyCaller`
 * remains the authoritative gate on every gated mutation; this query
 * is only a UX pre-check so the wrapper can refuse before making a
 * doomed mutation call.
 *
 * Errors (rather than returning "other") when the caller's identity
 * is misconfigured — e.g., apikey caller missing `x-principal-id` or
 * `x-tenant-id`. Silently returning "other" would mask misconfig; an
 * error lands in the wrapper's audit log.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, and, tenantMembers } from "../../utils.js";
import {
  resolveCallerUserId,
  resolveCallerTenantId,
} from "./resolve-auth-user.js";

export type AdminRoleCheckRole = "owner" | "admin" | "member" | "other";

export interface AdminRoleCheckResult {
  role: AdminRoleCheckRole;
}

export async function adminRoleCheck(
  _parent: unknown,
  _args: Record<string, never>,
  ctx: GraphQLContext,
): Promise<AdminRoleCheckResult> {
  let callerUserId: string | null;
  let callerTenantId: string | null;

  if (ctx.auth.authType === "apikey") {
    callerUserId = ctx.auth.principalId;
    callerTenantId = ctx.auth.tenantId;
  } else if (ctx.auth.authType === "cognito") {
    callerUserId = await resolveCallerUserId(ctx);
    callerTenantId = await resolveCallerTenantId(ctx);
  } else {
    throw new GraphQLError("Unsupported authentication type", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  if (!callerUserId) {
    throw new GraphQLError(
      "Caller identity missing — principalId required on context",
      { extensions: { code: "UNAUTHENTICATED" } },
    );
  }
  if (!callerTenantId) {
    throw new GraphQLError(
      "Caller tenant missing — tenantId required on context",
      { extensions: { code: "UNAUTHENTICATED" } },
    );
  }

  const [member] = await db
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, callerTenantId),
        eq(tenantMembers.principal_id, callerUserId),
      ),
    );

  const role = member?.role;
  if (role === "owner" || role === "admin" || role === "member") {
    return { role };
  }
  return { role: "other" };
}
