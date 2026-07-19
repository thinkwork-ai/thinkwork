import { and, eq, inArray } from "drizzle-orm";
import {
  ontologyChangeSetItems,
  ontologyChangeSets,
  ontologyEntityTypes,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import {
  SEED_ONTOLOGY_TEMPLATES,
  type OntologyEntityPageTemplate,
} from "./templates.js";
import {
  loadOntologyChangeSet,
  type OntologyChangeSetSlugConflict,
} from "./repository.js";
import {
  persistOntologyChangeSetProposals,
  type OntologyChangeSetProposal,
  type OntologySuggestionItemProposal,
} from "./suggestions.js";

type DbLike = typeof defaultDb;

const OPEN_CHANGE_SET_STATUSES = ["draft", "pending_review"] as const;
const PENDING_ITEM_STATUSES = ["pending_review", "deferred"] as const;

export type OntologyPackTypeState = "approved" | "pending" | "available";

export interface OntologyPackDefinition {
  slug: string;
  name: string;
  description: string;
  /** SEED_ONTOLOGY_TEMPLATES keys bundled by this pack. */
  entityTypeSlugs: string[];
}

export interface OntologyPackTypeListing {
  slug: string;
  name: string;
  description: string | null;
  state: OntologyPackTypeState;
}

export interface OntologyPackListing {
  slug: string;
  name: string;
  description: string;
  types: OntologyPackTypeListing[];
}

/**
 * Named bundles over the dormant seed templates (THINK-320 U3 / R11). The
 * four baseline types (customer, person, project, task) are seeded at tenant
 * bootstrap and stay out of packs; the remaining ten templates group into
 * domain bundles an admin installs as one pre-staged change set.
 */
export const ONTOLOGY_PACKS: OntologyPackDefinition[] = [
  {
    slug: "customer-support",
    name: "Customer Support",
    description:
      "Support cases, customer commitments, and delivery risks — the follow-through layer around the baseline customer type.",
    entityTypeSlugs: ["support_case", "commitment", "risk"],
  },
  {
    slug: "revenue",
    name: "Revenue Operations",
    description:
      "Opportunities and orders — the commercial pipeline from deal motion to fulfilled transaction.",
    entityTypeSlugs: ["opportunity", "order"],
  },
  {
    slug: "decisions",
    name: "Decisions & Preferences",
    description:
      "Durable decisions with rationale, plus user preferences and constraints worth remembering.",
    entityTypeSlugs: ["decision", "preference"],
  },
  {
    slug: "travel",
    name: "Travel & Places",
    description:
      "Places, venues, and trips — geographic and travel context for personal and field work.",
    entityTypeSlugs: ["place", "venue", "trip"],
  },
];

export function findOntologyPack(
  packSlug: string,
): OntologyPackDefinition | null {
  return ONTOLOGY_PACKS.find((pack) => pack.slug === packSlug) ?? null;
}

/**
 * Pure per-type state resolution: approved definitions win, then pending
 * change-set items, else the type is available to install.
 */
export function buildOntologyPackListing(args: {
  approvedEntityTypeSlugs: Set<string>;
  pendingEntityTypeSlugs: Set<string>;
  packs?: OntologyPackDefinition[];
  templates?: Record<string, OntologyEntityPageTemplate>;
}): OntologyPackListing[] {
  const packs = args.packs ?? ONTOLOGY_PACKS;
  const templates = args.templates ?? SEED_ONTOLOGY_TEMPLATES;
  return packs.map((pack) => ({
    slug: pack.slug,
    name: pack.name,
    description: pack.description,
    types: pack.entityTypeSlugs.flatMap((slug) => {
      const template = templates[slug];
      if (!template) return [];
      const state: OntologyPackTypeState = args.approvedEntityTypeSlugs.has(
        slug,
      )
        ? "approved"
        : args.pendingEntityTypeSlugs.has(slug)
          ? "pending"
          : "available";
      return [
        {
          slug,
          name: template.entityTypeName,
          description: template.description,
          state,
        },
      ];
    }),
  }));
}

/**
 * Build the staged proposal for one pack: an entity_type item per template
 * plus a facet_template item per template section. Facet target slugs are
 * scoped `<entityTypeSlug>:<sectionSlug>` so collision fingerprints don't
 * cross entity types; the applied definition still reads
 * `proposedValue.slug` / `proposedValue.entityTypeSlug`.
 */
export function buildOntologyPackProposal(
  pack: OntologyPackDefinition,
  templates: Record<
    string,
    OntologyEntityPageTemplate
  > = SEED_ONTOLOGY_TEMPLATES,
): OntologyChangeSetProposal {
  const items: OntologySuggestionItemProposal[] = [];
  for (const slug of pack.entityTypeSlugs) {
    const template = templates[slug];
    if (!template) continue;
    items.push({
      itemType: "entity_type",
      action: "create",
      targetKind: "entity_type",
      targetSlug: template.entityTypeSlug,
      title: `Add ${template.entityTypeName} entity type`,
      description:
        template.description ??
        `Install the ${template.entityTypeName} seed type.`,
      proposedValue: {
        slug: template.entityTypeSlug,
        name: template.entityTypeName,
        broadType: template.broadType,
        description: template.description,
        aliases: [],
        guidanceNotes: template.guidanceNotes,
      },
      confidence: 1,
      evidence: [],
    });
    for (const section of template.sections) {
      if (section.lifecycleStatus !== "approved") continue;
      items.push({
        itemType: "facet_template",
        action: "create",
        targetKind: "facet_template",
        targetSlug: `${template.entityTypeSlug}:${section.slug}`,
        title: `Add ${template.entityTypeName} ${section.heading} facet`,
        description: `Facet template "${section.heading}" for ${template.entityTypeName} pages.`,
        proposedValue: {
          entityTypeSlug: template.entityTypeSlug,
          slug: section.slug,
          heading: section.heading,
          facetType: section.facetType,
          position: section.position,
          sourcePriority: section.sourcePriority,
          prompt: section.prompt,
          guidanceNotes: section.guidanceNotes,
        },
        confidence: 1,
        evidence: [],
      });
    }
  }
  return {
    key: `pack-${pack.slug}`,
    title: `Install ${pack.name} pack`,
    summary: `${pack.description} Installing stages the pack's types and facets for admin review; nothing applies until approval.`,
    confidence: 1,
    observedFrequency: 1,
    expectedImpact: {
      pack: pack.slug,
      entityTypes: pack.entityTypeSlugs,
    },
    items,
  };
}

/**
 * Pack browsing feed (R11): every pack with per-type state, computed from
 * approved definitions and pending items in open change sets.
 */
export async function listOntologyPacks(args: {
  tenantId: string;
  db?: DbLike;
}): Promise<OntologyPackListing[]> {
  const db = args.db ?? defaultDb;
  const approvedRows = await db
    .select({ slug: ontologyEntityTypes.slug })
    .from(ontologyEntityTypes)
    .where(
      and(
        eq(ontologyEntityTypes.tenant_id, args.tenantId),
        eq(ontologyEntityTypes.lifecycle_status, "approved"),
      ),
    );
  const openSets = await db
    .select({ id: ontologyChangeSets.id })
    .from(ontologyChangeSets)
    .where(
      and(
        eq(ontologyChangeSets.tenant_id, args.tenantId),
        inArray(ontologyChangeSets.status, [...OPEN_CHANGE_SET_STATUSES]),
      ),
    );
  const openSetIds = openSets.map((row) => row.id);
  const pendingRows =
    openSetIds.length > 0
      ? await db
          .select({ target_slug: ontologyChangeSetItems.target_slug })
          .from(ontologyChangeSetItems)
          .where(
            and(
              eq(ontologyChangeSetItems.tenant_id, args.tenantId),
              inArray(ontologyChangeSetItems.change_set_id, openSetIds),
              eq(ontologyChangeSetItems.item_type, "entity_type"),
              inArray(ontologyChangeSetItems.status, [
                ...PENDING_ITEM_STATUSES,
              ]),
            ),
          )
      : [];
  return buildOntologyPackListing({
    approvedEntityTypeSlugs: new Set(approvedRows.map((row) => row.slug)),
    pendingEntityTypeSlugs: new Set(
      pendingRows
        .map((row) => row.target_slug)
        .filter((slug): slug is string => Boolean(slug)),
    ),
  });
}

export interface InstallOntologyPackResult {
  changeSet: Awaited<ReturnType<typeof loadOntologyChangeSet>> | null;
  mergedItemIds: string[];
  conflicts: OntologyChangeSetSlugConflict[];
  skippedRejectedSlugs: string[];
}

/**
 * Install a pack as a pre-staged change set (THINK-320 U3 / R11, R12).
 * Persists through the governed proposal path with `proposedBy:
 * 'pack_install'` (evidence-optional): hand-authored pending slugs merge
 * instead of duplicating, approved slugs surface as conflicts (R14/AE6),
 * rejected fingerprints are skipped and deferred items re-surface on
 * re-install (R13).
 */
export async function installOntologyPack(args: {
  tenantId: string;
  packSlug: string;
  db?: DbLike;
}): Promise<InstallOntologyPackResult> {
  const db = args.db ?? defaultDb;
  const pack = findOntologyPack(args.packSlug);
  if (!pack) {
    throw new Error(`Unknown ontology pack: ${args.packSlug}`);
  }
  const proposal = buildOntologyPackProposal(pack);
  const persisted = await persistOntologyChangeSetProposals({
    tenantId: args.tenantId,
    proposals: [proposal],
    proposedBy: "pack_install",
    db,
  });
  const changeSetId =
    persisted.createdChangeSetIds[0] ?? persisted.updatedChangeSetIds[0];
  const changeSet = changeSetId
    ? await loadOntologyChangeSet({
        tenantId: args.tenantId,
        changeSetId,
        db,
      })
    : null;
  return {
    changeSet,
    mergedItemIds: persisted.mergedItemIds,
    conflicts: persisted.conflicts,
    skippedRejectedSlugs: persisted.skippedRejectedSlugs,
  };
}
