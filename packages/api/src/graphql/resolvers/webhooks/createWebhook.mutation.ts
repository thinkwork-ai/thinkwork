import { randomBytes } from "node:crypto";
import type { GraphQLContext } from "../../context.js";
import { db, eq, spaces, webhooks, snakeToCamel } from "../../utils.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";

export const createWebhook = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;
  const token = randomBytes(32).toString("base64url");
  const targetType = i.targetType.toLowerCase();
  const caller = await resolveCallerFromAuth(ctx.auth);
  const createdById =
    caller.tenantId === i.tenantId ? (caller.userId ?? null) : null;

  if (i.spaceId) {
    const [spaceRow] = await db
      .select({ tenant_id: spaces.tenant_id })
      .from(spaces)
      .where(eq(spaces.id, i.spaceId));
    if (!spaceRow) throw new Error(`Space ${i.spaceId} not found`);
    if (spaceRow.tenant_id !== i.tenantId) {
      throw new Error("Space does not belong to this tenant");
    }
  }

  const [row] = await db
    .insert(webhooks)
    .values({
      tenant_id: i.tenantId,
      name: i.name,
      description: i.description || null,
      token,
      target_type: targetType,
      space_id: i.spaceId || null,
      agent_id: i.agentId || null,
      routine_id: i.routineId || null,
      prompt: i.prompt || null,
      config: i.config ? JSON.parse(i.config) : null,
      enabled: true,
      rate_limit: i.rateLimit || 60,
      created_by_type: "user",
      created_by_id: createdById,
    })
    .returning();

  return snakeToCamel(row);
};
