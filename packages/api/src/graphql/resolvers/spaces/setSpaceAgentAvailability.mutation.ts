import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  agents,
  and,
  db,
  eq,
  spaceAgentAssignments,
  spaces,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { toGraphqlSpaceChild } from "./shared.js";

type SetSpaceAgentAvailabilityInput = {
  tenantId: string;
  spaceId: string;
  agentId: string;
  enabled: boolean;
  localRole?: string | null;
  localInstructions?: string | null;
  autoSubscribe?: boolean | null;
  allowedCapabilities?: unknown;
  allowedTools?: unknown;
};

export async function setSpaceAgentAvailability(
  _parent: unknown,
  args: { input: SetSpaceAgentAvailabilityInput },
  ctx: GraphQLContext,
) {
  const input = args.input;
  await requireAdminOrServiceCaller(
    ctx,
    input.tenantId,
    "set_space_agent_availability",
  );

  const [[spaceRow], [agentRow]] = await Promise.all([
    db
      .select({ space: spaces.id })
      .from(spaces)
      .where(
        and(eq(spaces.id, input.spaceId), eq(spaces.tenant_id, input.tenantId)),
      ),
    db
      .select({ agent: agents.id })
      .from(agents)
      .where(
        and(eq(agents.id, input.agentId), eq(agents.tenant_id, input.tenantId)),
      ),
  ]);
  if (!spaceRow || !agentRow) {
    throw new GraphQLError("Space or Agent not found for tenant");
  }

  const status = input.enabled ? "active" : "archived";
  const [row] = await db
    .insert(spaceAgentAssignments)
    .values({
      tenant_id: input.tenantId,
      space_id: input.spaceId,
      agent_id: input.agentId,
      local_role: input.localRole?.trim() || null,
      local_instructions: input.localInstructions?.trim() || null,
      auto_subscribe: input.autoSubscribe ?? true,
      allowed_capabilities: input.allowedCapabilities ?? null,
      allowed_tools: input.allowedTools ?? null,
      status,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        spaceAgentAssignments.tenant_id,
        spaceAgentAssignments.space_id,
        spaceAgentAssignments.agent_id,
      ],
      set: {
        local_role: input.localRole?.trim() || null,
        local_instructions: input.localInstructions?.trim() || null,
        auto_subscribe: input.autoSubscribe ?? true,
        allowed_capabilities: input.allowedCapabilities ?? null,
        allowed_tools: input.allowedTools ?? null,
        status,
        updated_at: new Date(),
      },
    })
    .returning();

  return toGraphqlSpaceChild(row);
}
