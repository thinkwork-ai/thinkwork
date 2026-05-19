import type { GraphQLContext } from "../../context.js";
import {
  and,
  asc,
  db,
  eq,
  messageMentions,
  snakeToCamel,
} from "../../utils.js";

export const messageTypeResolvers = {
  sender: async (message: any, _args: unknown, ctx: GraphQLContext) => {
    const senderType = message.senderType ?? message.sender_type ?? null;
    const senderId = message.senderId ?? message.sender_id ?? null;
    const role = String(message.role ?? "").toLowerCase();

    if (senderType === "agent" && senderId) {
      const agent = await ctx.loaders.agent.load(senderId);
      return {
        type: "agent",
        id: senderId,
        displayName: agent?.name ?? "Agent",
        avatarUrl: agent?.avatarUrl ?? agent?.avatar_url ?? null,
      };
    }
    if (senderType === "user" && senderId) {
      const user = await ctx.loaders.user.load(senderId);
      return {
        type: "user",
        id: senderId,
        displayName: user?.name ?? user?.email ?? "User",
        avatarUrl: user?.image ?? null,
      };
    }
    if (role === "assistant") {
      return { type: "agent", id: null, displayName: "Agent", avatarUrl: null };
    }
    if (role === "system" || role === "tool") {
      return {
        type: "system",
        id: null,
        displayName: "System",
        avatarUrl: null,
      };
    }
    return { type: "user", id: senderId, displayName: "User", avatarUrl: null };
  },
  mentions: async (message: any) => {
    const messageId = message.id;
    const tenantId = message.tenantId ?? message.tenant_id ?? null;
    const conditions = [eq(messageMentions.message_id, messageId)];
    if (tenantId) conditions.push(eq(messageMentions.tenant_id, tenantId));
    const rows = await db
      .select()
      .from(messageMentions)
      .where(and(...conditions))
      .orderBy(asc(messageMentions.created_at));
    return rows.map(messageMentionToCamel);
  },
};

export const messageMentionTypeResolvers = {
  user: (mention: any, _args: unknown, ctx: GraphQLContext) => {
    const targetType = mention.targetType ?? mention.target_type;
    const targetId = mention.targetId ?? mention.target_id;
    return String(targetType).toUpperCase() === "USER" && targetId
      ? ctx.loaders.user.load(targetId)
      : null;
  },
  agent: (mention: any, _args: unknown, ctx: GraphQLContext) => {
    const targetType = mention.targetType ?? mention.target_type;
    const targetId = mention.targetId ?? mention.target_id;
    return String(targetType).toUpperCase() === "AGENT" && targetId
      ? ctx.loaders.agent.load(targetId)
      : null;
  },
};

function messageMentionToCamel(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  if (typeof result.targetType === "string") {
    result.targetType = result.targetType.toUpperCase();
  }
  return result;
}
