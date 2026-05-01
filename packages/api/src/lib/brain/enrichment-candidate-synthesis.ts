import { randomUUID } from "node:crypto";

import type {
  ContextHit,
  ContextSourceFamily,
} from "../context-engine/types.js";
import type {
  BrainEnrichmentCandidate,
  BrainEnrichmentSourceFamily,
} from "./enrichment-service.js";

export function synthesizeBrainEnrichmentCandidates(args: {
  hits: ContextHit[];
  sourceFamilies: BrainEnrichmentSourceFamily[];
  limit: number;
}): BrainEnrichmentCandidate[] {
  const wanted = new Set(args.sourceFamilies);
  const deduped: BrainEnrichmentCandidate[] = [];

  for (const hit of args.hits) {
    const sourceFamily = graphqlFamilyForSourceFamily(
      hit.sourceFamily ?? fallbackSourceFamilyForHit(hit),
    );
    if (!sourceFamily || !wanted.has(sourceFamily)) continue;
    const candidate = candidateFromHit(hit, sourceFamily);
    if (!candidate) continue;

    const existingIndex = deduped.findIndex((existing) =>
      areDuplicateCandidates(existing, candidate),
    );
    if (existingIndex === -1) {
      deduped.push(candidate);
      continue;
    }
    deduped[existingIndex] = mergeCandidates(
      deduped[existingIndex]!,
      candidate,
    );
  }

  return deduped.slice(0, args.limit);
}

function candidateFromHit(
  hit: ContextHit,
  sourceFamily: BrainEnrichmentSourceFamily,
): BrainEnrichmentCandidate | null {
  const title = hit.title.trim();
  const snippet = hit.snippet.trim();
  if (!title || !snippet) return null;

  return {
    id: `candidate:${randomUUID()}`,
    title,
    summary: sourceFamily === "WEB" ? webSummary(snippet) : snippet,
    sourceFamily,
    providerId: hit.providerId,
    score: hit.score ?? null,
    citation: {
      label: hit.provenance.label ?? null,
      uri: hit.provenance.uri ?? null,
      sourceId: hit.provenance.sourceId ?? null,
      metadata: {
        ...(hit.provenance.metadata ?? {}),
        ...(sourceFamily === "WEB" ? { trust: "external" } : {}),
      },
    },
  };
}

function webSummary(snippet: string): string {
  const withoutPrefix = snippet.replace(/^external source reports:\s*/i, "");
  return `External source reports: ${withoutPrefix}`;
}

function mergeCandidates(
  existing: BrainEnrichmentCandidate,
  candidate: BrainEnrichmentCandidate,
): BrainEnrichmentCandidate {
  const preferred =
    existing.sourceFamily === "WEB" && candidate.sourceFamily !== "WEB"
      ? candidate
      : existing;
  const supporting = preferred === existing ? candidate : existing;
  return {
    ...preferred,
    citation: {
      label: preferred.citation?.label ?? supporting.citation?.label ?? null,
      uri: preferred.citation?.uri ?? supporting.citation?.uri ?? null,
      sourceId:
        preferred.citation?.sourceId ?? supporting.citation?.sourceId ?? null,
      metadata: {
        ...(supporting.citation?.metadata ?? {}),
        ...(preferred.citation?.metadata ?? {}),
      },
    },
  };
}

function areDuplicateCandidates(
  a: BrainEnrichmentCandidate,
  b: BrainEnrichmentCandidate,
): boolean {
  return (
    normalizeFactText(a.title) === normalizeFactText(b.title) &&
    normalizeFactText(stripWebPrefix(a.summary)) ===
      normalizeFactText(stripWebPrefix(b.summary))
  );
}

function stripWebPrefix(value: string): string {
  return value.replace(/^external source reports:\s*/i, "");
}

function normalizeFactText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[*_`#>[\](){}]/g, " ")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function graphqlFamilyForSourceFamily(
  family: ContextSourceFamily,
): BrainEnrichmentSourceFamily | null {
  if (family === "brain" || family === "pages") return "BRAIN";
  if (family === "knowledge-base") return "KNOWLEDGE_BASE";
  if (family === "web") return "WEB";
  return null;
}

function fallbackSourceFamilyForHit(hit: ContextHit): ContextSourceFamily {
  if (hit.family === "memory") return "brain";
  if (hit.family === "wiki") return "pages";
  if (hit.family === "knowledge-base") return "knowledge-base";
  if (hit.family === "workspace") return "workspace";
  return hit.family === "mcp" ? "mcp" : "source-agent";
}
