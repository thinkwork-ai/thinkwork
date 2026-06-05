import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  tenantEntityPageAliases,
  tenantEntityPageLinks,
  tenantEntityPages,
  tenantEntityPageSections,
  tenantEntitySectionSources,
} from "@thinkwork/database-pg/schema";
import type { Database } from "../db.js";
import {
  normalizeOntologySlug,
  type KnowledgeGraphOntologyExport,
} from "./ontology-export.js";
import {
  renderPacketDocument,
  type KnowledgeGraphSourceBundle,
  type KnowledgeGraphSourcePacket,
  type KnowledgeGraphSourceRelationshipPacket,
} from "./source-adapters.js";

const DEFAULT_SOURCE_LIMIT = 20;
const MAX_SOURCE_PACKETS = 50;

export async function loadBrainKnowledgeGraphSource(args: {
  db: Database;
  tenantId: string;
  sourceRef: string;
  sourceLabel: string;
  pageIds?: string[] | null;
  ontology: KnowledgeGraphOntologyExport;
  limit?: number | null;
}): Promise<KnowledgeGraphSourceBundle> {
  const requestedPageIds = [...new Set(args.pageIds ?? [])].filter(Boolean);
  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_SOURCE_LIMIT, 50));
  const initialPages = await args.db
    .select({
      id: tenantEntityPages.id,
      type: tenantEntityPages.type,
      entitySubtype: tenantEntityPages.entity_subtype,
      slug: tenantEntityPages.slug,
      title: tenantEntityPages.title,
      summary: tenantEntityPages.summary,
      bodyMd: tenantEntityPages.body_md,
      updatedAt: tenantEntityPages.updated_at,
    })
    .from(tenantEntityPages)
    .where(
      and(
        eq(tenantEntityPages.tenant_id, args.tenantId),
        eq(tenantEntityPages.status, "active"),
        requestedPageIds.length
          ? inArray(tenantEntityPages.id, requestedPageIds)
          : sql`true`,
      ),
    )
    .orderBy(desc(tenantEntityPages.updated_at))
    .limit(limit);

  if (initialPages.length === 0) {
    return {
      sourceKind: "brain",
      sourceRef: args.sourceRef,
      sourceLabel: args.sourceLabel,
      document: "",
      evidence: [],
      packets: [],
      relationships: [],
      packetCount: 0,
      skippedCount: 0,
      diagnostics: { requestedPageIds },
    };
  }

  const initialPageIds = initialPages.map((page) => page.id);
  const initialLinks = await args.db
    .select({
      fromPageId: tenantEntityPageLinks.from_page_id,
      toPageId: tenantEntityPageLinks.to_page_id,
      kind: tenantEntityPageLinks.kind,
      context: tenantEntityPageLinks.context,
    })
    .from(tenantEntityPageLinks)
    .where(inArray(tenantEntityPageLinks.from_page_id, initialPageIds));
  const initialPageIdSet = new Set(initialPageIds);
  const linkedTargetPageIds = [
    ...new Set(
      initialLinks
        .map((link) => link.toPageId)
        .filter((pageId) => !initialPageIdSet.has(pageId)),
    ),
  ].slice(0, Math.max(0, MAX_SOURCE_PACKETS - initialPages.length));
  const linkedTargetPages = linkedTargetPageIds.length
    ? await args.db
        .select({
          id: tenantEntityPages.id,
          type: tenantEntityPages.type,
          entitySubtype: tenantEntityPages.entity_subtype,
          slug: tenantEntityPages.slug,
          title: tenantEntityPages.title,
          summary: tenantEntityPages.summary,
          bodyMd: tenantEntityPages.body_md,
          updatedAt: tenantEntityPages.updated_at,
        })
        .from(tenantEntityPages)
        .where(
          and(
            eq(tenantEntityPages.tenant_id, args.tenantId),
            eq(tenantEntityPages.status, "active"),
            inArray(tenantEntityPages.id, linkedTargetPageIds),
          ),
        )
        .orderBy(desc(tenantEntityPages.updated_at))
        .limit(Math.max(1, MAX_SOURCE_PACKETS - initialPages.length))
    : [];
  const pages = [...initialPages, ...linkedTargetPages];
  const pageIds = pages.map((page) => page.id);
  const [aliases, sections, links, sources] = await Promise.all([
    args.db
      .select({
        pageId: tenantEntityPageAliases.page_id,
        alias: tenantEntityPageAliases.alias,
      })
      .from(tenantEntityPageAliases)
      .where(inArray(tenantEntityPageAliases.page_id, pageIds)),
    args.db
      .select({
        id: tenantEntityPageSections.id,
        pageId: tenantEntityPageSections.page_id,
        slug: tenantEntityPageSections.section_slug,
        heading: tenantEntityPageSections.heading,
        bodyMd: tenantEntityPageSections.body_md,
        position: tenantEntityPageSections.position,
        lastSourceAt: tenantEntityPageSections.last_source_at,
        aggregation: tenantEntityPageSections.aggregation,
      })
      .from(tenantEntityPageSections)
      .where(
        and(
          inArray(tenantEntityPageSections.page_id, pageIds),
          eq(tenantEntityPageSections.status, "active"),
        ),
      )
      .orderBy(tenantEntityPageSections.position),
    args.db
      .select({
        fromPageId: tenantEntityPageLinks.from_page_id,
        toPageId: tenantEntityPageLinks.to_page_id,
        kind: tenantEntityPageLinks.kind,
        context: tenantEntityPageLinks.context,
      })
      .from(tenantEntityPageLinks)
      .where(inArray(tenantEntityPageLinks.from_page_id, pageIds)),
    args.db
      .select({
        sectionId: tenantEntitySectionSources.section_id,
        sourceKind: tenantEntitySectionSources.source_kind,
        sourceRef: tenantEntitySectionSources.source_ref,
      })
      .from(tenantEntitySectionSources)
      .innerJoin(
        tenantEntityPageSections,
        eq(tenantEntitySectionSources.section_id, tenantEntityPageSections.id),
      )
      .where(inArray(tenantEntityPageSections.page_id, pageIds)),
  ]);

  const approvedTypes = new Set(
    args.ontology.entityTypes.map((type) => normalizeOntologySlug(type.slug)),
  );
  const approvedRelationships = new Set(
    args.ontology.relationshipTypes.map((type) =>
      normalizeOntologySlug(type.slug),
    ),
  );
  const aliasesByPage = groupBy(aliases, (row) => row.pageId);
  const sectionsByPage = groupBy(sections, (row) => row.pageId);
  const sourcesBySection = groupBy(sources, (row) => row.sectionId);
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const packets: KnowledgeGraphSourcePacket[] = [];
  const relationships: KnowledgeGraphSourceRelationshipPacket[] = [];
  const evidence: KnowledgeGraphSourceBundle["evidence"] = [];
  let ordinal = 0;

  for (const page of pages) {
    const trustedOntologyType = approvedTypes.has(
      normalizeOntologySlug(page.entitySubtype),
    );
    const pageAliases =
      aliasesByPage.get(page.id)?.map((row) => row.alias) ?? [];
    const pageSections = sectionsByPage.get(page.id) ?? [];
    const outgoingLinks = links.filter((link) => link.fromPageId === page.id);
    const packetText = [
      `title: ${page.title}`,
      `page_type: ${page.type}`,
      `slug: ${page.slug}`,
      pageAliases.length ? `aliases: ${pageAliases.join(", ")}` : null,
      page.summary ? `summary: ${page.summary}` : null,
      page.bodyMd ? `body:\n${page.bodyMd}` : null,
      ...pageSections.map((section) =>
        [
          `section:${section.slug}`,
          `heading: ${section.heading}`,
          aggregationLine(section.aggregation),
          sourceLines(sourcesBySection.get(section.id)),
          section.bodyMd,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
      ...outgoingLinks.map((link) => {
        const target = pagesById.get(link.toPageId);
        return target
          ? `relationship_hint: ${page.title} ${link.kind} ${target.title}${
              link.context ? ` (${link.context})` : ""
            }`
          : null;
      }),
    ]
      .filter(Boolean)
      .join("\n\n");

    packets.push({
      id: page.id,
      title: page.title,
      entityTypeSlug: page.entitySubtype,
      trustedOntologyType,
      text: packetText,
      metadata: {
        pageId: page.id,
        type: page.type,
        slug: page.slug,
        summary: page.summary,
        aliases: pageAliases,
      },
    });
    evidence.push({
      id: page.id,
      role: "source",
      senderType: "brain",
      senderId: null,
      speakerLabel: `Brain page: ${page.title}`,
      text: [page.title, page.summary, page.bodyMd].filter(Boolean).join("\n"),
      createdAt: dateish(page.updatedAt),
      ordinal: ordinal++,
      evidenceSourceKind: "brain_page",
      evidenceSourceRef: page.id,
      evidenceMetadata: { pageId: page.id, slug: page.slug, title: page.title },
    });
    for (const section of pageSections) {
      evidence.push({
        id: section.id,
        role: "source",
        senderType: "brain",
        senderId: null,
        speakerLabel: `Brain section: ${page.title} / ${section.heading}`,
        text: section.bodyMd,
        createdAt: dateish(section.lastSourceAt ?? page.updatedAt),
        ordinal: ordinal++,
        evidenceSourceKind: "brain_section",
        evidenceSourceRef: section.id,
        evidenceMetadata: {
          pageId: page.id,
          sectionId: section.id,
          sectionSlug: section.slug,
          heading: section.heading,
          title: page.title,
        },
      });
    }
  }

  for (const link of links) {
    const target = pagesById.get(link.toPageId);
    const relationshipTypeSlug = link.kind ?? null;
    relationships.push({
      id: `${link.fromPageId}:${link.kind}:${link.toPageId}`,
      fromPacketId: link.fromPageId,
      toPacketId: link.toPageId,
      relationshipTypeSlug,
      trustedOntologyType: relationshipTypeSlug
        ? approvedRelationships.has(normalizeOntologySlug(relationshipTypeSlug))
        : false,
      label: relationshipTypeSlug ?? "related",
      context: link.context ?? null,
      metadata: {
        fromPageId: link.fromPageId,
        toPageId: link.toPageId,
        targetTitle: target?.title ?? null,
      },
    });
  }

  return {
    sourceKind: "brain",
    sourceRef: args.sourceRef,
    sourceLabel: args.sourceLabel,
    document: renderPacketDocument({
      heading: args.sourceLabel,
      packets,
    }),
    evidence,
    packets,
    relationships,
    packetCount: packets.length,
    skippedCount: Math.max(0, requestedPageIds.length - packets.length),
    diagnostics: {
      requestedPageIds,
      renderedPageIds: pageIds,
      untrustedPacketCount: packets.filter(
        (packet) => !packet.trustedOntologyType,
      ).length,
      expandedLinkedPageCount: linkedTargetPages.length,
      expandedLinkedPageIds: linkedTargetPages.map((page) => page.id),
    },
  };
}

function groupBy<T, K>(rows: T[], keyFn: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function sourceLines(
  sources: Array<{ sourceKind: string; sourceRef: string }> | undefined,
): string | null {
  return sources?.length
    ? `citations: ${sources
        .map((source) => `${source.sourceKind}:${source.sourceRef}`)
        .join(", ")}`
    : null;
}

function aggregationLine(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const facetType =
    typeof record.facet_type === "string"
      ? record.facet_type
      : typeof record.facetType === "string"
        ? record.facetType
        : null;
  return facetType ? `facet_type: ${facetType}` : null;
}

function dateish(value: Date | string | null | undefined): Date {
  if (value instanceof Date) return value;
  return value ? new Date(value) : new Date();
}
