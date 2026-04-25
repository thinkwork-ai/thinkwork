import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  inArray,
  agents,
  agentSkills,
  agentTemplates,
  snakeToCamel,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { validateAgentSkillPermissions } from "../../../lib/skills/permissions-subset.js";

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

  // Resolve the target agent's tenant AND its template_id so the role
  // gate runs against the authoritative tenantId, and the per-skill
  // subset check (Unit 5) has the template ceiling available.
  //
  // template_id is notNull on the agents schema, so every agent always
  // has a template — no null-branching needed.
  const [agent] = await db
    .select({
      tenant_id: agents.tenant_id,
      template_id: agents.template_id,
    })
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

  // Unit 5: write-time subset enforcement.
  //
  // For any incoming skill whose manifest declares
  // `permissions_model: operations`, enforce
  //   agent.ops ⊆ template.ops ⊆ manifest.ops
  // before the upsert. Closes the UI-only-contract gap against the
  // stated threat model (shared-service-secret impersonation): any
  // non-UI caller (CLI, direct GraphQL, the thinkwork-admin skill's
  // own set_agent_skills wrapper) hits this same resolver.
  //
  // Lookup: parse skill_catalog.tier1_metadata (full parsed SKILL.md
  // frontmatter, stored as JSON-stringified jsonb by sync-catalog-db.ts)
  // for every distinct skill_id in the payload. Template permissions
  // come from agent_templates.skills (already notNull on
  // agent.template_id).
  const permissionsModelMap = new Map<
    string,
    { permissionsModel: "operations" | null; manifestOps: string[] }
  >();
  {
    const { skillCatalog } = await import("@thinkwork/database-pg/schema");
    const catalogRows = await db
      .select({
        slug: skillCatalog.slug,
        tier1_metadata: skillCatalog.tier1_metadata,
      })
      .from(skillCatalog)
      .where(inArray(skillCatalog.slug, incomingSkillIds));
    for (const row of catalogRows) {
      const meta = parseTier1Metadata(row.tier1_metadata);
      permissionsModelMap.set(row.slug, {
        permissionsModel:
          meta?.permissions_model === "operations" ? "operations" : null,
        manifestOps: extractDefaultEnabledOps(meta),
      });
    }
  }

  const hasSubsetCheck = Array.from(permissionsModelMap.values()).some(
    (m) => m.permissionsModel === "operations",
  );
  let templateSkillsById: Map<string, any> = new Map();
  if (hasSubsetCheck) {
    const [template] = await db
      .select({ skills: agentTemplates.skills })
      .from(agentTemplates)
      .where(eq(agentTemplates.id, agent.template_id!));
    if (template) {
      const rawTemplateSkills = Array.isArray(template.skills)
        ? (template.skills as any[])
        : [];
      templateSkillsById = new Map(
        rawTemplateSkills
          .filter(
            (s): s is { skill_id: string } =>
              !!s && typeof (s as any).skill_id === "string",
          )
          .map((s) => [s.skill_id, s]),
      );
    }
  }

  for (const s of args.skills) {
    const entry = permissionsModelMap.get(s.skillId);
    if (!entry || entry.permissionsModel !== "operations") continue;
    // Only skills that opt into permissions_model: operations are gated.
    // Other skills keep their existing free-form permissions jsonb.
    const templateSkill = templateSkillsById.get(s.skillId);
    const result = validateAgentSkillPermissions(
      s.permissions,
      templateSkill?.permissions,
      entry.manifestOps,
    );
    if (!result.ok) {
      throw new GraphQLError(result.error, {
        extensions: { code: "BAD_USER_INPUT", skillId: s.skillId },
      });
    }
  }

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

  // Upsert each incoming skill.
  //
  // Defensive resolver guard (Unit 5): conditionally include
  // `permissions` in the onConflictDoUpdate `set` clause only when
  // s.permissions !== undefined. This preserves the existing column
  // value when a caller (notably the mobile app, which still omits
  // `permissions` from its SetAgentSkills fragment per plan Scope
  // Boundaries) doesn't send the field, preventing silent
  // undefined-becomes-NULL writes. The plan's mobile deferral is safe
  // as long as this guard is in place. See Key Technical Decisions.
  for (const s of args.skills) {
    const config = s.config
      ? typeof s.config === "string"
        ? JSON.parse(s.config)
        : s.config
      : undefined;
    const permissionsProvided = s.permissions !== undefined;
    const permissions = permissionsProvided
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
          // Only include permissions in the update if the caller sent it.
          // Undefined here would omit the column from the SET clause in
          // Drizzle 0.39+ (preserving existing), but being explicit
          // is load-bearing for the mobile-deferral safety story.
          ...(permissionsProvided ? { permissions } : {}),
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

/**
 * `skill_catalog.tier1_metadata` stores the full parsed SKILL.md
 * frontmatter as a JSON-stringified blob in a jsonb column (see
 * `packages/skill-catalog/scripts/sync-catalog-db.ts`). Plan
 * 2026-04-24-009 §U3 flipped the producer's source from `skill.yaml` to
 * SKILL.md frontmatter; the JSONB shape is preserved verbatim so this
 * reader and `extractDefaultEnabledOps` stay drop-in compatible. Postgres
 * + Drizzle may hand us either the already-parsed object or the string
 * form depending on the Data API driver path.
 */
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
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

/**
 * Pulls out the list of op names whose manifest entry has
 * `default_enabled: true`. This is the closed-universe ceiling the
 * subset validator enforces — ops outside this set are typos or
 * fabricated names that must not land in agent_skills.permissions.
 */
function extractDefaultEnabledOps(
  meta: Record<string, unknown> | null,
): string[] {
  if (!meta) return [];
  const scripts = meta.scripts;
  if (!Array.isArray(scripts)) return [];
  const ops: string[] = [];
  for (const entry of scripts) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const s = entry as Record<string, unknown>;
    if (typeof s.name !== "string") continue;
    // default_enabled must be the JSON-coerced boolean `true`. Both
    // sources of tier1_metadata — TS sync-catalog-db.ts (yaml-package
    // safeLoad) and Python skill_md_parser (yaml.safe_load) — produce a
    // real boolean for `default_enabled: true` in YAML, so this check
    // succeeds only for genuine YAML booleans, never for the literal
    // string "true".
    if (s.default_enabled === true) ops.push(s.name);
  }
  return ops;
}
