import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  agentSkills,
  and,
  computers,
  db,
  eq,
  ne,
  sql,
  tenantSkills,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { requireTenantMember } from "../core/authz.js";
import { isBuiltinToolSlug } from "../../../lib/builtin-tool-slugs.js";
import { renderWorkspaceAfterCustomize } from "./render-workspace-after-customize.js";

export interface EnableSkillArgs {
  input: { computerId: string; skillId: string };
}

/**
 * Enable a skill for the caller's Computer. Looks up the catalog row in
 * `tenant_skills`, rejects built-in tool slugs (template/runtime config,
 * not workspace skills), resolves the Computer's primary agent, and
 * upserts an `agent_skills` row keyed by the existing
 * `uq_agent_skills_agent_skill (agent_id, skill_id)` index.
 *
 * `derive-agent-skills.ts` runs on workspace AGENTS.md writes and uses
 * `onConflictDoNothing` to preserve metadata, so this resolver setting
 * `enabled=true` doesn't fight the workspace-driven path. Workspace
 * deletion of `skills/<slug>/SKILL.md` still drops the row, but our
 * `enabled=true` wouldn't survive that anyway.
 *
 * Plan: docs/plans/2026-05-09-009-feat-customize-skills-live-plan.md U5-1.
 */
export async function enableSkill(
  _parent: unknown,
  args: EnableSkillArgs,
  ctx: GraphQLContext,
) {
  const { computerId, skillId } = args.input;
  const caller = await resolveCaller(ctx);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Authentication required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const [computer] = await db
    .select({
      id: computers.id,
      tenant_id: computers.tenant_id,
      owner_user_id: computers.owner_user_id,
      primary_agent_id: computers.primary_agent_id,
      migrated_from_agent_id: computers.migrated_from_agent_id,
    })
    .from(computers)
    .where(
      and(
        eq(computers.id, computerId),
        eq(computers.owner_user_id, caller.userId),
        ne(computers.status, "archived"),
      ),
    );
  if (!computer) {
    throw new GraphQLError("Computer not found or not accessible", {
      extensions: { code: "COMPUTER_NOT_FOUND" },
    });
  }

  await requireTenantMember(ctx, computer.tenant_id);

  if (isBuiltinToolSlug(skillId)) {
    throw new GraphQLError(
      "Built-in skills are managed by your tenant template, not the Customize page.",
      { extensions: { code: "CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE" } },
    );
  }

  const agentId =
    computer.primary_agent_id ?? computer.migrated_from_agent_id ?? null;
  if (!agentId) {
    throw new GraphQLError(
      "This Computer has no primary agent — open the workbench once to provision one.",
      { extensions: { code: "CUSTOMIZE_PRIMARY_AGENT_NOT_FOUND" } },
    );
  }

  const [catalog] = await db
    .select()
    .from(tenantSkills)
    .where(
      and(
        eq(tenantSkills.tenant_id, computer.tenant_id),
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
      tenant_id: computer.tenant_id,
      agent_id: agentId,
      skill_id: skillId,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [agentSkills.agent_id, agentSkills.skill_id],
      set: {
        enabled: true,
      },
    })
    .returning();

  if (!row) {
    throw new GraphQLError("Failed to enable skill", {
      extensions: { code: "INTERNAL_ERROR" },
    });
  }

  await renderWorkspaceAfterCustomize("enableSkill", agentId, computer.id);

  // Return the AgentSkill projection (matches the existing GraphQL type
  // exposed by setAgentSkills + agents.graphql — no duplicate projection).
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
