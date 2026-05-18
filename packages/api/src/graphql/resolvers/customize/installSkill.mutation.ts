/**
 * installSkill — upsert a row into `tenant_skills` so the tenant has a
 * catalog skill enabled at the tenant scope.
 *
 * Idempotent by `(tenant_id, skill_id)`. The same mutation backs the
 * CLI's `skill install` and `skill upgrade` verbs — they both
 * effectively "set the installed version to this." When `version` is
 * omitted, the resolver reads the current value from `skill_catalog`
 * so operators don't need to know the version string.
 *
 * Auth: `requireAdminOrServiceCaller`. Tenant-tier install/upgrade
 * (no user-identity stamping); service callers admitted.
 *
 * Does NOT touch agent-level assignments — that's `agent skills set`
 * + AGENTS.md routing. tenant_skills only marks "this skill is
 * available in this tenant."
 */

import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  skillCatalog,
  tenantSkills,
  snakeToCamel,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

interface Input {
  tenantId: string;
  skillId: string;
  version?: string | null;
}

export const installSkill = async (
  _parent: unknown,
  args: { input: Input },
  ctx: GraphQLContext,
) => {
  const { tenantId, skillId } = args.input;

  await requireAdminOrServiceCaller(ctx, tenantId, "install_skill");

  const [catalogRow] = await db
    .select({ slug: skillCatalog.slug, version: skillCatalog.version })
    .from(skillCatalog)
    .where(eq(skillCatalog.slug, skillId));

  // Permissive: callers can install a skill the catalog doesn't yet
  // know about (e.g., a custom skill pushed via `skill push`). When
  // there's no catalog row, `catalog_version` stays null and the
  // resolver requires an explicit `version`.
  if (!catalogRow && !args.input.version) {
    throw new Error(
      `Skill "${skillId}" is not in skill_catalog and no --version was supplied.`,
    );
  }

  const version = args.input.version ?? catalogRow?.version ?? null;
  const catalogVersion = catalogRow?.version ?? null;
  const source = catalogRow ? "catalog" : "tenant";

  // Manual upsert via SELECT-then-INSERT-or-UPDATE — keeps the
  // operation explicit + works around Drizzle's onConflict ergonomics
  // for partial updates (we don't want to clobber `config` here).
  const [existing] = await db
    .select()
    .from(tenantSkills)
    .where(
      and(
        eq(tenantSkills.tenant_id, tenantId),
        eq(tenantSkills.skill_id, skillId),
      ),
    );

  if (existing) {
    const [updated] = await db
      .update(tenantSkills)
      .set({
        version,
        catalog_version: catalogVersion,
        source,
        enabled: true,
        updated_at: new Date(),
      })
      .where(eq(tenantSkills.id, existing.id))
      .returning();
    return snakeToCamel(updated);
  }

  const [inserted] = await db
    .insert(tenantSkills)
    .values({
      tenant_id: tenantId,
      skill_id: skillId,
      source,
      version,
      catalog_version: catalogVersion,
      enabled: true,
    })
    .returning();
  return snakeToCamel(inserted);
};
