/**
 * Section-waiver reads (THINK-183 U5): the query seam THINK-189's conformance
 * scoring consumes. Rows are written by document emission (head semantics —
 * see document-emission.ts replaceSectionWaivers); this module aggregates
 * counts and reasons per plate, scoped by tenant.
 */

import { getDb } from "@thinkwork/database-pg";
import { documentSectionWaivers } from "@thinkwork/database-pg/schema";
import { and, eq } from "drizzle-orm";

export interface SectionWaiverRow {
  artifactId: string;
  plateSlug: string;
  sectionId: string;
  tier: string;
  reason: string;
  createdAt: Date;
}

/** Injectable read seam so tests exercise aggregation without a live DB. */
export interface SectionWaiverReadStore {
  listByTenant(
    tenantId: string,
    plateSlug?: string,
  ): Promise<SectionWaiverRow[]>;
}

export function drizzleSectionWaiverReadStore(): SectionWaiverReadStore {
  return {
    listByTenant: async (tenantId, plateSlug) => {
      const rows = await getDb()
        .select()
        .from(documentSectionWaivers)
        .where(
          plateSlug !== undefined
            ? and(
                eq(documentSectionWaivers.tenant_id, tenantId),
                eq(documentSectionWaivers.plate_slug, plateSlug),
              )
            : eq(documentSectionWaivers.tenant_id, tenantId),
        );
      return rows.map((row) => ({
        artifactId: row.artifact_id,
        plateSlug: row.plate_slug,
        sectionId: row.section_id,
        tier: row.tier,
        reason: row.reason,
        createdAt: row.created_at,
      }));
    },
  };
}

export interface PlateWaiverSummary {
  plateSlug: string;
  /** Total waiver rows across documents of this plate. */
  count: number;
  /** Distinct documents carrying at least one waiver. */
  documentCount: number;
  waivers: Array<{
    artifactId: string;
    sectionId: string;
    tier: string;
    reason: string;
  }>;
}

/**
 * Waiver counts and reasons per plate for a tenant (R10). Pass `plateSlug`
 * to scope to one plate; omit it for all plates with waivers, ordered by
 * count descending then slug ascending (deterministic).
 */
export async function summarizePlateWaivers(
  tenantId: string,
  plateSlug?: string,
  store: SectionWaiverReadStore = drizzleSectionWaiverReadStore(),
): Promise<PlateWaiverSummary[]> {
  const rows = await store.listByTenant(tenantId, plateSlug);
  const byPlate = new Map<string, SectionWaiverRow[]>();
  for (const row of rows) {
    const list = byPlate.get(row.plateSlug) ?? [];
    list.push(row);
    byPlate.set(row.plateSlug, list);
  }
  return [...byPlate.entries()]
    .map(([slug, plateRows]) => ({
      plateSlug: slug,
      count: plateRows.length,
      documentCount: new Set(plateRows.map((r) => r.artifactId)).size,
      waivers: plateRows.map((r) => ({
        artifactId: r.artifactId,
        sectionId: r.sectionId,
        tier: r.tier,
        reason: r.reason,
      })),
    }))
    .sort(
      (a, b) => b.count - a.count || a.plateSlug.localeCompare(b.plateSlug),
    );
}
