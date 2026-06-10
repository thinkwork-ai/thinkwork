import { and, desc, eq } from "drizzle-orm";
import {
  ontologyEntityTypes,
  ontologyVersions,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import { SEED_ONTOLOGY_TEMPLATES } from "./templates.js";

type DbLike = typeof defaultDb;

/**
 * Minimal approved baseline seeded at tenant bootstrap (plan R11). Without an
 * active ontology version every node a fresh tenant's first observations
 * ingest extracts is dropped as `unapproved_entity_type`, deadlocking the
 * graph behind the first manual approval. Slugs are drawn from
 * `SEED_ONTOLOGY_TEMPLATES` so the approved types carry the seed page
 * contract from day one.
 */
export const BASELINE_ONTOLOGY_ENTITY_TYPE_SLUGS = [
  "customer",
  "person",
  "project",
  "task",
] as const;

export interface EnsureBaselineOntologyResult {
  seeded: boolean;
  versionId: string | null;
  entityTypeSlugs: string[];
}

/**
 * Idempotently seed a minimal approved ontology version for a tenant.
 * No-ops when an active version already exists; safe under concurrent
 * bootstrap calls (unique active-version index + onConflictDoNothing).
 */
export async function ensureBaselineOntology(
  db: DbLike | null | undefined,
  tenantId: string,
): Promise<EnsureBaselineOntologyResult> {
  const database = db ?? defaultDb;

  const [activeVersion] = await database
    .select({ id: ontologyVersions.id })
    .from(ontologyVersions)
    .where(
      and(
        eq(ontologyVersions.tenant_id, tenantId),
        eq(ontologyVersions.status, "active"),
      ),
    )
    .limit(1);
  if (activeVersion) {
    return { seeded: false, versionId: activeVersion.id, entityTypeSlugs: [] };
  }

  const [latestVersion] = await database
    .select({ versionNumber: ontologyVersions.version_number })
    .from(ontologyVersions)
    .where(eq(ontologyVersions.tenant_id, tenantId))
    .orderBy(desc(ontologyVersions.version_number))
    .limit(1);
  const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;
  const now = new Date();

  const [insertedVersion] = await database
    .insert(ontologyVersions)
    .values({
      tenant_id: tenantId,
      version_number: nextVersionNumber,
      status: "active",
      activated_at: now,
    })
    .onConflictDoNothing()
    .returning({ id: ontologyVersions.id });

  if (!insertedVersion) {
    // Lost a bootstrap race: another caller activated a version between the
    // existence check and the insert (uq_ontology_versions_tenant_active).
    const [racedVersion] = await database
      .select({ id: ontologyVersions.id })
      .from(ontologyVersions)
      .where(
        and(
          eq(ontologyVersions.tenant_id, tenantId),
          eq(ontologyVersions.status, "active"),
        ),
      )
      .limit(1);
    return {
      seeded: false,
      versionId: racedVersion?.id ?? null,
      entityTypeSlugs: [],
    };
  }

  const seededSlugs: string[] = [];
  for (const slug of BASELINE_ONTOLOGY_ENTITY_TYPE_SLUGS) {
    const template = SEED_ONTOLOGY_TEMPLATES[slug];
    if (!template) continue;
    await database
      .insert(ontologyEntityTypes)
      .values({
        tenant_id: tenantId,
        version_id: insertedVersion.id,
        slug: template.entityTypeSlug,
        name: template.entityTypeName,
        description: template.description,
        broad_type: template.broadType,
        guidance_notes: template.guidanceNotes,
        lifecycle_status: "approved",
        approved_at: now,
      })
      .onConflictDoNothing()
      .returning({ id: ontologyEntityTypes.id });
    seededSlugs.push(template.entityTypeSlug);
  }

  return {
    seeded: true,
    versionId: insertedVersion.id,
    entityTypeSlugs: seededSlugs,
  };
}
