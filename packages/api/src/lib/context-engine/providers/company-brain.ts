import { and, desc, eq, sql } from "drizzle-orm";
import {
  brainArtifactManifests,
  brainSubstrateStates,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb, type Database } from "../../db.js";
import type {
  ContextEngineProviderRequest,
  ContextHit,
  ContextProviderDescriptor,
  ContextProviderResult,
  ContextProviderStatus,
} from "../types.js";

const DEFAULT_BRAIN_LIMIT = 10;
const MAX_BRAIN_LIMIT = 20;
const REQUIRED_CAPABILITIES = ["retrieval", "provenance"] as const;
const BRAIN_SEARCH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "for",
  "from",
  "in",
  "is",
  "me",
  "my",
  "of",
  "on",
  "the",
  "to",
  "what",
  "whats",
  "what's",
  "with",
]);

type CapabilityStatus = "enabled" | "disabled" | "degraded" | "unknown";

interface BrainSubstrateState {
  id: string;
  tenant_id: string;
  storage_tier: string;
  active_backend: string;
  status: string;
  health_status: string;
  launch_capabilities: unknown;
  graph_provider: string | null;
  vector_provider: string | null;
  embedding_model: string | null;
  vector_dimension: number | null;
  cognee_version: string | null;
  latest_ingest_at: Date | string | null;
  latest_projection_at: Date | string | null;
  updated_at: Date | string;
}

interface BrainPageSearchRow {
  id: string;
  type: string;
  entity_subtype: string;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string | null;
  last_compiled_at: Date | string | null;
  updated_at: Date | string;
  score: number | string | null;
}

interface BrainArtifactManifestSummary {
  id: string;
  manifest_kind: string;
  storage_tier: string;
  source_family: string | null;
  source_kind: string | null;
  source_type: string | null;
  source_id_hash: string | null;
  object_count: number;
  source_count: number;
  checksum_sha256: string | null;
  status: string;
  metadata: unknown;
  updated_at: Date | string;
}

export interface CompanyBrainProviderOptions {
  db?: Database;
  defaultEnabled?: boolean;
  loadSubstrateState?: (
    tenantId: string,
  ) => Promise<BrainSubstrateState | null>;
  searchPages?: (args: {
    tenantId: string;
    query: string;
    limit: number;
  }) => Promise<BrainPageSearchRow[]>;
  loadArtifactManifests?: (args: {
    tenantId: string;
    limit: number;
    sourceKind?: string;
    sourceType?: string;
  }) => Promise<BrainArtifactManifestSummary[]>;
}

export function createCompanyBrainContextProvider(
  options: CompanyBrainProviderOptions = {},
): ContextProviderDescriptor {
  const db = options.db ?? defaultDb;
  const loadSubstrateState =
    options.loadSubstrateState ??
    ((tenantId: string) => loadSubstrateStateFromDb(db, tenantId));
  const searchPages =
    options.searchPages ?? ((args) => searchBrainPages(db, args));
  const loadArtifactManifests =
    options.loadArtifactManifests ??
    ((args) => loadArtifactManifestsFromDb(db, args));

  return {
    id: "brain",
    family: "brain",
    sourceFamily: "brain",
    displayName: "Company Brain",
    defaultEnabled: options.defaultEnabled ?? true,
    supportedScopes: ["team", "auto"],
    async query(request): Promise<ContextProviderResult> {
      const substrate = await loadSubstrateState(request.caller.tenantId);
      const substrateStatus = evaluateSubstrate(substrate);
      if (!substrateStatus.canQuery) {
        return {
          hits: [],
          status: substrateStatus.status,
        };
      }

      const brainOptions = request.providerOptions?.brain ?? {};
      const manifests = await loadArtifactManifests({
        tenantId: request.caller.tenantId,
        limit: 10,
        sourceKind: brainOptions.sourceKind,
        sourceType: brainOptions.sourceType,
      });
      const rows = await searchPages({
        tenantId: request.caller.tenantId,
        query: request.query,
        limit: Math.min(
          brainOptions.topK ?? request.limit ?? DEFAULT_BRAIN_LIMIT,
          MAX_BRAIN_LIMIT,
        ),
      });

      return {
        hits: rows.map((row, index) =>
          brainPageToHit({
            row,
            request,
            substrate: substrate!,
            manifests,
            index,
          }),
        ),
        status: {
          ...substrateStatus.status,
          state:
            substrateStatus.status.state === "ok" && rows.length === 0
              ? "stale"
              : substrateStatus.status.state,
          reason:
            rows.length === 0
              ? "active Company Brain substrate returned no matching graph context"
              : substrateStatus.status.reason,
          metadata: {
            ...substrateStatus.status.metadata,
            retrievalOptions: {
              sourceKind: brainOptions.sourceKind ?? null,
              sourceType: brainOptions.sourceType ?? null,
              datasetId: brainOptions.datasetId ?? null,
              nodeSetIds: brainOptions.nodeSetIds ?? [],
              topK: brainOptions.topK ?? request.limit,
              depth: request.depth,
              onlyContext: brainOptions.onlyContext ?? true,
            },
            provenanceKinds: summarizeManifestKinds(manifests),
          },
        },
      };
    },
  };
}

