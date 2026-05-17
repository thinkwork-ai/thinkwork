import { and, desc, eq, inArray } from "drizzle-orm";
import {
  ontologyChangeSetItems,
  tenantEntityExternalRefs,
  tenantEntityPages,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";

type DbLike = typeof defaultDb;

export interface OntologyImpactItem {
  id?: string;
  item_type: string;
  action: string;
  status?: string;
  target_slug?: string | null;
  proposed_value: unknown;
  edited_value?: unknown;
}

export interface OntologyReprocessImpact {
  affectedEntityTypeSlugs: string[];
  affectedPageIds: string[];
  affectedPageCount: number;
  affectedExternalRefCount: number;
  impactedFacetSlugs: string[];
  impactedRelationshipSlugs: string[];
  capHit: boolean;
  continuation?: {
    pageOffset: number;
    remainingPageCount: number;
  };
}

export async function loadOntologyImpactItems(args: {
  tenantId: string;
  changeSetId: string;
  db?: DbLike;
}): Promise<OntologyImpactItem[]> {
  const db = args.db ?? defaultDb;
  return db
    .select()
    .from(ontologyChangeSetItems)
    .where(
      and(
        eq(ontologyChangeSetItems.tenant_id, args.tenantId),
        eq(ontologyChangeSetItems.change_set_id, args.changeSetId),
      ),
    )
    .orderBy(ontologyChangeSetItems.position);
}

export async function analyzeOntologyReprocessImpact(args: {
  tenantId: string;
  items: OntologyImpactItem[];
  db?: DbLike;
  pageCap?: number;
}): Promise<OntologyReprocessImpact> {
  const db = args.db ?? defaultDb;
  const pageCap = Math.max(1, args.pageCap ?? 250);
  const entityTypeSlugs = extractAffectedEntityTypeSlugs(args.items);
  const facetSlugs = extractFacetSlugs(args.items);
  const relationshipSlugs = extractRelationshipSlugs(args.items);
  const sourceKinds = extractSourceKinds(args.items);

  const pageRows =
    entityTypeSlugs.length > 0
      ? await db
          .select({ id: tenantEntityPages.id })
          .from(tenantEntityPages)
          .where(
            and(
              eq(tenantEntityPages.tenant_id, args.tenantId),
              eq(tenantEntityPages.status, "active"),
              inArray(tenantEntityPages.entity_subtype, entityTypeSlugs),
            ),
          )
          .orderBy(desc(tenantEntityPages.updated_at))
      : [];

  const externalRefRows =
    sourceKinds.length > 0
      ? await db
          .select({ id: tenantEntityExternalRefs.id })
          .from(tenantEntityExternalRefs)
          .where(
            and(
              eq(tenantEntityExternalRefs.tenant_id, args.tenantId),
              inArray(tenantEntityExternalRefs.source_kind, sourceKinds),
            ),
          )
          .limit(1000)
      : [];

  const affectedPageIds = pageRows.slice(0, pageCap).map((row) => row.id);
  const capHit = pageRows.length > affectedPageIds.length;

  return {
    affectedEntityTypeSlugs: entityTypeSlugs,
    affectedPageIds,
    affectedPageCount: pageRows.length,
    affectedExternalRefCount: externalRefRows.length,
    impactedFacetSlugs: facetSlugs,
    impactedRelationshipSlugs: relationshipSlugs,
    capHit,
    ...(capHit
      ? {
          continuation: {
            pageOffset: affectedPageIds.length,
            remainingPageCount: pageRows.length - affectedPageIds.length,
          },
        }
      : {}),
  };
}

export function extractAffectedEntityTypeSlugs(
  items: OntologyImpactItem[],
): string[] {
  const slugs = new Set<string>();
  for (const item of activeItems(items)) {
    const value = itemValue(item);
    if (item.item_type === "entity_type") {
      addString(slugs, item.target_slug);
      addString(slugs, value.slug);
    }
    if (item.item_type === "relationship_type") {
      addStrings(slugs, value.sourceTypeSlugs);
      addStrings(slugs, value.targetTypeSlugs);
    }
    if (item.item_type === "facet_template") {
      addString(slugs, value.entityTypeSlug);
    }
    if (item.item_type === "external_mapping") {
      addString(
        slugs,
        value.subjectKind === "entity_type" && value.subjectSlug,
      );
    }
  }
  return [...slugs].sort();
}

function extractFacetSlugs(items: OntologyImpactItem[]): string[] {
  const slugs = new Set<string>();
  for (const item of activeItems(items)) {
    if (item.item_type !== "facet_template") continue;
    const value = itemValue(item);
    addString(slugs, item.target_slug);
    addString(slugs, value.slug);
  }
  return [...slugs].sort();
}

function extractRelationshipSlugs(items: OntologyImpactItem[]): string[] {
  const slugs = new Set<string>();
  for (const item of activeItems(items)) {
    if (item.item_type !== "relationship_type") continue;
    const value = itemValue(item);
    addString(slugs, item.target_slug);
    addString(slugs, value.slug);
  }
  return [...slugs].sort();
}

function extractSourceKinds(items: OntologyImpactItem[]): string[] {
  const sourceKinds = new Set<string>();
  for (const item of activeItems(items)) {
    const value = itemValue(item);
    addStrings(sourceKinds, value.sourcePriority);
  }
  return [...sourceKinds].sort();
}

function activeItems(items: OntologyImpactItem[]) {
  return items.filter(
    (item) => item.status !== "rejected" && item.action !== "reject",
  );
}

function itemValue(item: OntologyImpactItem): Record<string, any> {
  const value = item.edited_value ?? item.proposed_value;
  return value && typeof value === "object"
    ? (value as Record<string, any>)
    : {};
}

function addStrings(target: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const item of value) addString(target, item);
}

function addString(target: Set<string>, value: unknown) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed) target.add(trimmed);
}
