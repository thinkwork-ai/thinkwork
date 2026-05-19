import type { GraphQLContext } from "../../context.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import { loadThreadMentionTargets } from "../../../lib/mentions/thread-mention-targets.js";

export const threadMentionTargets = async (
  _parent: unknown,
  args: { threadId: string },
  ctx: GraphQLContext,
) => {
  const tenantId = ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) return [];
  const targets = await loadThreadMentionTargets({
    tenantId,
    threadId: args.threadId,
  });
  return targets.map((target) => ({
    id: target.id,
    targetType: target.targetType.toUpperCase(),
    targetId: target.targetId,
    displayName: target.displayName,
    avatarUrl: target.avatarUrl,
    role: target.role,
  }));
};
