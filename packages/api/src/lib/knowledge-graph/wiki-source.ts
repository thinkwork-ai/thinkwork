import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  wikiPageAliases,
  wikiPageLinks,
  wikiPages,
  wikiPageSections,
  wikiSectionSources,
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
} from "./source-adapters.js";

const DEFAULT_SOURCE_LIMIT = 20;

export async function loadWikiKnowledgeGraphSource(args: {
  db: Database;
  tenantId: string;
  ownerUserId: string;
  sourceRef: string;
  sourceLabel: string;
  pageIds?: string[] | null;
  ontology: KnowledgeGraphOntologyExport;
  limit?: number | null;
}): Promise<KnowledgeGraphSourceBundle> {
  const requestedPageIds = [...new Set(args.pageIds ?? [])].filter(Boolean);
  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_SOURCE_LIMIT, 50));
  const pages = await args.db
    .select({
      id: wikiPages.id,
      type: wikiPages.type,
      entitySubtype: wikiPages.entity_subtype,
      slug: wikiPages.slug,
      title: wikiPages.title,
      summary: wikiPages.summary,
      bodyMd: wikiPages.body_md,
      updatedAt: wikiPages.updated_at,
    })
    .from(wikiPages)
    .where(
      and(
        eq(wikiPages.tenant_id, args.tenantId),
        eq(wikiPages.owner_id, args.ownerUserId),
        eq(wikiPages.status, "active"),
        requestedPageIds.length
          ? inArray(wikiPages.id, requestedPageIds)
          : sql`true`,
      ),
    )
    .orderBy(desc(wikiPages.updated_at))
    .limit(limit);

  if (pages.length === 0) {
    return emptyBundle("wiki", args.sourceRef, args.sourceLabel, {
      requestedPageIds,
    });
  }

  const pageIds = pages.map((page) => page.id);
  const [aliases, sections, links, sources] = await Promise.all([
    args.db
      .select({
        pageId: wikiPageAliases.page_id,
        alias: wikiPageAliases.alias,
      })
      .from(wikiPageAliases)
      .where(inArray(wikiPageAliases.page_id, pageIds)),
    args.db
      .select({
        id: wikiPageSections.id,
        pageId: wikiPageSections.page_id,
        slug: wikiPageSections.section_slug,
        heading: wikiPageSections.heading,
        bodyMd: wikiPageSections.body_md,
        position: wikiPageSections.position,
        lastSourceAt: wikiPageSections.last_source_at,
      })
      .from(wikiPageSections)
      .where(inArray(wikiPageSections.page_id, pageIds))
      .orderBy(wikiPageSections.position),
    args.db
      .select({
        fromPageId: wikiPageLinks.from_page_id,
        toPageId: wikiPageLinks.to_page_id,
        kind: wikiPageLinks.kind,
        context: wikiPageLinks.context,
      })
      .from(wikiPageLinks)
      .where(inArray(wikiPageLinks.from_page_id, pageIds)),
    args.db
      .select({
        sectionId: wikiSectionSources.section_id,
        sourceKind: wikiSectionSources.source_kind,
        sourceRef: wikiSectionSources.source_ref,
      })
      .from(wikiSectionSources)
      .innerJoin(
        wikiPageSections,
        eq(wikiSectionSources.section_id, wikiPageSections.id),
      )
      .where(inArray(wikiPageSections.page_id, pageIds)),
  ]);

  const approvedTypes = new Set(
    args.ontology.entityTypes.map((type) => normalizeOntologySlug(type.slug)),
  );
  const aliasesByPage = groupBy(aliases, (row) => row.pageId);
  const sectionsByPage = groupBy(sections, (row) => row.pageId);
  const sourcesBySection = groupBy(sources, (row) => row.sectionId);
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const packets: KnowledgeGraphSourcePacket[] = [];
  const evidence: KnowledgeGraphSourceBundle["evidence"] = [];
  let ordinal = 0;

  for (const page of pages) {
    const entityTypeSlug = page.entitySubtype ?? null;
    const trustedOntologyType = entityTypeSlug
      ? approvedTypes.has(normalizeOntologySlug(entityTypeSlug))
      : false;
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
      entityTypeSlug,
      trustedOntologyType,
      text: packetText,
      metadata: { pageId: page.id, type: page.type, slug: page.slug },
    });
    evidence.push({
      id: page.id,
      role: "source",
      senderType: "wiki",
      senderId: args.ownerUserId,
      speakerLabel: `Wiki page: ${page.title}`,
      text: [page.title, page.summary, page.bodyMd].filter(Boolean).join("\n"),
      createdAt: dateish(page.updatedAt),
      ordinal: ordinal++,
      evidenceSourceKind: "wiki_page",
      evidenceSourceRef: page.id,
      evidenceMetadata: { pageId: page.id, slug: page.slug, title: page.title },
    });
    for (const section of pageSections) {
      evidence.push({
        id: section.id,
        role: "source",
        senderType: "wiki",
        senderId: args.ownerUserId,
        speakerLabel: `Wiki section: ${page.title} / ${section.heading}`,
        text: section.bodyMd,
        createdAt: dateish(section.lastSourceAt ?? page.updatedAt),
        ordinal: ordinal++,
        evidenceSourceKind: "wiki_section",
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

  return {
    sourceKind: "wiki",
    sourceRef: args.sourceRef,
    sourceLabel: args.sourceLabel,
    document: renderPacketDocument({
      heading: args.sourceLabel,
      packets,
    }),
    evidence,
    packetCount: packets.length,
    skippedCount: Math.max(0, requestedPageIds.length - packets.length),
    diagnostics: {
      requestedPageIds,
      renderedPageIds: pageIds,
      untrustedPacketCount: packets.filter(
        (packet) => !packet.trustedOntologyType,
      ).length,
    },
  };
}

function emptyBundle(
  sourceKind: "wiki",
  sourceRef: string,
  sourceLabel: string,
  diagnostics: Record<string, unknown>,
): KnowledgeGraphSourceBundle {
  return {
    sourceKind,
    sourceRef,
    sourceLabel,
    document: "",
    evidence: [],
    packetCount: 0,
    skippedCount: 0,
    diagnostics,
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

function dateish(value: Date | string | null | undefined): Date {
  if (value instanceof Date) return value;
  return value ? new Date(value) : new Date();
}
