// Shared brain-enrichment value types.
//
// These previously lived in `enrichment-service.ts`, which generated brain
// enrichment proposals for the (now retired) `runBrainPageEnrichment` /
// `brainEnrichmentSources` GraphQL surface. Plan 2026-06-09-004 U12 removed
// that read/generation surface; the apply/writeback path (inbox + workspace
// review acceptance, wiki draft-compile) still references the candidate shape,
// so the types were extracted here. Slated for removal with the rest of the
// brain enrichment write path in U13.

export type BrainEnrichmentSourceFamily = "BRAIN" | "WEB" | "KNOWLEDGE_BASE";

export interface BrainEnrichmentCandidate {
  id: string;
  title: string;
  summary: string;
  sourceFamily: BrainEnrichmentSourceFamily;
  providerId: string;
  score?: number | null;
  citation?: {
    label?: string | null;
    uri?: string | null;
    sourceId?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
}
