import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, agentTemplates, snakeToCamel, sql } from "../../utils.js";
import { validateTemplateBrowser } from "../../../lib/templates/browser-config.js";
import { validateTemplateSandbox } from "../../../lib/templates/sandbox-config.js";
import { requireTenantAdmin } from "../core/authz.js";

export async function updateAgentTemplate(
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) {
  // Resolve the target template's tenant so the role gate runs against the
  // authoritative row-derived tenantId, not a caller-supplied one. This
  // closes the P0 auth gap — prior to this change the mutation executed a
  // raw Drizzle UPDATE with no auth check at all (R15).
  const [template] = await db
    .select({ tenant_id: agentTemplates.tenant_id })
    .from(agentTemplates)
    .where(eq(agentTemplates.id, args.id));
  if (!template) {
    throw new GraphQLError("Agent template not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireTenantAdmin(ctx, template.tenant_id!);

  const i = args.input;

  const set: Record<string, any> = { updated_at: sql`now()` };
  if (i.name !== undefined) set.name = i.name;
  if (i.slug !== undefined) set.slug = i.slug;
  if (i.description !== undefined) set.description = i.description;
  if (i.category !== undefined) set.category = i.category;
  if (i.icon !== undefined) set.icon = i.icon;
  if (i.model !== undefined) set.model = i.model;
  if (i.guardrailId !== undefined) set.guardrail_id = i.guardrailId;
  if (i.isPublished !== undefined) set.is_published = i.isPublished;
  if (i.blockedTools !== undefined) {
    set.blocked_tools =
      typeof i.blockedTools === "string"
        ? JSON.parse(i.blockedTools)
        : i.blockedTools;
  }
  if (i.config !== undefined) {
    set.config = typeof i.config === "string" ? JSON.parse(i.config) : i.config;
  }
  if (i.skills !== undefined) {
    set.skills = typeof i.skills === "string" ? JSON.parse(i.skills) : i.skills;
  }
  if (i.knowledgeBaseIds !== undefined) {
    set.knowledge_base_ids =
      typeof i.knowledgeBaseIds === "string"
        ? JSON.parse(i.knowledgeBaseIds)
        : i.knowledgeBaseIds;
  }
  // Only touch sandbox when the caller explicitly sends the field — `undefined`
  // means "leave alone" so clients that omit it don't wipe existing opt-in.
  // Explicit null clears the opt-in. validateTemplateSandbox returns
  // { value: null } for both null and a validly-shaped object, so we assign
  // whatever it returns as long as the field was present.
  if (i.sandbox !== undefined) {
    const sandboxResult = validateTemplateSandbox(i.sandbox);
    if (!sandboxResult.ok) throw new Error(sandboxResult.error);
    set.sandbox = sandboxResult.value;
  }
  if (i.browser !== undefined) {
    const browserResult = validateTemplateBrowser(i.browser);
    if (!browserResult.ok) throw new Error(browserResult.error);
    set.browser = browserResult.value;
  }

  const [row] = await db
    .update(agentTemplates)
    .set(set)
    .where(eq(agentTemplates.id, args.id))
    .returning();

  if (!row) throw new Error("Agent template not found");
  return snakeToCamel(row);
}
