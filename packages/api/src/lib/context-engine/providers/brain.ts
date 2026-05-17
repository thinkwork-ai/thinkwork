import { sql } from "drizzle-orm";
import { db as defaultDb } from "../../db.js";
import {
  normalizeFacetType,
  TRUST_RANK,
  type FacetType,
} from "../../brain/facet-types.js";
import type {
  ContextHit,
  ContextProviderDescriptor,
  ContextProviderResult,
} from "../types.js";

const BRAIN_LIMIT = 20;
const BRAIN_TIMEOUT_MS = Number(
  process.env.CONTEXT_ENGINE_BRAIN_TIMEOUT_MS || 2_500,
);

type BrainContextSearch = (args: {
  tenantId: string;
  query: string;
  limit: number;
}) => Promise<BrainContextRow[]>;

type BrainPageFallbackSearch = (args: {
  tenantId: string;
  query: string;
  limit: number;
}) => Promise<BrainPageFallbackRow[]>;

export interface BrainContextProviderOptions {
  defaultEnabled?: boolean;
  timeoutMs?: number;
  search?: BrainContextSearch;
  fallbackSearch?: BrainPageFallbackSearch;
}

export interface BrainContextRow {
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  pageSummary: string | null;
  pageBodyMd: string | null;
  entitySubtype: string;
  sectionId: string | null;
  sectionSlug: string | null;
  sectionHeading: string | null;
  sectionBodyMd: string | null;
  sectionPosition: number | null;
  facetType: string | null;
  sourceFacetType: string | null;
  entityTypeId: string | null;
  entityTypeSlug: string | null;
  entityTypeName: string | null;
  entityTypeDescription: string | null;
  entityTemplateSource: "tenant" | "seed";
  facetTemplateId: string | null;
  facetTemplateSource: "tenant" | "seed";
  ontologyVersionId: string | null;
  ontologyVersionNumber: number | null;
  sourceReferences: unknown;
  relationshipReferences: unknown;
  freshnessAsOf: Date | string | null;
  ttlSeconds: number | null;
  score: number | string | null;
}

export interface BrainPageFallbackRow {
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  pageSummary: string | null;
  pageBodyMd: string | null;
  entitySubtype: string;
  score: number | string | null;
}

