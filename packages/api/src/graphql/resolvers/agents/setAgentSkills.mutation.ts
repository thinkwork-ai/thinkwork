import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  inArray,
  agents,
  agentSkills,
  snakeToCamel,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";

export async function setAgentSkills(
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) {
  // R16: an agent holding thinkwork-admin with `set_agent_skills` in its
  // own allowlist must not be able to rewrite its own permissions.operations
  // jsonb. This closes the self-bootstrapping privilege-escalation loop
  // (apikey caller = agent.id; the agent grants itself every op). Check
  // fires BEFORE requireTenantAdmin so it's order-independent of future
  // changes to the admin gate. Cross-agent provisioning stays allowed —
  // reconcilers and onboarding automations legitimately set sibling-agent
  // skills.
  if (
    ctx.auth.authType === "apikey" &&
    ctx.auth.agentId &&
    ctx.auth.agentId === args.agentId
  ) {
    throw new GraphQLError(
      "An agent cannot modify its own skill permissions",
      { extensions: { code: "FORBIDDEN" } },
    );
  }

  // Resolve the target agent's tenant so the role gate runs against the
  // authoritative tenantId, not a caller-supplied one. An unauthorized
  // empty-skills call is still refused — the P0 defense here is that a
  // member cannot overwrite agent_skills.permissions under any path.
  const [agent] = await db
    .select({ tenant_id: agents.tenant_id })
    .from(agents)
    .where(eq(agents.id, args.agentId));
  if (!agent) throw new Error("Agent not found");
  await requireTenantAdmin(ctx, agent.tenant_id);

  // Safety: never delete all skills if the incoming list is empty.
  if (args.skills.length === 0) {
    console.warn(
      `[setAgentSkills] Ignoring empty skills list for agent ${args.agentId} — likely stale UI state`,
    );
    const existing = await db
      .select()
      .from(agentSkills)
      .where(eq(agentSkills.agent_id, args.agentId));
    return existing.map(snakeToCamel);
  }

  const incomingSkillIds: string[] = args.skills.map((s: any) => s.skillId);

  // Delete skills that are NOT in the incoming list
  const existing = await db
    .select({ skill_id: agentSkills.skill_id })
    .from(agentSkills)
    .where(eq(agentSkills.agent_id, args.agentId));

  const toDelete = existing
    .map((r) => r.skill_id)
    .filter((id) => !incomingSkillIds.includes(id));

  if (toDelete.length > 0) {
    await db
      .delete(agentSkills)
      .where(
        and(
          eq(agentSkills.agent_id, args.agentId),
          inArray(agentSkills.skill_id, toDelete),
        ),
      );
  }

  // Upsert each incoming skill
  for (const s of args.skills) {
    const config = s.config
      ? typeof s.config === "string"
        ? JSON.parse(s.config)
        : s.config
      : undefined;
    const permissions = s.permissions
      ? typeof s.permissions === "string"
        ? JSON.parse(s.permissions)
        : s.permissions
      : undefined;

    await db
      .insert(agentSkills)
      .values({
        agent_id: args.agentId,
        tenant_id: agent.tenant_id,
        skill_id: s.skillId,
        config,
        permissions,
        rate_limit_rpm: s.rateLimitRpm,
        model_override: s.modelOverride ?? null,
        enabled: s.enabled ?? true,
      })
      .onConflictDoUpdate({
        target: [agentSkills.agent_id, agentSkills.skill_id],
        set: {
          config,
          permissions,
          rate_limit_rpm: s.rateLimitRpm,
          model_override: s.modelOverride ?? null,
          enabled: s.enabled ?? true,
        },
      });
  }

  const rows = await db
    .select()
    .from(agentSkills)
    .where(eq(agentSkills.agent_id, args.agentId));

  // Regenerate AGENTS.md workspace map so skill catalog stays in sync
  try {
    const { regenerateWorkspaceMap } =
      await import("../../../lib/workspace-map-generator.js");
    regenerateWorkspaceMap(args.agentId).catch((err: unknown) => {
      console.error(
        "[setAgentSkills] Failed to regenerate workspace map:",
        err,
      );
    });
  } catch (err) {
    console.warn(
      "[setAgentSkills] workspace-map-generator not available:",
      err,
    );
  }

  return rows.map(snakeToCamel);
}
