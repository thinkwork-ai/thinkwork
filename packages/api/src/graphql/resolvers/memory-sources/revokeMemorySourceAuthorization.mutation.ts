/**
 * revokeMemorySourceAuthorization — revoke one source-access grant
 * (THINK-193 U2). Delegates to the policy lib so the revocation semantics
 * (status flip, revoked_at, grant_version bump) live in one place.
 * Returns false when the grant does not exist in the tenant.
 */

import type { GraphQLContext } from "../../context.js";
import { revokeGrant } from "../../../lib/memory-sources/policy.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";

export async function revokeMemorySourceAuthorization(
  _parent: unknown,
  args: { tenantId?: string | null; authorizationId: string },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, tenantId);

  const revoked = await revokeGrant(ctx.db, {
    tenantId,
    grantId: args.authorizationId,
    revokedByUserId: (await resolveCallerUserId(ctx)) ?? undefined,
  });
  return revoked !== null;
}
