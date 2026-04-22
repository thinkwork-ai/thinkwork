import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  agents,
  agentCapabilities,
  snakeToCamel,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";

export async function setAgentCapabilities(
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) {
  // Look up the agent BEFORE any destructive work so the role gate runs
  // against the authoritative tenantId and a member caller cannot DoS a
  // tenant's capabilities by submitting any shape of input.
  const [agent] = await db
    .select({ tenant_id: agents.tenant_id })
    .from(agents)
    .where(eq(agents.id, args.agentId));
  if (!agent) throw new Error("Agent not found");
  await requireTenantAdmin(ctx, agent.tenant_id);

  // Delete existing and replace
  await db
    .delete(agentCapabilities)
    .where(eq(agentCapabilities.agent_id, args.agentId));
  if (args.capabilities.length === 0) return [];

  const rows = await db
    .insert(agentCapabilities)
    .values(
      args.capabilities.map((c: any) => ({
        agent_id: args.agentId,
        tenant_id: agent.tenant_id,
        capability: c.capability,
        config: c.config ? JSON.parse(c.config) : undefined,
        enabled: c.enabled ?? true,
      })),
    )
    .returning();
  return rows.map(snakeToCamel);
}
