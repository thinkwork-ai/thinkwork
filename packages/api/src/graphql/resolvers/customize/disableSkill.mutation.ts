import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { agentSkills, and, db, eq } from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { requireTenantMember } from "../core/authz.js";
import { isBuiltinToolSlug } from "../../../lib/builtin-tool-slugs.js";
import { renderWorkspaceAfterCustomize } from "./render-workspace-after-customize.js";
import {
  PlatformAgentNotFoundError,
  resolveTenantPlatformAgent,
} from "../../../lib/agents/tenant-platform-agent.js";

export interface DisableSkillArgs {
  input: { agentId: string; skillId: string };
}

/**
 * Disable a skill on the caller's tenant platform agent. Idempotent — if
 * no binding exists, returns true without writing.
 */
export async function disableSkill(
  _parent: unknown,
  args: DisableSkillArgs,
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

  if (isBuiltinToolSlug(skillId)) {
    throw new GraphQLError(
      "Built-in skills are managed by your tenant template, not the Customize page.",
      { extensions: { code: "CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE" } },
    );
  }

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
      // Disable is idempotent — no agent means nothing to disable.
      return true;
    }
    throw err;
  }

  await db
    .update(agentSkills)
    .set({ enabled: false })
    .where(
      and(
        eq(agentSkills.agent_id, resolvedAgentId),
        eq(agentSkills.skill_id, skillId),
      ),
    );

  await renderWorkspaceAfterCustomize("disableSkill", resolvedAgentId);

  return true;
}
