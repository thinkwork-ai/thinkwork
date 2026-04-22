import type { GraphQLContext } from "../../context.js";
import { db, agentTemplates, snakeToCamel } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";

export async function createAgentTemplate(
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) {
  const i = args.input;
  await requireTenantAdmin(ctx, i.tenantId);

  const config = i.config
    ? typeof i.config === "string"
      ? JSON.parse(i.config)
      : i.config
    : undefined;
  const skills = i.skills
    ? typeof i.skills === "string"
      ? JSON.parse(i.skills)
      : i.skills
    : undefined;
  const knowledgeBaseIds = i.knowledgeBaseIds
    ? typeof i.knowledgeBaseIds === "string"
      ? JSON.parse(i.knowledgeBaseIds)
      : i.knowledgeBaseIds
    : undefined;
  const blockedTools = i.blockedTools
    ? typeof i.blockedTools === "string"
      ? JSON.parse(i.blockedTools)
      : i.blockedTools
    : undefined;
  const [row] = await db
    .insert(agentTemplates)
    .values({
      tenant_id: i.tenantId,
      name: i.name,
      slug: i.slug,
      description: i.description,
      category: i.category,
      icon: i.icon,
      model: i.model,
      guardrail_id: i.guardrailId,
      blocked_tools: blockedTools,
      config,
      skills,
      knowledge_base_ids: knowledgeBaseIds,
      is_published: i.isPublished ?? true,
    })
    .returning();

  // Copy default workspace files to the new template
  try {
    const { copyDefaultsToTemplate } =
      await import("../../../lib/workspace-copy.js");
    await copyDefaultsToTemplate(i.tenantId, i.slug);
  } catch (err) {
    console.warn(
      `[createAgentTemplate] Failed to copy default workspace files:`,
      err,
    );
  }

  return snakeToCamel(row);
}