export function createBrainContextProvider(
  options: BrainContextProviderOptions = {},
): ContextProviderDescriptor {
  const timeoutMs = options.timeoutMs ?? BRAIN_TIMEOUT_MS;
  const search = options.search ?? searchOntologyBrainContext;
  const fallbackSearch = options.fallbackSearch ?? searchBrainPages;
  return {
    id: "brain",
    family: "brain",
    sourceFamily: "brain",
    displayName: "Ontology Brain",
    defaultEnabled: options.defaultEnabled ?? true,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 2_500,
    supportedScopes: ["team", "auto"],
    config: {
      ontologyAware: true,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 2_500,
    },
    async query(request): Promise<ContextProviderResult> {
      if (!request.caller.tenantId) {
        return {
          hits: [],
          status: {
            state: "skipped",
            reason: "tenant scope is required for ontology Brain search",
          },
        };
      }

      const limit = Math.min(request.limit, BRAIN_LIMIT);
      try {
        const rows = await search({
          tenantId: request.caller.tenantId,
          query: request.query,
          limit,
        });
        return {
          hits: rows.map((row) => brainRowToHit(row, request.scope)),
          status: {
            metadata: {
              ontologyAware: true,
              degraded: false,
            },
          },
        };
      } catch (err) {
        const fallbackRows = await fallbackSearch({
          tenantId: request.caller.tenantId,
          query: request.query,
          limit,
        }).catch(() => []);
        if (fallbackRows.length === 0) {
          return {
            hits: [],
            status: {
              state: "error",
              error: err instanceof Error ? err.message : String(err),
              metadata: {
                ontologyAware: true,
                degraded: true,
              },
            },
          };
        }

        return {
          hits: fallbackRows.map((row) =>
            brainFallbackRowToHit(row, request.scope),
          ),
          status: {
            state: "stale",
            reason: `ontology metadata lookup failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
            metadata: {
              ontologyAware: false,
              degraded: true,
            },
          },
        };
      }
    },
  };
}

export async function searchOntologyBrainContext(args: {
  tenantId: string;
  query: string;
  limit: number;
}): Promise<BrainContextRow[]> {
  const likeQuery = `%${escapeLikePattern(args.query)}%`;
  const result = await defaultDb.execute(sql`
    WITH source_refs AS (
      SELECT
        ss.section_id,
        jsonb_agg(
          DISTINCT jsonb_strip_nulls(
            jsonb_build_object(
              'kind', ss.source_kind,
              'ref', ss.source_ref,
              'asOf', er.as_of,
              'ttlSeconds', er.ttl_seconds
            )
          )
        ) FILTER (WHERE ss.source_ref IS NOT NULL) AS "sourceReferences",
        max(er.as_of) AS "freshnessAsOf",
        max(er.ttl_seconds) AS "ttlSeconds"
      FROM brain.section_sources ss
      LEFT JOIN brain.external_refs er
        ON er.tenant_id = ss.tenant_id
       AND er.source_kind = ss.source_kind
       AND er.external_id = ss.source_ref
      WHERE ss.tenant_id = ${args.tenantId}
      GROUP BY ss.section_id
    ),
    relationship_refs AS (
      SELECT
        pl.from_page_id AS page_id,
        jsonb_agg(
          DISTINCT jsonb_strip_nulls(
            jsonb_build_object(
              'kind', pl.kind,
              'label', coalesce(rt.name, pl.kind),
              'inverseLabel', rt.inverse_name,
              'targetPageId', target.id,
              'targetTitle', target.title,
              'targetSubtype', target.entity_subtype,
              'targetSlug', target.slug
            )
          )
        ) AS "relationshipReferences"
      FROM brain.page_links pl
      INNER JOIN brain.pages target ON target.id = pl.to_page_id
      LEFT JOIN ontology.relationship_types rt
        ON rt.tenant_id = target.tenant_id
       AND rt.slug = pl.kind
       AND rt.lifecycle_status = 'approved'
      WHERE target.tenant_id = ${args.tenantId}
        AND target.status = 'active'
      GROUP BY pl.from_page_id
    ),
    active_version AS (
      SELECT id, version_number
      FROM ontology.versions
      WHERE tenant_id = ${args.tenantId}
        AND status = 'active'
      ORDER BY version_number DESC
      LIMIT 1
    )
    SELECT
      p.id AS "pageId",
      p.title AS "pageTitle",
      p.slug AS "pageSlug",
      p.summary AS "pageSummary",
      p.body_md AS "pageBodyMd",
      p.entity_subtype AS "entitySubtype",
      s.id AS "sectionId",
      s.section_slug AS "sectionSlug",
      s.heading AS "sectionHeading",
      s.body_md AS "sectionBodyMd",
      s.position AS "sectionPosition",
      coalesce(
        s.aggregation->>'facet_type',
        ft.facet_type,
        'compiled'
      ) AS "facetType",
      coalesce(
        s.aggregation->>'source_facet_type',
        s.aggregation->>'facet_type',
        ft.facet_type,
        'compiled'
      ) AS "sourceFacetType",
      et.id AS "entityTypeId",
      coalesce(et.slug, p.entity_subtype) AS "entityTypeSlug",
      coalesce(et.name, initcap(replace(p.entity_subtype, '_', ' '))) AS "entityTypeName",
      et.description AS "entityTypeDescription",
      CASE WHEN et.id IS NULL THEN 'seed' ELSE 'tenant' END AS "entityTemplateSource",
      ft.id AS "facetTemplateId",
      CASE WHEN ft.id IS NULL THEN 'seed' ELSE 'tenant' END AS "facetTemplateSource",
      coalesce(et.version_id, av.id) AS "ontologyVersionId",
      av.version_number AS "ontologyVersionNumber",
      coalesce(sr."sourceReferences", '[]'::jsonb) AS "sourceReferences",
      coalesce(rr."relationshipReferences", '[]'::jsonb) AS "relationshipReferences",
      sr."freshnessAsOf",
      sr."ttlSeconds",
      (
        coalesce(
          ts_rank_cd(p.search_tsv, plainto_tsquery('english', ${args.query})),
          0
        )
        + CASE coalesce(s.aggregation->>'facet_type', ft.facet_type, 'compiled')
            WHEN 'operational' THEN 0.50
            WHEN 'relationship' THEN 0.42
            WHEN 'compiled' THEN 0.34
            WHEN 'activity' THEN 0.28
            WHEN 'kb_sourced' THEN 0.24
            ELSE 0.12
          END
      ) AS score
    FROM brain.pages p
    LEFT JOIN brain.page_sections s
      ON s.page_id = p.id
     AND s.status = 'active'
    LEFT JOIN ontology.entity_types et
      ON et.tenant_id = p.tenant_id
     AND et.slug = p.entity_subtype
     AND et.lifecycle_status = 'approved'
    LEFT JOIN active_version av ON true
    LEFT JOIN ontology.facet_templates ft
      ON ft.entity_type_id = et.id
     AND ft.slug = s.section_slug
     AND ft.lifecycle_status = 'approved'
    LEFT JOIN source_refs sr ON sr.section_id = s.id
    LEFT JOIN relationship_refs rr ON rr.page_id = p.id
    WHERE p.tenant_id = ${args.tenantId}
      AND p.status = 'active'
      AND (
        p.search_tsv @@ plainto_tsquery('english', ${args.query})
        OR p.title ILIKE ${likeQuery} ESCAPE '\\'
        OR coalesce(p.summary, '') ILIKE ${likeQuery} ESCAPE '\\'
        OR coalesce(p.body_md, '') ILIKE ${likeQuery} ESCAPE '\\'
        OR coalesce(s.heading, '') ILIKE ${likeQuery} ESCAPE '\\'
        OR coalesce(s.body_md, '') ILIKE ${likeQuery} ESCAPE '\\'
        OR EXISTS (
          SELECT 1
          FROM brain.page_aliases a
          WHERE a.page_id = p.id
            AND a.alias ILIKE ${likeQuery} ESCAPE '\\'
        )
      )
    ORDER BY score DESC, p.title ASC, s.position ASC NULLS LAST
    LIMIT ${args.limit}
  `);
  return rowsFromResult<BrainContextRow>(result);
}

export async function searchBrainPages(args: {
  tenantId: string;
  query: string;
  limit: number;
}): Promise<BrainPageFallbackRow[]> {
  const likeQuery = `%${escapeLikePattern(args.query)}%`;
  const result = await defaultDb.execute(sql`
    SELECT
      p.id AS "pageId",
      p.title AS "pageTitle",
      p.slug AS "pageSlug",
      p.summary AS "pageSummary",
      p.body_md AS "pageBodyMd",
      p.entity_subtype AS "entitySubtype",
      coalesce(
        ts_rank_cd(p.search_tsv, plainto_tsquery('english', ${args.query})),
        0
      ) AS score
    FROM brain.pages p
    WHERE p.tenant_id = ${args.tenantId}
      AND p.status = 'active'
      AND (
        p.search_tsv @@ plainto_tsquery('english', ${args.query})
        OR p.title ILIKE ${likeQuery} ESCAPE '\\'
        OR coalesce(p.summary, '') ILIKE ${likeQuery} ESCAPE '\\'
        OR coalesce(p.body_md, '') ILIKE ${likeQuery} ESCAPE '\\'
      )
    ORDER BY score DESC, p.title ASC
    LIMIT ${args.limit}
  `);
  return rowsFromResult<BrainPageFallbackRow>(result);
}

function brainRowToHit(
  row: BrainContextRow,
  scope: ContextHit["scope"],
): ContextHit {
  const facetType = normalizeFacetType(row.facetType);
  const sourceFacetType = normalizeFacetType(row.sourceFacetType, facetType);
  const sourceReferences = normalizeJsonArray(row.sourceReferences);
  const relationshipReferences = normalizeJsonArray(row.relationshipReferences);
  const sectionSlug = row.sectionSlug ?? "overview";
  const sectionHeading = row.sectionHeading ?? row.pageTitle;
  const ontologyVersion =
    row.ontologyVersionId || row.ontologyVersionNumber
      ? {
          id: row.ontologyVersionId,
          versionNumber: row.ontologyVersionNumber,
        }
      : null;

  return {
    id: row.sectionId
      ? `brain:${row.pageId}:facet:${row.sectionId}`
      : `brain:${row.pageId}`,
    providerId: "brain",
    family: "brain",
    sourceFamily: "brain",
    title: row.sectionId
      ? `${row.pageTitle} - ${sectionHeading}`
      : row.pageTitle,
    snippet: summarizeSnippet(
      row.sectionBodyMd ?? row.pageSummary ?? row.pageBodyMd ?? row.pageTitle,
    ),
    score: normalizedScore(row.score, facetType),
    scope,
    provenance: {
      label: row.sectionId ? `Brain ${sectionHeading}` : "Brain page",
      sourceId: row.sectionId ?? row.pageId,
      uri: `thinkwork://brain/${row.entitySubtype}/${row.pageSlug}${
        row.sectionId ? `#${sectionSlug}` : ""
      }`,
      metadata: {
        entityType: row.entityTypeSlug ?? row.entitySubtype,
        relationshipLabels: relationshipReferences
          .map((ref) => stringValue(ref, "label"))
          .filter(Boolean),
        facetSlug: sectionSlug,
        facetType,
        sourceTrustTier: sourceFacetType,
        ontologyVersionId: row.ontologyVersionId,
        sourceReferences,
      },
    },
    metadata: {
      ontology: {
        entityType: {
          id: row.entityTypeId,
          slug: row.entityTypeSlug ?? row.entitySubtype,
          label: row.entityTypeName ?? row.entitySubtype,
          description: row.entityTypeDescription,
          templateSource: row.entityTemplateSource,
        },
        facet: row.sectionId
          ? {
              id: row.facetTemplateId,
              slug: sectionSlug,
              heading: sectionHeading,
              type: facetType,
              sourceTrustTier: sourceFacetType,
              templateSource: row.facetTemplateSource,
              trustRank: TRUST_RANK[sourceFacetType],
              position: row.sectionPosition ?? 0,
            }
          : null,
        version: ontologyVersion,
        relationships: relationshipReferences,
      },
      page: {
        id: row.pageId,
        slug: row.pageSlug,
        title: row.pageTitle,
        entitySubtype: row.entitySubtype,
      },
      sources: sourceReferences,
    },
    freshness: freshnessForRow(row),
  };
}

function brainFallbackRowToHit(
  row: BrainPageFallbackRow,
  scope: ContextHit["scope"],
): ContextHit {
  return {
    id: `brain:${row.pageId}`,
    providerId: "brain",
    family: "brain",
    sourceFamily: "brain",
    title: row.pageTitle,
    snippet: summarizeSnippet(
      row.pageSummary ?? row.pageBodyMd ?? `Brain page for ${row.pageTitle}`,
    ),
    score: Number(row.score ?? 0.2),
    scope,
    provenance: {
      label: "Brain page",
      sourceId: row.pageId,
      uri: `thinkwork://brain/${row.entitySubtype}/${row.pageSlug}`,
      metadata: {
        entityType: row.entitySubtype,
        degraded: true,
      },
    },
    metadata: {
      ontology: null,
      page: {
        id: row.pageId,
        slug: row.pageSlug,
        title: row.pageTitle,
        entitySubtype: row.entitySubtype,
      },
      degraded: true,
    },
  };
}

function freshnessForRow(
  row: Pick<BrainContextRow, "freshnessAsOf" | "ttlSeconds">,
): ContextHit["freshness"] {
  if (!row.freshnessAsOf || !row.ttlSeconds) return undefined;
  const asOf =
    row.freshnessAsOf instanceof Date
      ? row.freshnessAsOf.toISOString()
      : String(row.freshnessAsOf);
  return {
    asOf,
    ttlSeconds: Number(row.ttlSeconds),
  };
}

function normalizedScore(
  score: BrainContextRow["score"],
  facetType: FacetType,
) {
  const numeric = typeof score === "number" ? score : Number(score);
  if (Number.isFinite(numeric)) return numeric;
  return 0.2 + TRUST_RANK[facetType] / 10;
}

function normalizeJsonArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function stringValue(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const item = value[key];
  return typeof item === "string" && item.trim() ? item : null;
}

function summarizeSnippet(value: string): string {
  const stripped = value
    .replace(/#{1,6}\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length <= 900) return stripped;
  return `${stripped.slice(0, 897).trimEnd()}...`;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (isRecord(result) && Array.isArray(result.rows)) return result.rows as T[];
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
