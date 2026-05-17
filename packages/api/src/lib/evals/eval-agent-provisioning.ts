import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  agentCapabilities,
  agentKnowledgeBases,
  agentMcpServers,
  agentSkills,
  agentTemplateMcpServers,
  agentTemplates,
  agents,
  tenants,
} from "@thinkwork/database-pg/schema";
import { generateSlug } from "@thinkwork/database-pg/utils/generate-slug";
import { db } from "../db.js";
import { initializePinnedVersions } from "../pinned-versions.js";
import { bootstrapAgentWorkspace } from "../workspace-bootstrap.js";

export async function resolveEvalTemplateId(
  tenantId: string,
  requestedTemplateId?: string | null,
): Promise<string> {
  if (requestedTemplateId) {
    const [template] = await db
      .select({
        id: agentTemplates.id,
        templateKind: agentTemplates.template_kind,
      })
      .from(agentTemplates)
      .where(
        and(
          eq(agentTemplates.id, requestedTemplateId),
          eq(agentTemplates.tenant_id, tenantId),
        ),
      )
      .limit(1);
    if (!template) throw new Error("Eval Agent template not found");
    if (template.templateKind !== "agent") {
      throw new Error("Evals currently require an Agent template target");
    }
    return template.id;
  }

  const [defaultTemplate] = await db
    .select({ id: agentTemplates.id })
    .from(agentTemplates)
    .where(
      and(
        eq(agentTemplates.tenant_id, tenantId),
        eq(agentTemplates.slug, "default"),
        eq(agentTemplates.template_kind, "agent"),
      ),
    )
    .limit(1);
  if (defaultTemplate) return defaultTemplate.id;

  const [firstTemplate] = await db
    .select({ id: agentTemplates.id })
    .from(agentTemplates)
    .where(
      and(
        eq(agentTemplates.tenant_id, tenantId),
        eq(agentTemplates.template_kind, "agent"),
      ),
    )
    .limit(1);
  if (!firstTemplate) throw new Error("No Agent template found for eval");
  return firstTemplate.id;
}

export async function ensureEvalAgentForTemplate(input: {
  tenantId: string;
  templateId: string;
}): Promise<{ agentId: string; templateId: string }> {
  const { tenantId, templateId } = input;
  const [template] = await db
    .select()
    .from(agentTemplates)
    .where(
      and(
        eq(agentTemplates.id, templateId),
        eq(agentTemplates.tenant_id, tenantId),
      ),
    )
    .limit(1);
  if (!template) throw new Error("Eval Agent template not found");
  if (template.template_kind !== "agent") {
    throw new Error("Evals currently require an Agent template target");
  }

  const [existing] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.tenant_id, tenantId),
        eq(agents.template_id, templateId),
        eq(agents.source, "system"),
        eq(agents.type, "eval"),
      ),
    )
    .limit(1);
  if (existing) return { agentId: existing.id, templateId };

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  let pinnedVersions: Record<string, string> = {};
  if (tenant?.slug && template.slug) {
    pinnedVersions = await initializePinnedVersions({
      tenantSlug: tenant.slug,
      templateSlug: template.slug,
    });
  }

  const config = (template.config as Record<string, unknown> | null) ?? {};
  const [agent] = await db
    .insert(agents)
    .values({
      tenant_id: tenantId,
      name: `Eval Agent (${template.name})`,
      slug: `eval-agent-${template.slug || generateSlug()}-${randomBytes(4).toString("hex")}`,
      role: typeof config.role === "string" ? config.role : undefined,
      type: "eval",
      source: "system",
      runtime: template.runtime,
      status: "idle",
      adapter_type: "strands",
      template_id: templateId,
      runtime_config: { heartbeat: { enabled: false } },
      agent_pinned_versions:
        Object.keys(pinnedVersions).length > 0 ? pinnedVersions : null,
    })
    .returning();
  if (!agent) throw new Error("Failed to create eval AgentCore target");

  const templateSkills = (template.skills as any[] | null) ?? [];
  if (templateSkills.length > 0) {
    await db.insert(agentSkills).values(
      templateSkills.map((skill) => ({
        agent_id: agent.id,
        tenant_id: tenantId,
        skill_id: skill.skill_id,
        config: skill.config,
        permissions: skill.permissions,
        rate_limit_rpm: skill.rate_limit_rpm,
        model_override: skill.model_override ?? null,
        enabled: skill.enabled ?? true,
      })),
    );
  }

  const templateKbIds = (template.knowledge_base_ids as string[] | null) ?? [];
  if (templateKbIds.length > 0) {
    await db.insert(agentKnowledgeBases).values(
      templateKbIds.map((kbId) => ({
        agent_id: agent.id,
        tenant_id: tenantId,
        knowledge_base_id: kbId,
        enabled: true,
      })),
    );
  }

  const templateMcpRows = await db
    .select({
      mcp_server_id: agentTemplateMcpServers.mcp_server_id,
      enabled: agentTemplateMcpServers.enabled,
      config: agentTemplateMcpServers.config,
    })
    .from(agentTemplateMcpServers)
    .where(eq(agentTemplateMcpServers.template_id, templateId));
  if (templateMcpRows.length > 0) {
    await db.insert(agentMcpServers).values(
      templateMcpRows.map((row) => ({
        agent_id: agent.id,
        tenant_id: tenantId,
        mcp_server_id: row.mcp_server_id,
        enabled: row.enabled ?? true,
        config: row.config ?? null,
      })),
    );
  }

  try {
    await db.insert(agentCapabilities).values({
      agent_id: agent.id,
      tenant_id: tenantId,
      capability: "email_channel",
      config: {
        emailAddress: `${agent.slug}@agents.thinkwork.ai`,
        allowedSenders: [],
        replyTokensEnabled: true,
        maxReplyTokenAgeDays: 7,
        maxReplyTokenUses: 3,
        rateLimitPerHour: 50,
      },
      enabled: true,
    });
  } catch (err) {
    console.warn("[eval-agent] Failed to provision email capability:", err);
  }

  await bootstrapAgentWorkspace(agent.id, { mode: "preserve-existing" });

  try {
    const { regenerateWorkspaceMap } =
      await import("../workspace-map-generator.js");
    regenerateWorkspaceMap(agent.id).catch((err: unknown) => {
      console.error("[eval-agent] Failed to regenerate workspace map:", err);
    });
  } catch (err) {
    console.warn("[eval-agent] workspace-map-generator not available:", err);
  }

  return { agentId: agent.id, templateId };
}
