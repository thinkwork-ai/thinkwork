import { getMemoryServices } from "../../memory/index.js";
import {
  findPageSourcesAcrossSurfaces,
  type AcrossSurfaceSourceHit,
} from "../../brain/repository.js";
import type {
  ContextHit,
  ContextProviderDescriptor,
  ContextProviderResult,
} from "../types.js";

const MEMORY_LIMIT = 20;
const MEMORY_TIMEOUT_MS = Number(
  process.env.CONTEXT_ENGINE_MEMORY_TIMEOUT_MS || 15_000,
);
const MEMORY_DEFAULT_ENABLED =
  process.env.CONTEXT_ENGINE_MEMORY_DEFAULT_ENABLED !== "false";
const MEMORY_QUERY_MODE =
  process.env.CONTEXT_ENGINE_MEMORY_QUERY_MODE === "reflect"
    ? "reflect"
    : "recall";
const MEMORY_WIKI_BRIDGE_ENABLED =
  process.env.CONTEXT_ENGINE_MEMORY_WIKI_BRIDGE_ENABLED !== "false";

export type MemoryContextProviderOptions = {
  defaultEnabled?: boolean;
  timeoutMs?: number;
  queryMode?: "recall" | "reflect";
  includeLegacyBanks?: boolean;
};

export function createMemoryContextProvider(
  options: MemoryContextProviderOptions = {},
): ContextProviderDescriptor {
  const timeoutMs = options.timeoutMs ?? MEMORY_TIMEOUT_MS;
  const queryMode = options.queryMode ?? MEMORY_QUERY_MODE;
  return {
    id: "memory",
    family: "memory",
    displayName: "Hindsight Memory",
    defaultEnabled: options.defaultEnabled ?? MEMORY_DEFAULT_ENABLED,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 15_000,
    config: {
      queryMode,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 15_000,
      includeLegacyBanks: options.includeLegacyBanks ?? false,
    },
    supportedScopes: ["personal", "auto"],
    async query(request): Promise<ContextProviderResult> {
      if (!request.caller.userId) {
        return {
          hits: [],
          status: {
            state: "skipped",
            reason: "user scope is required for memory recall",
          },
        };
      }

      const services = getMemoryServices();
      const recallRequest = {
        tenantId: request.caller.tenantId,
        ownerType: "user",
        ownerId: request.caller.userId,
        query: request.query,
        limit: Math.min(request.limit, MEMORY_LIMIT),
        depth: request.depth,
        hindsight: {
          budget: request.depth === "deep" ? "mid" : "low",
          maxTokens: request.depth === "deep" ? 2_000 : 500,
          includeEntities: false,
          includeLegacyBanks:
            request.providerOptions?.memory?.includeLegacyBanks ??
            options.includeLegacyBanks ??
            false,
        },
      } as const;
      const queryMode =
        request.providerOptions?.memory?.queryMode ??
        options.queryMode ??
        MEMORY_QUERY_MODE;
      const hits =
        queryMode === "reflect" && services.adapter.reflect
          ? await services.adapter.reflect(recallRequest)
          : await services.recall.recall(recallRequest);
      const memoryHits = hits.map((hit, index): ContextHit => {
        const text =
          hit.record.kind === "reflection"
            ? hit.record.content.text || hit.record.content.summary
            : hit.record.content.summary || hit.record.content.text;
        return {
          id: `memory:${hit.record.id}`,
          providerId: "memory",
          family: "memory",
          title: hit.record.content.summary || "Memory",
          snippet: text || "Memory",
          score: hit.score ?? 1 / (index + 1),
          scope: request.scope,
          provenance: {
            label: "Memory",
            sourceId: hit.record.id,
            metadata: {
              backend: hit.backend,
              whyRecalled: hit.whyRecalled,
              createdAt: hit.record.createdAt,
              mode: queryMode,
            },
          },
          metadata: {
            ownerType: hit.record.ownerType,
            ownerId: hit.record.ownerId,
            recordMetadata: hit.record.metadata,
          },
        };
      });
      const bridge = MEMORY_WIKI_BRIDGE_ENABLED
        ? await loadWikiBridgeHits({
            tenantId: request.caller.tenantId,
            userId: request.caller.userId,
            memoryHits,
            scope: request.scope,
          })
        : { hits: [] };

      return {
        hits: [...memoryHits, ...bridge.hits],
        status: bridge.error
          ? {
              state: "stale",
              reason: `wiki citation bridge failed: ${bridge.error}`,
            }
          : undefined,
      };
    },
  };
}

async function loadWikiBridgeHits(args: {
  tenantId: string;
  userId: string;
  memoryHits: ContextHit[];
  scope: ContextHit["scope"];
}): Promise<{ hits: ContextHit[]; error?: string }> {
  const memoryIds = args.memoryHits
    .map((hit) => hit.provenance.sourceId)
    .filter((id): id is string => Boolean(id));
  if (memoryIds.length === 0) return { hits: [] };

  const memoryScoreById = new Map(
    args.memoryHits
      .map((hit) => [hit.provenance.sourceId, hit.score ?? 0] as const)
      .filter((entry): entry is readonly [string, number] => Boolean(entry[0])),
  );

  try {
    const rows = (
      await Promise.all(
        [...new Set(memoryIds)].map((memoryId) =>
          findPageSourcesAcrossSurfaces({
            tenantId: args.tenantId,
            ownerId: args.userId,
            sourceKind: "memory_unit",
            sourceRef: memoryId,
          }),
        ),
      )
    ).flat();
    const bestByPage = new Map<string, AcrossSurfaceSourceHit>();
    for (const row of rows) {
      const key = `${row.pageTable}:${row.pageId}`;
      const existing = bestByPage.get(key);
      const existingScore = existing
        ? (memoryScoreById.get(existing.sourceRef) ?? 0)
        : -1;
      const rowScore = memoryScoreById.get(row.sourceRef) ?? 0;
      if (!existing || rowScore > existingScore) {
        bestByPage.set(key, row);
      }
    }

    return {
      hits: [...bestByPage.values()].map((row): ContextHit => {
        const memoryScore = memoryScoreById.get(row.sourceRef) ?? 0;
        return {
          id: `wiki:${row.pageTable}:${row.pageId}:via-memory:${row.sourceRef}`,
          providerId: "memory",
          family: "wiki",
          title: row.title,
          snippet: "Compiled Company Brain page citing recalled memory.",
          score: memoryScore + 0.15,
          scope: args.scope,
          provenance: {
            label: "Company Brain page cited by memory",
            sourceId: row.pageId,
            uri: pageSourceUri(row),
            metadata: {
              bridge: "hindsight-memory-to-wiki",
              pageTable: row.pageTable,
              sectionId: row.sectionId,
              sourceKind: row.sourceKind,
              memoryUnitId: row.sourceRef,
              entitySubtype: row.entitySubtype,
            },
          },
          metadata: {
            bridge: {
              viaProvider: "memory",
              memoryUnitId: row.sourceRef,
              pageTable: row.pageTable,
              sectionId: row.sectionId,
            },
          },
        };
      }),
    };
  } catch (err) {
    return { hits: [], error: err instanceof Error ? err.message : String(err) };
  }
}

function pageSourceUri(row: AcrossSurfaceSourceHit): string {
  if (row.pageTable === "tenant_entity_pages") {
    return `thinkwork://brain/${row.entitySubtype ?? "entity"}/${row.slug}`;
  }
  return `thinkwork://wiki/${row.entitySubtype ?? "page"}/${row.slug}`;
}