async function loadSubstrateStateFromDb(
  db: Database,
  tenantId: string,
): Promise<BrainSubstrateState | null> {
  const [row] = await db
    .select()
    .from(brainSubstrateStates)
    .where(eq(brainSubstrateStates.tenant_id, tenantId))
    .limit(1);
  return (row as BrainSubstrateState | undefined) ?? null;
}

async function searchBrainPages(
  db: Database,
  args: { tenantId: string; query: string; limit: number },
): Promise<BrainPageSearchRow[]> {
  const query = args.query.trim();
  if (!query) return [];
  const prefixQuery = buildBrainPrefixTsQuery(query);
  if (!prefixQuery) return [];
  const like = brainLikePattern(query);
  const result = await db.execute(sql`
    SELECT
      p.id,
      p.type,
      p.entity_subtype,
      p.slug,
      p.title,
      p.summary,
      p.body_md,
      p.last_compiled_at,
      p.updated_at,
      (
        COALESCE(ts_rank(p.search_tsv, plainto_tsquery('english', ${query})), 0)
        + COALESCE(ts_rank(p.search_tsv, to_tsquery('english', ${prefixQuery})), 0) * 0.5
        + CASE WHEN p.title ILIKE ${like} ESCAPE '\\' THEN 0.25 ELSE 0 END
      ) AS score
    FROM brain.pages p
    WHERE p.tenant_id = ${args.tenantId}
      AND p.status = 'active'
      AND (
        p.search_tsv @@ plainto_tsquery('english', ${query})
        OR p.search_tsv @@ to_tsquery('english', ${prefixQuery})
        OR p.title ILIKE ${like} ESCAPE '\\'
        OR p.summary ILIKE ${like} ESCAPE '\\'
        OR p.body_md ILIKE ${like} ESCAPE '\\'
      )
    ORDER BY score DESC, p.updated_at DESC, p.title ASC
    LIMIT ${args.limit}
  `);
  return (
    (result as unknown as { rows?: BrainPageSearchRow[] }).rows ?? []
  ).slice(0, args.limit);
}

export function normalizeBrainSearchTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const term of query.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (term.length < 2) continue;
    if (BRAIN_SEARCH_STOPWORDS.has(term)) continue;
    seen.add(term);
  }
  return [...seen];
}

export function buildBrainPrefixTsQuery(query: string): string | null {
  const terms = normalizeBrainSearchTerms(query);
  if (terms.length === 0) return null;
  return terms.map((term) => `${term}:*`).join(" & ");
}

export function brainLikePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

