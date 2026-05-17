import { and, asc, eq } from "drizzle-orm";
import {
  ontologyEntityTypes,
  ontologyFacetTemplates,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import {
  FACET_TYPES,
  type BrainSectionSourceKind,
  type FacetType,
} from "../brain/facet-types.js";

type DbLike = typeof defaultDb;

export interface OntologyFacetSectionTemplate {
  slug: string;
  heading: string;
  facetType: FacetType;
  position: number;
  sourcePriority: BrainSectionSourceKind[];
  prompt: string | null;
  guidanceNotes: string | null;
  lifecycleStatus: "approved" | "deprecated";
  source: "tenant" | "seed";
}

export interface OntologyEntityPageTemplate {
  entityTypeSlug: string;
  entityTypeName: string;
  broadType: string;
  description: string | null;
  guidanceNotes: string | null;
  sections: OntologyFacetSectionTemplate[];
  source: "tenant" | "seed";
}

const DEFAULT_SOURCE_PRIORITY: BrainSectionSourceKind[] = [
  "erp_customer",
  "crm_opportunity",
  "erp_order",
  "crm_person",
  "support_case",
  "hindsight_memory_unit",
  "memory_unit",
  "bedrock_kb",
];

export const SEED_ONTOLOGY_TEMPLATES: Record<
  string,
  OntologyEntityPageTemplate
> = {
  customer: {
    entityTypeSlug: "customer",
    entityTypeName: "Customer",
    broadType: "entity",
    description: "A customer or account the business serves.",
    guidanceNotes:
      "Keep the page account-centered. Prefer sourced operational facts and preserve active commitments and risks.",
    source: "seed",
    sections: [
      seedSection("overview", "Overview", "compiled", 10),
      seedSection("key_people", "Key People", "relationship", 20, [
        "crm_person",
        "hindsight_memory_unit",
        "memory_unit",
      ]),
      seedSection("opportunities", "Opportunities", "operational", 30, [
        "crm_opportunity",
        "hindsight_memory_unit",
        "memory_unit",
      ]),
      seedSection("open_commitments", "Open Commitments", "activity", 40, [
        "support_case",
        "hindsight_memory_unit",
        "memory_unit",
      ]),
      seedSection("risks_and_landmines", "Risks & Landmines", "compiled", 50, [
        "support_case",
        "hindsight_memory_unit",
        "memory_unit",
      ]),
      seedSection("recent_activity", "Recent Activity", "activity", 60, [
        "hindsight_memory_unit",
        "memory_unit",
        "support_case",
      ]),
    ],
  },
  opportunity: {
    entityTypeSlug: "opportunity",
    entityTypeName: "Opportunity",
    broadType: "entity",
    description: "A sales opportunity or deal motion.",
    guidanceNotes:
      "Summarize stage, customer context, decision makers, next steps, and known risks from cited sources.",
    source: "seed",
    sections: [
      seedSection("overview", "Overview", "compiled", 10, [
        "crm_opportunity",
        "hindsight_memory_unit",
        "memory_unit",
      ]),
      seedSection("stakeholders", "Stakeholders", "relationship", 20, [
        "crm_person",
        "hindsight_memory_unit",
        "memory_unit",
      ]),
      seedSection("next_steps", "Next Steps", "activity", 30, [
        "crm_opportunity",
        "hindsight_memory_unit",
        "memory_unit",
      ]),
      seedSection("risks", "Risks", "compiled", 40, [
        "support_case",
        "hindsight_memory_unit",
        "memory_unit",
      ]),
    ],
  },
  order: {
    entityTypeSlug: "order",
    entityTypeName: "Order",
    broadType: "entity",
    description: "An order, renewal, shipment, or commercial transaction.",
    guidanceNotes:
      "Keep order status, fulfillment state, blockers, and account obligations sourced.",
    source: "seed",
    sections: [
      seedSection("overview", "Overview", "operational", 10, ["erp_order"]),
      seedSection("status", "Status", "operational", 20, ["erp_order"]),
      seedSection("open_items", "Open Items", "activity", 30, [
        "erp_order",
        "hindsight_memory_unit",
        "memory_unit",
      ]),
    ],
  },
  person: {
    entityTypeSlug: "person",
    entityTypeName: "Person",
    broadType: "entity",
    description: "A person relevant to the business relationship.",
    guidanceNotes:
      "Capture role, affiliations, preferences, relationship notes, and recent interactions.",
    source: "seed",
    sections: [
      seedSection("overview", "Overview", "compiled", 10, [
        "crm_person",
        "hindsight_memory_unit",
        "memory_unit",
      ]),
      seedSection("relationship", "Relationship", "relationship", 20, [
        "crm_person",
        "hindsight_memory_unit",
        "memory_unit",
      ]),
      seedSection("recent_activity", "Recent Activity", "activity", 30, [
        "hindsight_memory_unit",
        "memory_unit",
      ]),
    ],
  },
};

export async function resolveOntologyTemplates(args: {
  tenantId: string;
  db?: DbLike;
}): Promise<Record<string, OntologyEntityPageTemplate>> {
  const db = args.db ?? defaultDb;
  const entityRows = await db
    .select()
    .from(ontologyEntityTypes)
    .where(
      and(
        eq(ontologyEntityTypes.tenant_id, args.tenantId),
        eq(ontologyEntityTypes.lifecycle_status, "approved"),
      ),
    )
    .orderBy(asc(ontologyEntityTypes.slug));
  const facetRows = await db
    .select()
    .from(ontologyFacetTemplates)
    .where(
      and(
        eq(ontologyFacetTemplates.tenant_id, args.tenantId),
        eq(ontologyFacetTemplates.lifecycle_status, "approved"),
      ),
    )
    .orderBy(
      asc(ontologyFacetTemplates.position),
      asc(ontologyFacetTemplates.slug),
    );

  const templates: Record<string, OntologyEntityPageTemplate> = {
    ...SEED_ONTOLOGY_TEMPLATES,
  };
  for (const entity of entityRows as any[]) {
    const entityFacets = (facetRows as any[])
      .filter((facet) => facet.entity_type_id === entity.id)
      .sort(
        (a, b) =>
          Number(a.position ?? 0) - Number(b.position ?? 0) ||
          String(a.slug).localeCompare(String(b.slug)),
      );
    templates[entity.slug] = {
      entityTypeSlug: entity.slug,
      entityTypeName: entity.name,
      broadType: entity.broad_type ?? "entity",
      description: entity.description ?? null,
      guidanceNotes: entity.guidance_notes ?? null,
      source: "tenant",
      sections:
        entityFacets.length > 0
          ? entityFacets.map(toTenantSectionTemplate)
          : (SEED_ONTOLOGY_TEMPLATES[entity.slug]?.sections ?? []),
    };
  }
  return templates;
}

export async function resolveOntologyTemplate(args: {
  tenantId: string;
  entityTypeSlug: string;
  db?: DbLike;
}): Promise<OntologyEntityPageTemplate | null> {
  const templates = await resolveOntologyTemplates({
    tenantId: args.tenantId,
    db: args.db,
  });
  return templates[args.entityTypeSlug] ?? null;
}

export function describeOntologyTemplate(
  template: OntologyEntityPageTemplate,
): string {
  const sections = template.sections
    .filter((section) => section.lifecycleStatus === "approved")
    .sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug))
    .map(
      (section) =>
        `${section.slug} (${section.heading}, facet=${section.facetType}, sources=${section.sourcePriority.join("|") || "any"})`,
    )
    .join(", ");
  return `${template.entityTypeSlug}: ${template.entityTypeName}. Sections: ${sections}.`;
}

