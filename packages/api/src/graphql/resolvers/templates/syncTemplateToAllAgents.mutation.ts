/**
 * Sync all agents linked to a template. Loops syncTemplateToAgent per agent,
 * catching per-agent errors so one failure doesn't abort the batch.
 *
 * Gated at the top on the template's tenant. We don't rely on
 * syncTemplateToAgent's own gate fail-open-per-iteration because that
 * would pay N FORBIDDEN trips for a cross-tenant caller before surfacing
 * the refusal.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, agents, agentTemplates } from "../../utils.js";
import { syncTemplateToAgent } from "./syncTemplateToAgent.mutation.js";
import { requireTenantAdmin } from "../core/authz.js";

export async function syncTemplateToAllAgents(
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) {
  const { templateId } = args;

  const [template] = await db
    .select({ tenant_id: agentTemplates.tenant_id })
    .from(agentTemplates)
    .where(eq(agentTemplates.id, templateId));
  if (!template) throw new Error("Agent template not found");
  await requireTenantAdmin(ctx, template.tenant_id!);

  const linked = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.template_id, templateId));

  let agentsSynced = 0;
  let agentsFailed = 0;
  const errors: string[] = [];

  for (const agent of linked) {
    try {
      await syncTemplateToAgent(null, { templateId, agentId: agent.id }, ctx);
      agentsSynced++;
    } catch (err) {
      agentsFailed++;
      errors.push(`${agent.name}: ${(err as Error).message}`);
      console.error(
        `[syncTemplateToAllAgents] Failed for agent ${agent.id}:`,
        err,
      );
    }
  }

  return { agentsSynced, agentsFailed, errors };
}
