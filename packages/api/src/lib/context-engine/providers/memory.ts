import { getMemoryServices } from "../../memory/index.js";
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
  process.env.CONTEXT_ENGINE_MEMORY_DEFAULT_ENABLED === "true";
const MEMORY_QUERY_MODE =
  process.env.CONTEXT_ENGINE_MEMORY_QUERY_MODE === "reflect"
    ? "reflect"
    : "recall";

export function createMemoryContextProvider(): ContextProviderDescriptor {
  return {
    id: "memory",
    family: "memory",
    displayName: "Hindsight Memory",
    defaultEnabled: MEMORY_DEFAULT_ENABLED,
    timeoutMs: Number.isFinite(MEMORY_TIMEOUT_MS) ? MEMORY_TIMEOUT_MS : 15_000,
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
        },
      } as const;
      const hits =
        MEMORY_QUERY_MODE === "reflect" && services.adapter.reflect
          ? await services.adapter.reflect(recallRequest)
          : await services.recall.recall(recallRequest);

      return {
        hits: hits.map((hit, index): ContextHit => {
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
                mode: MEMORY_QUERY_MODE,
              },
            },
            metadata: {
              ownerType: hit.record.ownerType,
              ownerId: hit.record.ownerId,
              recordMetadata: hit.record.metadata,
            },
          };
        }),
      };
    },
  };
}
