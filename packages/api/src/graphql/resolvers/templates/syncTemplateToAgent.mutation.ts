/**
 * Sync a single linked agent to its template.
 *
 * Overwrites: skills, knowledge_bases, workspace files, and role.
 * Snapshots the agent's current state first so the change can be rolled back.
 *
 * Does NOT touch: model, guardrail_id, blocked_tools — those are resolved live
 * from the template FK at invocation time (see chat-agent-invoke.ts).
 *
 * Unit 6a — intersection-based merge for permissions_model skills:
 *   agent_new.permissions.operations = agent_current ∩ template_new
 *
 * Preserves any per-agent narrowing within the new template ceiling
 * (R7: "agents that already narrowed within the new ceiling are left
 * alone"). Agents inheriting (null permissions) continue to inherit.
 * See docs/plans/2026-04-22-008-feat-agent-skill-permissions-ui-plan.md.
 */

import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  inArray,
  agents,
  agentTemplates,
  agentSkills,
  agentKnowledgeBases,
  agentToCamel,
  sql,
} from "../../utils.js";
import {
  agentMcpServers,
  agentTemplateMcpServers,
} from "@thinkwork/database-pg/schema";
import { snapshotAgent } from "../../../lib/agent-snapshot.js";
import { overlayTemplateWorkspace } from "../../../lib/workspace-copy.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  mergeTemplateSkillsIntoAgent,
  type MergedSkillRow,
  type TemplateSkillRow,
} from "../../../lib/skills/sync-merge.js";

export async function syncTemplateToAgent(
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) {
  const { templateId, agentId } = args;

  // 1. Fetch template + agent, validate linkage
  const [agentTemplate] = await db
    .select()
    .from(agentTemplates)
    .where(eq(agentTemplates.id, templateId));
  if (!agentTemplate) throw new Error("Agent template not found");

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) throw new Error("Agent not found");
  if (agent.template_id !== templateId) {
    throw new Error("Agent is not linked to this template");
  }
  // Defensive cross-tenant assertion. Schema doesn't enforce
  // agent.tenant_id === template.tenant_id; a data-integrity gap
  // elsewhere shouldn't let a cross-tenant sync through.
  if (agent.tenant_id !== agentTemplate.tenant_id) {
    throw new Error(
      "Agent tenant does not match template tenant — refusing cross-tenant sync",
    );
  }

  // Gate on the template's tenant — any admin of that tenant may sync
  // any linked agent. This must run before snapshotAgent (writes) and
  // before any delete/update on agent_skills / agent_knowledge_bases /
  // agent_mcp_servers.
  await requireTenantAdmin(ctx, agentTemplate.tenant_id!);

  // 2. Snapshot current state FIRST (enables rollback)
  await snapshotAgent(agentId, "Pre-sync from template", ctx.auth.principalId);

  // 3. Read template config
  const config = (agentTemplate.config as any) || {};
  const templateSkills = (agentTemplate.skills as any[]) || [];
  const templateKbIds = (agentTemplate.knowledge_base_ids as string[]) || [];

  // 4. Update agent.role from template.config.role
  await db
    .update(agents)
    .set({
      role: config.role ?? agent.role,
      updated_at: sql`now()`,
    })
    .where(eq(agents.id, agentId));

  // 5. Sync agent_skills with intersection-based merge that preserves
  //    per-agent narrowing (R7). Previously this deleted everything
  //    and re-inserted the template's skills verbatim, which wiped
  //    every operator-authored narrowing of permissions.operations.
  const mergedSkills = await computeSyncedAgentSkills({
    agentId,
    tenantId: agent.tenant_id!,
    templateSkills,
  });
  // Remove skills that the template no longer lists.
  const templateSkillIds = templateSkills
    .map((s: any) => s?.skill_id)
    .filter((id: unknown): id is string => typeof id === "string");
  if (templateSkillIds.length === 0) {
    await db.delete(agentSkills).where(eq(agentSkills.agent_id, agentId));
  } else {
    await db
      .delete(agentSkills)
      .where(
        sql`${agentSkills.agent_id} = ${agentId} AND ${agentSkills.skill_id} NOT IN (${sql.join(
          templateSkillIds.map((id: string) => sql`${id}`),
          sql`, `,
        )})`,
      );
  }
  // Upsert every skill in the merged list (insert new ones; update
  // existing ones to carry forward the intersected permissions).
  for (const s of mergedSkills) {
    await db
      .insert(agentSkills)
      .values({
        agent_id: agentId,
        tenant_id: agent.tenant_id!,
        skill_id: s.skill_id,
        config: s.config,
        permissions: s.permissions,
        rate_limit_rpm: s.rate_limit_rpm ?? null,
        model_override: s.model_override ?? null,
        enabled: s.enabled,
      })
      .onConflictDoUpdate({
        target: [agentSkills.agent_id, agentSkills.skill_id],
        set: {
          config: s.config,
          permissions: s.permissions,
          rate_limit_rpm: s.rate_limit_rpm ?? null,
          model_override: s.model_override ?? null,
          enabled: s.enabled,
        },
      });
  }

  // 6. Replace agent_knowledge_bases
  await db
    .delete(agentKnowledgeBases)
    .where(eq(agentKnowledgeBases.agent_id, agentId));
  if (templateKbIds.length > 0) {
    await db.insert(agentKnowledgeBases).values(
      templateKbIds.map((kbId: string) => ({
        agent_id: agentId,
        tenant_id: agent.tenant_id!,
        knowledge_base_id: kbId,
        enabled: true,
      })),
    );
  }

  // 6b. Replace agent_mcp_servers from agent_template_mcp_servers join table
  const templateMcpRows = await db
    .select({
      mcp_server_id: agentTemplateMcpServers.mcp_server_id,
      enabled: agentTemplateMcpServers.enabled,
    })
    .from(agentTemplateMcpServers)
    .where(eq(agentTemplateMcpServers.template_id, templateId));
  await db.delete(agentMcpServers).where(eq(agentMcpServers.agent_id, agentId));
  if (templateMcpRows.length > 0) {
    await db.insert(agentMcpServers).values(
      templateMcpRows.map((m) => ({
        agent_id: agentId,
        tenant_id: agent.tenant_id!,
        mcp_server_id: m.mcp_server_id,
        enabled: m.enabled ?? true,
      })),
    );
  }

  // 7. Overlay workspace files (template files overwrite matching paths; agent-only files preserved)
  try {
    await overlayTemplateWorkspace(
      agent.tenant_id!,
      agentTemplate.slug,
      agent.slug!,
    );
  } catch (err) {
    console.warn(`[syncTemplateToAgent] Workspace overlay failed:`, err);
  }

  // 8. Regenerate workspace map
  try {
    const { regenerateWorkspaceMap } =
      await import("../../../lib/workspace-map-generator.js");
    regenerateWorkspaceMap(agentId).catch((err: unknown) => {
      console.error(
        "[syncTemplateToAgent] regenerateWorkspaceMap failed:",
        err,
      );
    });
  } catch (err) {
    console.warn(
      "[syncTemplateToAgent] workspace-map-generator not available:",
      err,
    );
  }

  // 9. Return updated agent
  const [updated] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId));
  return agentToCamel(updated);
}

