import type { GraphQLContext } from "../../context.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import { loadTenantMentionTargets } from "../../../lib/mentions/thread-mention-targets.js";

/**
 * Mention targets for the new-thread composer, which has no thread yet and so
 * cannot use `threadMentionTargets`. Scoped to the caller's tenant (the
 * `tenantId` arg is required by the schema but the lookup always uses the
 * resolved caller tenant, matching `threadMentionTargets`, so a member of one
 * tenant cannot enumerate another's).
 */
export const tenantMentionTargets = async (
  _parent: unknown,
  _args: { tenantId: string },
  ctx: GraphQLContext,
) => {
  const tenantId = ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) return [];
  const targets = await loadTenantMentionTargets({ tenantId });
  return targets.map((target) => ({
    id: target.id,
    targetType: target.targetType.toUpperCase(),
    targetId: target.targetId,
    displayName: target.displayName,
    aliases: target.aliases ?? [],
    isDefaultAgent: target.isDefaultAgent ?? false,
    avatarUrl: target.avatarUrl,
    role: target.role,
    email: target.email ?? null,
  }));
};
