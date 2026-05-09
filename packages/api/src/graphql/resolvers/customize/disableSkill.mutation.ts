import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  agentSkills,
  and,
  computers,
  db,
  eq,
  ne,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { requireTenantMember } from "../core/authz.js";
import { isBuiltinToolSlug } from "../../../lib/builtin-tool-slugs.js";
import { renderWorkspaceAfterCustomize } from "./render-workspace-after-customize.js";

export interface DisableSkillArgs {
  input: { computerId: string; skillId: string };
}

/**
 * Disable a skill binding for the caller's Computer. Idempotent — if no
 * binding exists, returns true without writing.
 *
 * Plan: docs/plans/2026-05-09-009-feat-customize-skills-live-plan.md U5-1.
 */
export async function disableSkill(
  _parent: unknown,
  args: DisableSkillArgs,
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
    // Disable is idempotent end-to-end. With no primary agent there is no
    // `agent_skills` row that could possibly be enabled, so the disable
    // contract is already satisfied. Return true silently rather than
    // mirror enableSkill's CUSTOMIZE_PRIMARY_AGENT_NOT_FOUND error —
    // enable can't proceed (nowhere to write), disable has nothing to do.
    return true;
  }

  await db
    .update(agentSkills)
    .set({ enabled: false })
    .where(
      and(
        eq(agentSkills.agent_id, agentId),
        eq(agentSkills.skill_id, skillId),
      ),
    );

  await renderWorkspaceAfterCustomize("disableSkill", agentId, computer.id);

  return true;
}
