import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { agentSkills, and, db, eq, tenantSkills } from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { requireTenantMember } from "../core/authz.js";
import { isBuiltinToolSlug } from "../../../lib/builtin-tool-slugs.js";
import { renderWorkspaceAfterCustomize } from "./render-workspace-after-customize.js";
import {
  PlatformAgentNotFoundError,
  resolveTenantPlatformAgent,
} from "../../../lib/agents/tenant-platform-agent.js";

export interface EnableSkillArgs {
  input: { agentId: string; skillId: string };
}

/**
 * Enable a skill on the caller's tenant platform agent. Upserts an
 * `agent_skills` row keyed by the `uq_agent_skills_agent_skill
 * (agent_id, skill_id)` index. `derive-agent-skills.ts` keeps these in
 * sync with workspace AGENTS.md writes.
 */
export async function enableSkill(
  _parent: unknown,
  args: EnableSkillArgs,
  ctx: GraphQLContext,
) {
  const { agentId, skillId } = args.input;
  const caller = await resolveCaller(ctx);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Authentication required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  await requireTenantMember(ctx, caller.tenantId);

  let resolvedAgentId: string;
  try {
    const agent = await resolveTenantPlatformAgent(caller.tenantId);
    if (agentId && agentId !== agent.id) {
      throw new GraphQLError(
        "agentId does not match the tenant platform agent",
        {
          extensions: { code: "CUSTOMIZE_AGENT_MISMATCH" },
        },
      );
    }
    resolvedAgentId = agent.id;
  } catch (err) {
    if (err instanceof PlatformAgentNotFoundError) {
      throw new GraphQLError(
        "Tenant has no platform agent — bootstrap your workspace first.",
        { extensions: { code: "CUSTOMIZE_PRIMARY_AGENT_NOT_FOUND" } },
      );
    }
    throw err;
  }

  if (isBuiltinToolSlug(skillId)) {
    throw new GraphQLError(
      "Built-in skills are managed by your tenant template, not the Customize page.",
      { extensions: { code: "CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE" } },
    );
  }

  const [catalog] = await db
    .select()
    .from(tenantSkills)
    .where(
      and(
        eq(tenantSkills.tenant_id, caller.tenantId),
        eq(tenantSkills.skill_id, skillId),
      ),
    );
  if (!catalog) {
    throw new GraphQLError(
      `Customize catalog entry not found for skill "${skillId}"`,
      { extensions: { code: "CUSTOMIZE_CATALOG_NOT_FOUND" } },
    );
  }

  const [row] = await db
    .insert(agentSkills)
    .values({
      tenant_id: caller.tenantId,
      agent_id: resolvedAgentId,
      skill_id: skillId,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [agentSkills.agent_id, agentSkills.skill_id],
      set: { enabled: true },
    })
    .returning();

  if (!row) {
    throw new GraphQLError("Failed to enable skill", {
      extensions: { code: "INTERNAL_ERROR" },
    });
  }

  await renderWorkspaceAfterCustomize("enableSkill", resolvedAgentId);

  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    skillId: row.skill_id,
    config: row.config ?? null,
    permissions: row.permissions ?? null,
    rateLimitRpm: row.rate_limit_rpm ?? null,
    modelOverride: row.model_override ?? null,
    enabled: row.enabled,
    createdAt: row.created_at,
  };
}
