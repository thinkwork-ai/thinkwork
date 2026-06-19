import type { GraphQLContext } from "../../context.js";
import { db, eq, spaces, webhooks, snakeToCamel } from "../../utils.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";

export const updateWebhook = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;
  const updates: Record<string, unknown> = { updated_at: new Date() };
  const [existingWebhook] = await db
    .select({
      tenant_id: webhooks.tenant_id,
      created_by_id: webhooks.created_by_id,
    })
    .from(webhooks)
    .where(eq(webhooks.id, args.id));
  if (!existingWebhook) return null;

  if (!existingWebhook.created_by_id) {
    const caller = await resolveCallerFromAuth(ctx.auth);
    if (caller.tenantId === existingWebhook.tenant_id && caller.userId) {
      updates.created_by_type = "user";
      updates.created_by_id = caller.userId;
    }
  }

  if (i.name !== undefined) updates.name = i.name;
  if (i.description !== undefined) updates.description = i.description;
  if (i.targetType !== undefined)
    updates.target_type = i.targetType.toLowerCase();
  if (i.spaceId !== undefined) {
    if (i.spaceId) {
      const [spaceRow] = await db
        .select({ tenant_id: spaces.tenant_id })
        .from(spaces)
        .where(eq(spaces.id, i.spaceId));
      if (!spaceRow) throw new Error(`Space ${i.spaceId} not found`);
      if (spaceRow.tenant_id !== existingWebhook.tenant_id) {
        throw new Error("Space does not belong to this tenant");
      }
    }
    updates.space_id = i.spaceId;
  }
  if (i.agentId !== undefined) updates.agent_id = i.agentId;
  if (i.routineId !== undefined) updates.routine_id = i.routineId;
  if (i.prompt !== undefined) updates.prompt = i.prompt;
  if (i.config !== undefined)
    updates.config = i.config ? JSON.parse(i.config) : null;
  if (i.enabled !== undefined) updates.enabled = i.enabled;
  if (i.rateLimit !== undefined) updates.rate_limit = i.rateLimit;

  const [updated] = await db
    .update(webhooks)
    .set(updates)
    .where(eq(webhooks.id, args.id))
    .returning();

  return updated ? snakeToCamel(updated) : null;
};