export function describeOntologyTemplatesForPrompt(
  templates: Record<string, OntologyEntityPageTemplate>,
): string {
  return Object.values(templates).map(describeOntologyTemplate).join("\n");
}

function seedSection(
  slug: string,
  heading: string,
  facetType: FacetType,
  position: number,
  sourcePriority: BrainSectionSourceKind[] = DEFAULT_SOURCE_PRIORITY,
): OntologyFacetSectionTemplate {
  return {
    slug,
    heading,
    facetType,
    position,
    sourcePriority,
    prompt: null,
    guidanceNotes: null,
    lifecycleStatus: "approved",
    source: "seed",
  };
}

function toTenantSectionTemplate(row: any): OntologyFacetSectionTemplate {
  return {
    slug: row.slug,
    heading: row.heading,
    facetType: normalizeFacetType(row.facet_type),
    position: Number.isFinite(row.position) ? Number(row.position) : 0,
    sourcePriority: normalizeSourcePriority(row.source_priority),
    prompt: row.prompt ?? null,
    guidanceNotes: row.guidance_notes ?? null,
    lifecycleStatus:
      row.lifecycle_status === "deprecated" ? "deprecated" : "approved",
    source: "tenant",
  };
}

function normalizeFacetType(value: unknown): FacetType {
  return typeof value === "string" &&
    (FACET_TYPES as readonly string[]).includes(value)
    ? (value as FacetType)
    : "compiled";
}

function normalizeSourcePriority(value: unknown): BrainSectionSourceKind[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is BrainSectionSourceKind => typeof item === "string",
  );
}