async function loadArtifactManifestsFromDb(
  db: Database,
  args: {
    tenantId: string;
    limit: number;
    sourceKind?: string;
    sourceType?: string;
  },
): Promise<BrainArtifactManifestSummary[]> {
  const filters = [
    eq(brainArtifactManifests.tenant_id, args.tenantId),
    eq(brainArtifactManifests.status, "active"),
  ];
  if (args.sourceKind) {
    filters.push(eq(brainArtifactManifests.source_kind, args.sourceKind));
  }
  if (args.sourceType) {
    filters.push(eq(brainArtifactManifests.source_type, args.sourceType));
  }
  const rows = await db
    .select({
      id: brainArtifactManifests.id,
      manifest_kind: brainArtifactManifests.manifest_kind,
      storage_tier: brainArtifactManifests.storage_tier,
      source_family: brainArtifactManifests.source_family,
      source_kind: brainArtifactManifests.source_kind,
      source_type: brainArtifactManifests.source_type,
      source_id_hash: brainArtifactManifests.source_id_hash,
      object_count: brainArtifactManifests.object_count,
      source_count: brainArtifactManifests.source_count,
      checksum_sha256: brainArtifactManifests.checksum_sha256,
      status: brainArtifactManifests.status,
      metadata: brainArtifactManifests.metadata,
      updated_at: brainArtifactManifests.updated_at,
    })
    .from(brainArtifactManifests)
    .where(and(...filters))
    .orderBy(desc(brainArtifactManifests.updated_at))
    .limit(args.limit);
  return rows as BrainArtifactManifestSummary[];
}

function evaluateSubstrate(substrate: BrainSubstrateState | null): {
  canQuery: boolean;
  status: Partial<ContextProviderStatus>;
} {
  if (!substrate) {
    return {
      canQuery: false,
      status: {
        state: "skipped",
        reason: "Company Brain substrate is not installed for this tenant",
        metadata: { activeBackend: "none", storageTier: null },
      },
    };
  }

  if (substrate.status === "not_installed" || substrate.status === "disabled") {
    return {
      canQuery: false,
      status: {
        state: "skipped",
        reason: `Company Brain substrate is ${substrate.status}`,
        metadata: substrateMetadata(substrate),
      },
    };
  }

  if (substrate.status === "failed") {
    return {
      canQuery: false,
      status: {
        state: "error",
        reason: "Company Brain substrate is failed",
        metadata: substrateMetadata(substrate),
      },
    };
  }

  const capabilities = requiredCapabilityStatuses(substrate);
  const disabled = Object.entries(capabilities)
    .filter(([, status]) => status === "disabled")
    .map(([key]) => key);
  if (disabled.length > 0) {
    return {
      canQuery: false,
      status: {
        state: "skipped",
        reason: `Company Brain capability disabled: ${disabled.join(", ")}`,
        metadata: { ...substrateMetadata(substrate), capabilities },
      },
    };
  }

  const degraded = Object.values(capabilities).some(
    (status) => status === "degraded" || status === "unknown",
  );
  const stale =
    degraded ||
    substrate.status === "degraded" ||
    substrate.health_status === "degraded" ||
    substrate.status === "provisioning" ||
    substrate.status === "migrating";

  return {
    canQuery: true,
    status: {
      state: stale ? "stale" : "ok",
      reason: stale
        ? "Company Brain substrate is available with degraded or unverified retrieval posture"
        : undefined,
      metadata: { ...substrateMetadata(substrate), capabilities },
    },
  };
}

function requiredCapabilityStatuses(
  substrate: BrainSubstrateState,
): Record<(typeof REQUIRED_CAPABILITIES)[number], CapabilityStatus> {
  const capabilities = capabilityRecord(substrate.launch_capabilities);
  return Object.fromEntries(
    REQUIRED_CAPABILITIES.map((key) => [
      key,
      capabilityStatus(capabilities[key]),
    ]),
  ) as Record<(typeof REQUIRED_CAPABILITIES)[number], CapabilityStatus>;
}

function capabilityRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function capabilityStatus(value: unknown): CapabilityStatus {
  if (typeof value === "boolean") return value ? "enabled" : "disabled";
  if (typeof value === "string") return normalizeCapabilityStatus(value);
  const record = capabilityRecord(value);
  return normalizeCapabilityStatus(record.status ?? record.state);
}