/**
 * Merge the template's skills list against the agent's current skills,
 * preserving per-agent narrowing of permissions.operations for any
 * skill whose manifest declares `permissions_model: operations`.
 *
 * Merge semantics per template skill:
 *   - Non-opt-in skill (no permissions_model in manifest): permissions
 *     are preserved from the agent's current row if present, else
 *     taken from the template row. (Template wins on non-opt-in
 *     skills today; this plan leaves that semantic untouched.)
 *   - permissions_model: operations:
 *       * agent_current.permissions.operations = null/missing
 *         → inherit (write null).
 *       * agent_current.permissions.operations = explicit array
 *         → intersect with template.permissions.operations. Narrowing
 *           within the new ceiling is preserved; ops no longer in the
 *           ceiling drop.
 *       * template.permissions.operations = null/missing and agent
 *         has an explicit override → intersection with the empty set
 *         is [] (narrowed-to-empty). The R12 empty-allowlist warning
 *         then surfaces in the UI.
 *
 * Kept inline (not extracted to a shared module) because there is
 * exactly one caller — syncTemplateToAgent. syncTemplateToAllAgents
 * delegates to this resolver in a loop, so the intersection semantics
 * propagate for free. See plan Key Technical Decisions for the
 * single-consumer-abstraction rationale.
 */
async function computeSyncedAgentSkills({
  agentId,
  tenantId: _tenantId,
  templateSkills,
}: {
  agentId: string;
  tenantId: string;
  templateSkills: TemplateSkillRow[];
}): Promise<MergedSkillRow[]> {
  if (!templateSkills || templateSkills.length === 0) return [];

  const skillIds = templateSkills
    .map((s) => s?.skill_id)
    .filter((id): id is string => typeof id === "string");

  // Current agent_skills keyed by skill_id.
  const currentRows = skillIds.length
    ? await db
        .select()
        .from(agentSkills)
        .where(
          sql`${agentSkills.agent_id} = ${agentId} AND ${agentSkills.skill_id} IN (${sql.join(
            skillIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
    : [];
  const currentBySkillId = new Map<string, { permissions?: unknown }>();
  for (const r of currentRows) currentBySkillId.set(r.skill_id, r as any);

  // Look up which skill_ids opt into permissions_model: operations.
  const optInSet = await loadPermissionsModelOptIns(skillIds);

  return mergeTemplateSkillsIntoAgent({
    templateSkills,
    currentBySkillId,
    permissionsModelOptIns: optInSet,
  });
}

/**
 * Returns the set of skill_ids in `skillIds` whose manifest declares
 * `permissions_model: operations`. Sources from skill_catalog.tier1_metadata
 * (the full parsed YAML, JSON-stringified by sync-catalog-db).
 */
async function loadPermissionsModelOptIns(
  skillIds: string[],
): Promise<Set<string>> {
  if (skillIds.length === 0) return new Set();
  const { skillCatalog } = await import("@thinkwork/database-pg/schema");
  const rows = await db
    .select({
      slug: skillCatalog.slug,
      tier1_metadata: skillCatalog.tier1_metadata,
    })
    .from(skillCatalog)
    .where(inArray(skillCatalog.slug, skillIds));
  const out = new Set<string>();
  for (const row of rows) {
    const meta = parseTier1Metadata(row.tier1_metadata);
    if (meta?.permissions_model === "operations") out.add(row.slug);
  }
  return out;
}

function parseTier1Metadata(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw))
    return raw as Record<string, unknown>;
  return null;
}
