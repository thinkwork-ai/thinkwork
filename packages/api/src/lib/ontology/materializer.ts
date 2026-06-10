import { and, asc, eq, inArray } from "drizzle-orm";
import {
  tenantEntityExternalRefs,
  tenantEntityPages,
  tenantEntityPageSections,
  tenantEntitySectionSources,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import {
  deriveSourceFacetType,
  isHigherTrustFacet,
  isKnownSectionSourceKind,
  normalizeFacetType,
  type FactCitation,
} from "../brain/facet-types.js";
import {
  composeTenantEntityPageBody,
  syncTenantEntityPageBodyFromSections,
  writeFacetSection,
} from "../brain/repository.js";
import {
  resolveOntologyTemplates,
  type OntologyEntityPageTemplate,
  type OntologyFacetSectionTemplate,
} from "./templates.js";

type DbLike = typeof defaultDb;

export interface OntologyMaterializationSummary {
  pagesScanned: number;
  pagesChanged: number;
  facetsAdded: number;
  facetsUpdated: number;
  sourcesRetained: number;
  skippedPages: number;
  skippedSections: number;
  errors: Array<{ pageId: string; message: string }>;
}

export interface MaterializerPage {
  id: string;
  tenant_id: string;
  entity_subtype: string;
  title: string;
  summary: string | null;
  body_md: string | null;
}

export interface MaterializerSection {
  id: string;
  section_slug: string;
  heading: string;
  body_md: string;
  position: number;
  aggregation: unknown;
  status: string;
}

export interface MaterializerExternalRef {
  id: string;
  source_kind: string;
  external_id: string | null;
  source_payload: unknown;
  as_of?: Date | string | null;
}

export interface MaterializedSectionDraft {
  template: OntologyFacetSectionTemplate;
  content: string;
  sources: FactCitation[];
  existingSection: MaterializerSection | null;
}

const EMPTY_SUMMARY: OntologyMaterializationSummary = {
  pagesScanned: 0,
  pagesChanged: 0,
  facetsAdded: 0,
  facetsUpdated: 0,
  sourcesRetained: 0,
  skippedPages: 0,
  skippedSections: 0,
  errors: [],
};

export async function materializeOntologyTemplatesForImpact(args: {
  tenantId: string;
  pageIds: string[];
  db?: DbLike;
}): Promise<OntologyMaterializationSummary> {
  const db = args.db ?? defaultDb;
  const pageIds = [...new Set(args.pageIds)].filter(Boolean);
  if (pageIds.length === 0) return { ...EMPTY_SUMMARY };

  const templates = await resolveOntologyTemplates({
    tenantId: args.tenantId,
    db,
  });
  const pages = await db
    .select()
    .from(tenantEntityPages)
    .where(
      and(
        eq(tenantEntityPages.tenant_id, args.tenantId),
        eq(tenantEntityPages.status, "active"),
        inArray(tenantEntityPages.id, pageIds),
      ),
    )
    .orderBy(asc(tenantEntityPages.title));
  const sourceKinds = sourceKindsForTemplates(templates);
  const externalRefs =
    sourceKinds.length > 0
      ? await db
          .select()
          .from(tenantEntityExternalRefs)
          .where(
            and(
              eq(tenantEntityExternalRefs.tenant_id, args.tenantId),
              inArray(tenantEntityExternalRefs.source_kind, sourceKinds),
            ),
          )
          .orderBy(asc(tenantEntityExternalRefs.updated_at))
      : [];

  const summary: OntologyMaterializationSummary = {
    ...EMPTY_SUMMARY,
    pagesScanned: pages.length,
  };
  for (const page of pages as MaterializerPage[]) {
    const template = templates[page.entity_subtype];
    if (!template) {
      summary.skippedPages += 1;
      continue;
    }
    try {
      const pageSummary = await materializeOntologyPage({
        tenantId: args.tenantId,
        page,
        template,
        externalRefs: externalRefs as MaterializerExternalRef[],
        db,
      });
      summary.pagesChanged += pageSummary.pagesChanged;
      summary.facetsAdded += pageSummary.facetsAdded;
      summary.facetsUpdated += pageSummary.facetsUpdated;
      summary.sourcesRetained += pageSummary.sourcesRetained;
      summary.skippedSections += pageSummary.skippedSections;
    } catch (err) {
      summary.errors.push({
        pageId: page.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

export async function materializeOntologyPage(args: {
  tenantId: string;
  page: MaterializerPage;
  template: OntologyEntityPageTemplate;
  externalRefs: MaterializerExternalRef[];
  db?: DbLike;
}): Promise<OntologyMaterializationSummary> {
  const db = args.db ?? defaultDb;
  const sections = (await db
    .select()
    .from(tenantEntityPageSections)
    .where(eq(tenantEntityPageSections.page_id, args.page.id))
    .orderBy(asc(tenantEntityPageSections.position))) as MaterializerSection[];
  const sectionIds = sections.map((section) => section.id);
  const sources =
    sectionIds.length > 0
      ? await db
          .select()
          .from(tenantEntitySectionSources)
          .where(inArray(tenantEntitySectionSources.section_id, sectionIds))
      : [];

  const sourceMap = new Map<string, FactCitation[]>();
  for (const source of sources as any[]) {
    if (!isKnownSectionSourceKind(source.source_kind)) continue;
    const citation: FactCitation = {
      kind: source.source_kind,
      ref: source.source_ref,
    };
    const list = sourceMap.get(source.section_id) ?? [];
    list.push(citation);
    sourceMap.set(source.section_id, list);
  }

  const pageExternalRefs = args.externalRefs.filter((ref) =>
    externalRefMatchesPage(ref, args.page),
  );

  const summary: OntologyMaterializationSummary = {
    ...EMPTY_SUMMARY,
    pagesScanned: 1,
  };
  let changed = false;
  const existingBySlug = new Map(
    sections.map((section) => [section.section_slug, section]),
  );
  for (const sectionTemplate of orderedTemplateSections(args.template)) {
    const existingSection = existingBySlug.get(sectionTemplate.slug) ?? null;
    const draft = buildMaterializedSectionDraft({
      page: args.page,
      template: sectionTemplate,
      existingSection,
      existingSources: existingSection
        ? (sourceMap.get(existingSection.id) ?? [])
        : [],
      externalRefs: pageExternalRefs,
    });
    if (!draft) {
      summary.skippedSections += 1;
      continue;
    }
    if (shouldPreserveExistingSection(existingSection, draft.sources)) {
      summary.skippedSections += 1;
      summary.sourcesRetained += draft.sources.length;
      continue;
    }

    await writeFacetSection(
      {
        tenantId: args.tenantId,
        pageId: args.page.id,
        facetType: sectionTemplate.facetType,
        sectionSlug: sectionTemplate.slug,
        heading: sectionTemplate.heading,
        content: draft.content,
        sources: draft.sources,
        position: sectionTemplate.position,
        allowPromotion: true,
      },
      db,
    );
    changed = true;
    summary.sourcesRetained += draft.sources.length;
    if (existingSection) summary.facetsUpdated += 1;
    else summary.facetsAdded += 1;
  }

  if (changed) {
    await syncTenantEntityPageBodyFromSections({ pageId: args.page.id, db });
    summary.pagesChanged = 1;
  }
  return summary;
}

export function buildMaterializedSectionDraft(args: {
  page: MaterializerPage;
  template: OntologyFacetSectionTemplate;
  existingSection: MaterializerSection | null;
  existingSources: FactCitation[];
  externalRefs: MaterializerExternalRef[];
}): MaterializedSectionDraft | null {
  const sources = dedupeSources([
    ...args.existingSources,
    ...externalRefsForTemplate(args.externalRefs, args.template),
  ]);
  if (sources.length === 0) return null;

  const content =
    args.existingSection?.body_md?.trim() ||
    buildSectionBodyFromExternalRefs({
      page: args.page,
      template: args.template,
      externalRefs: args.externalRefs,
    });
  if (!content.trim()) return null;
  return {
    template: args.template,
    content,
    sources,
    existingSection: args.existingSection,
  };
}

export function shouldPreserveExistingSection(
  existingSection: MaterializerSection | null,
  incomingSources: FactCitation[],
): boolean {
  if (!existingSection) return false;
  const aggregation = sectionAggregation(existingSection.aggregation);
  const existingSourceFacet = normalizeFacetType(
    aggregation.source_facet_type,
    normalizeFacetType(aggregation.facet_type),
  );
  const incomingSourceFacet = deriveSourceFacetType(incomingSources);
  return isHigherTrustFacet(existingSourceFacet, incomingSourceFacet);
}

export function composeMaterializedBody(
  sections: Array<{
    heading: string;
    body_md: string | null;
    position: number;
  }>,
): string {
  return composeTenantEntityPageBody(sections);
}

function orderedTemplateSections(template: OntologyEntityPageTemplate) {
  return template.sections
    .filter((section) => section.lifecycleStatus === "approved")
    .sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug));
}

function sourceKindsForTemplates(
  templates: Record<string, OntologyEntityPageTemplate>,
): string[] {
  return [
    ...new Set(
      Object.values(templates).flatMap((template) =>
        template.sections.flatMap((section) => section.sourcePriority),
      ),
    ),
  ];
}

function externalRefsForTemplate(
  refs: MaterializerExternalRef[],
  template: OntologyFacetSectionTemplate,
): FactCitation[] {
  const allowed = new Set(template.sourcePriority);
  return refs
    .filter(
      (ref) =>
        isKnownSectionSourceKind(ref.source_kind) &&
        (allowed.size === 0 || allowed.has(ref.source_kind)),
    )
    .map((ref) => ({
      kind: ref.source_kind as FactCitation["kind"],
      ref: ref.external_id || ref.id,
      asOf: ref.as_of ? new Date(ref.as_of).toISOString() : undefined,
      metadata: { ontologyFacetSlug: template.slug },
    }));
}

function buildSectionBodyFromExternalRefs(args: {
  page: MaterializerPage;
  template: OntologyFacetSectionTemplate;
  externalRefs: MaterializerExternalRef[];
}): string {
  const matching = args.externalRefs.filter((ref) => {
    const allowed = new Set(args.template.sourcePriority);
    return allowed.size === 0 || allowed.has(ref.source_kind as any);
  });
  const lines = matching
    .map((ref) => externalRefSummary(ref))
    .filter(Boolean)
    .slice(0, 8);
  if (lines.length === 0 && args.template.slug === "overview") {
    return args.page.summary ?? "";
  }
  return lines.map((line) => `- ${line}`).join("\n");
}

function externalRefSummary(ref: MaterializerExternalRef): string {
  const payload = objectValue(ref.source_payload);
  const title =
    stringValue(payload.title) ||
    stringValue(payload.subject) ||
    stringValue(payload.name) ||
    stringValue(payload.summary) ||
    stringValue(payload.description);
  const status = stringValue(payload.status) || stringValue(payload.stage);
  const due =
    stringValue(payload.dueDate) ||
    stringValue(payload.due_date) ||
    stringValue(payload.followUpAt);
  const owner = stringValue(payload.owner) || stringValue(payload.assignee);
  return [
    title,
    status && `status: ${status}`,
    due && `due: ${due}`,
    owner && `owner: ${owner}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function externalRefMatchesPage(
  ref: MaterializerExternalRef,
  page: MaterializerPage,
): boolean {
  const payload = objectValue(ref.source_payload);
  const candidates = [
    payload.pageId,
    payload.page_id,
    payload.entityPageId,
    payload.entity_page_id,
    payload.entitySlug,
    payload.entity_slug,
    payload.customerSlug,
    payload.customer_slug,
    payload.accountSlug,
    payload.account_slug,
    payload.customerName,
    payload.customer_name,
    payload.accountName,
    payload.account_name,
    payload.name,
  ]
    .map(stringValue)
    .filter(Boolean)
    .map(normalizeMatchValue);
  const pageKeys = [page.id, slugFromTitle(page.title), page.title]
    .map(normalizeMatchValue)
    .filter(Boolean);
  return candidates.some((candidate) => pageKeys.includes(candidate));
}

function sectionAggregation(value: unknown): {
  facet_type?: string | null;
  source_facet_type?: string | null;
} {
  const object = objectValue(value);
  return {
    facet_type: stringValue(object.facet_type),
    source_facet_type: stringValue(object.source_facet_type),
  };
}

function dedupeSources(sources: FactCitation[]): FactCitation[] {
  const seen = new Set<string>();
  const result: FactCitation[] = [];
  for (const source of sources) {
    const key = `${source.kind}:${source.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMatchValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugFromTitle(title: string): string {
  return normalizeMatchValue(title);
}