function normalizeCapabilityStatus(value: unknown): CapabilityStatus {
  if (
    value === "enabled" ||
    value === "disabled" ||
    value === "degraded" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function brainPageToHit(args: {
  row: BrainPageSearchRow;
  request: ContextEngineProviderRequest;
  substrate: BrainSubstrateState;
  manifests: BrainArtifactManifestSummary[];
  index: number;
}): ContextHit {
  const manifestMetadata = args.manifests.map(redactedManifestMetadata);
  const score =
    typeof args.row.score === "number"
      ? args.row.score
      : Number(args.row.score ?? NaN);
  return {
    id: `brain:${args.row.id}`,
    providerId: "brain",
    family: "brain",
    sourceFamily: "brain",
    title: args.row.title,
    snippet: snippetForPage(args.row),
    score: Number.isFinite(score) ? score : 1 / (args.index + 1),
    scope: args.request.scope,
    provenance: {
      label: "Company Brain graph retrieval",
      sourceId: args.row.id,
      uri: `thinkwork://brain/${args.row.type}/${args.row.entity_subtype}/${args.row.slug}`,
      metadata: {
        retrievalKind: "graph",
        retrievalSurface: "company_brain_active_backend",
        instructionBoundary: "untrusted_source_data",
        activeBackend: args.substrate.active_backend,
        storageTier: args.substrate.storage_tier,
        graphProvider: args.substrate.graph_provider,
        vectorProvider: args.substrate.vector_provider,
        pageType: args.row.type,
        entitySubtype: args.row.entity_subtype,
        compiledAt: isoDate(args.row.last_compiled_at),
        artifactManifests: manifestMetadata,
        provenanceKinds: summarizeManifestKinds(args.manifests),
      },
    },
    metadata: {
      page: {
        id: args.row.id,
        type: args.row.type,
        entitySubtype: args.row.entity_subtype,
        slug: args.row.slug,
        updatedAt: isoDate(args.row.updated_at),
      },
      sourceDataPolicy: {
        instructionBoundary: "untrusted_source_data",
        allowedUse: "cite_or_summarize_only",
        forbiddenUse: "do_not_execute_or_expand_tool_policy",
      },
      substrate: substrateMetadata(args.substrate),
      artifactManifests: manifestMetadata,
    },
    freshness: args.row.updated_at
      ? {
          asOf: isoDate(args.row.updated_at)!,
          ttlSeconds: 60 * 60 * 24,
        }
      : undefined,
  };
}

function snippetForPage(row: BrainPageSearchRow): string {
  const text = row.summary || row.body_md || row.title;
  return text.replace(/\s+/g, " ").trim().slice(0, 1_000) || row.title;
}

function substrateMetadata(substrate: BrainSubstrateState) {
  return {
    substrateId: substrate.id,
    storageTier: substrate.storage_tier,
    activeBackend: substrate.active_backend,
    status: substrate.status,
    healthStatus: substrate.health_status,
    graphProvider: substrate.graph_provider,
    vectorProvider: substrate.vector_provider,
    embeddingModel: substrate.embedding_model,
    vectorDimension: substrate.vector_dimension,
    cogneeVersion: substrate.cognee_version,
    latestIngestAt: isoDate(substrate.latest_ingest_at),
    latestProjectionAt: isoDate(substrate.latest_projection_at),
    updatedAt: isoDate(substrate.updated_at),
  };
}

function redactedManifestMetadata(manifest: BrainArtifactManifestSummary) {
  return {
    id: manifest.id,
    kind: manifest.manifest_kind,
    retrievalKind: retrievalKindForManifest(manifest.manifest_kind),
    storageTier: manifest.storage_tier,
    sourceFamily: manifest.source_family,
    sourceKind: manifest.source_kind,
    sourceType: manifest.source_type,
    sourceIdHash: manifest.source_id_hash,
    objectCount: manifest.object_count,
    sourceCount: manifest.source_count,
    checksumSha256: manifest.checksum_sha256,
    updatedAt: isoDate(manifest.updated_at),
  };
}

function retrievalKindForManifest(kind: string): string {
  if (kind === "vault_projection") return "vault_projection";
  if (kind === "source_artifact") return "source_artifact";
  if (kind === "ingestion_manifest") return "ingestion_manifest";
  if (kind === "migration_snapshot") return "migration_snapshot";
  return "graph";
}

function summarizeManifestKinds(manifests: BrainArtifactManifestSummary[]) {
  const counts = new Map<string, number>();
  for (const manifest of manifests) {
    counts.set(
      manifest.manifest_kind,
      (counts.get(manifest.manifest_kind) ?? 0) + 1,
    );
  }
  return Object.fromEntries([...counts.entries()].sort());
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
