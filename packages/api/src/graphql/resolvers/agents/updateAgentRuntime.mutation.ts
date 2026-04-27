import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  agents,
  agentToCamel,
  recordActivity,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { parseAgentRuntimeInput } from "./runtime.js";

export async function updateAgentRuntime(
  _parent: any,
  args: { id: string; runtime: unknown },
  ctx: GraphQLContext,
) {
  const [current] = await db
    .select({
      tenant_id: agents.tenant_id,
      runtime: agents.runtime,
    })
    .from(agents)
    .where(eq(agents.id, args.id));

  if (!current) {
    throw new GraphQLError("Agent not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  await requireTenantAdmin(ctx, current.tenant_id);

  const nextRuntime = parseAgentRuntimeInput(args.runtime);
  const [row] = await db
    .update(agents)
    .set({ runtime: nextRuntime, updated_at: new Date() })
    .where(and(eq(agents.id, args.id), eq(agents.tenant_id, current.tenant_id)))
    .returning();

  if (!row) {
    throw new GraphQLError("Agent not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  if (current.runtime !== nextRuntime) {
    const actorId =
      ctx.auth.authType === "apikey"
        ? ctx.auth.principalId
        : await resolveCallerUserId(ctx);
    if (actorId) {
      try {
        await recordActivity(
          current.tenant_id,
          "user",
          actorId,
          "agent.runtime_changed",
          "agent",
          args.id,
          { from: current.runtime, to: nextRuntime },
        );
      } catch (err) {
        console.warn(
          `[updateAgentRuntime] Failed to record runtime change activity for agent ${args.id}:`,
          err,
        );
      }
    }
  }

  return agentToCamel(row);
}
