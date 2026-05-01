import {
  ContextEngineValidationError,
  type ContextEngineAnswer,
  type ContextEngineDepth,
  type ContextEngineMode,
  type ContextEngineProviderRequest,
  type ContextEngineRequest,
  type ContextEngineResponse,
  type ContextHit,
  type ContextProviderDescriptor,
  type ContextProviderFamily,
  type ContextProviderResult,
  type ContextProviderStatus,
  type ContextEngineScope,
} from "./types.js";
import { invokeKbPromotionWorker } from "../kb-promotion/promotion-worker.js";
import {
  sourceFamilyForHit,
  sourceFamilyForProvider,
} from "./source-families.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_QUICK_TIMEOUT_MS = 2_500;
const DEFAULT_DEEP_TIMEOUT_MS = 8_000;

const FAMILY_ORDER: ContextProviderFamily[] = [
  "memory",
  "wiki",
  "workspace",
  "knowledge-base",
  "mcp",
  "sub-agent",
];

export interface ContextEngineRouter {
  query(request: ContextEngineRequest): Promise<ContextEngineResponse>;
  listProviders(): ContextProviderDescriptor[];
}

export function createContextEngineRouter(args: {
  providers: ContextProviderDescriptor[];
  synthesize?: (
    request: ContextEngineProviderRequest,
    hits: ContextHit[],
  ) => Promise<ContextEngineAnswer | undefined>;
}): ContextEngineRouter {
  const providers = [...args.providers];
  return {
    listProviders: () => [...providers],
    query: async (request) => {
      const normalized = normalizeRequest(request);
      const selected = selectProviders(providers, normalized);
      const statuses: ContextProviderStatus[] = [];
      const results = await Promise.all(
        selected.map((provider) => runProvider(provider, normalized)),
      );

      for (const result of results) statuses.push(result.status);
      const hits = rankAndDedupe(
        results.flatMap((result) => result.hits),
      ).slice(0, normalized.limit);
      const kbHits = hits.filter((hit) => hit.providerId === "bedrock-knowledge-base");
      if (kbHits.length > 0) {
        void invokeKbPromotionWorker({
          tenantId: normalized.caller.tenantId,
          kbHits,
        }).catch((err) => {
          console.warn("kb_promotion_worker_failed", {
            tenantId: normalized.caller.tenantId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      const answer =
        normalized.mode === "answer"
          ? await args.synthesize?.(normalized, hits)
          : undefined;

      return {
        query: normalized.query,
        mode: normalized.mode,
        scope: normalized.scope,
        depth: normalized.depth,
        hits,
        providers: statuses,
        ...(answer ? { answer } : {}),
        traceId: normalized.caller.traceId ?? null,
      };
    },
  };
}

export function normalizeRequest(
  request: ContextEngineRequest,
): ContextEngineProviderRequest {
  const query = request.query.trim();
  if (!query) {
    throw new ContextEngineValidationError("query is required");
  }
  if (!request.caller?.tenantId) {
    throw new ContextEngineValidationError("caller.tenantId is required");
  }
  return {
    ...request,
    query,
    mode: request.mode ?? "results",
    scope: request.scope ?? "auto",
    depth: request.depth ?? "quick",
    limit: clampLimit(request.limit),
  };
}

function selectProviders(
  providers: ContextProviderDescriptor[],
  request: ContextEngineRequest,
): ContextProviderDescriptor[] {
  const ids = new Set(request.providers?.ids ?? []);
  const families = new Set(request.providers?.families ?? []);
  const hasExplicitIds = Array.isArray(request.providers?.ids);

  if (hasExplicitIds) {
    const knownIds = new Set(providers.map((provider) => provider.id));
    const unknown = [...ids].filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      throw new ContextEngineValidationError(
        `Unknown context provider id: ${unknown.join(", ")}`,
      );
    }
    const disabled = providers
      .filter((provider) => ids.has(provider.id) && provider.enabled === false)
      .map((provider) => provider.id);
    if (disabled.length > 0) {
      throw new ContextEngineValidationError(
        `Disabled context provider id: ${disabled.join(", ")}`,
      );
    }
  }

  return providers.filter((provider) => {
    if (provider.enabled === false) return false;
    if (!scopeIsSupported(provider, request.scope ?? "auto")) return true;
    if (hasExplicitIds) return ids.has(provider.id);
    if (families.size > 0) return families.has(provider.family);
    return provider.defaultEnabled;
  });
}

async function runProvider(
  provider: ContextProviderDescriptor,
  request: ContextEngineProviderRequest,
): Promise<{ hits: ContextHit[]; status: ContextProviderStatus }> {
  const started = Date.now();
  const baseStatus: ContextProviderStatus = {
    providerId: provider.id,
    family: provider.family,
    sourceFamily: sourceFamilyForProvider(provider),
    displayName: provider.displayName,
    state: "ok",
    scope: request.scope,
    defaultEnabled: provider.defaultEnabled,
  };

  if (!scopeIsSupported(provider, request.scope)) {
    return {
      hits: [],
      status: {
        ...baseStatus,
        state: "skipped",
        reason: `scope ${request.scope} is not supported`,
        durationMs: 0,
        hitCount: 0,
      },
    };
  }

  try {
    const timeoutMs =
      provider.timeoutMs ??
      (request.depth === "deep"
        ? DEFAULT_DEEP_TIMEOUT_MS
        : DEFAULT_QUICK_TIMEOUT_MS);
    const result = await withTimeout(provider.query(request), timeoutMs);
    const durationMs = Date.now() - started;
    return {
      hits: result.hits.map((hit) => ({
        ...hit,
        sourceFamily: sourceFamilyForHit(hit, provider),
      })),
      status: {
        ...baseStatus,
        ...result.status,
        state: result.status?.state ?? "ok",
        durationMs,
        hitCount: result.hits.length,
      },
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      hits: [],
      status: {
        ...baseStatus,
        state: timedOut ? "timeout" : "error",
        durationMs,
        hitCount: 0,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export function rankAndDedupe(hits: ContextHit[]): ContextHit[] {
  const deduped: ContextHit[] = [];

  for (const hit of hits) {
    const existingIndex = deduped.findIndex((existing) =>
      areDuplicateHits(existing, hit),
    );

    if (existingIndex === -1) {
      deduped.push(hit);
      continue;
    }

    if (normalizedScore(hit) > normalizedScore(deduped[existingIndex]!)) {
      deduped[existingIndex] = hit;
    }
  }

  return deduped
    .sort((a, b) => {
      const scoreDiff = normalizedScore(b) - normalizedScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      const familyDiff =
        FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family);
      if (familyDiff !== 0) return familyDiff;
      return a.title.localeCompare(b.title);
    })
    .map((hit, index) => ({ ...hit, rank: index + 1 }));
}

function areDuplicateHits(a: ContextHit, b: ContextHit): boolean {
  if (
    a.provenance.sourceId &&
    b.provenance.sourceId &&
    a.provenance.sourceId === b.provenance.sourceId
  ) {
    return true;
  }

  const titleA = normalizeFactText(a.title);
  const titleB = normalizeFactText(b.title);
  if (titleA !== titleB) return false;

  const snippetA = normalizeFactText(a.snippet);
  const snippetB = normalizeFactText(b.snippet);
  if (!snippetA || !snippetB) return false;
  if (snippetA === snippetB) return true;

  return tokenSimilarity(snippetA, snippetB) >= 0.88;
}

function normalizeFactText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+\|\s*(involving|when|where|source|sources):.*$/i, "")
    .replace(/[*_`#>[\](){}]/g, " ")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(a: string, b: string): number {
  const aTokens = new Set(tokensForSimilarity(a));
  const bTokens = new Set(tokensForSimilarity(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }

  const union = new Set([...aTokens, ...bTokens]).size;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(aTokens.size, bTokens.size);
  return Math.max(jaccard, containment);
}

function tokensForSimilarity(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function scopeIsSupported(
  provider: ContextProviderDescriptor,
  scope: ContextEngineScope,
): boolean {
  const supported = provider.supportedScopes ?? ["personal", "team", "auto"];
  return supported.includes(scope) || scope === "auto";
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit ?? DEFAULT_LIMIT)));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const err = new Error(`provider timed out after ${timeoutMs}ms`);
          err.name = "TimeoutError";
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizedScore(hit: Pick<ContextHit, "score" | "rank">): number {
  if (typeof hit.score === "number" && Number.isFinite(hit.score)) {
    return hit.score;
  }
  if (typeof hit.rank === "number" && hit.rank > 0) {
    return 1 / hit.rank;
  }
  return 0;
}
