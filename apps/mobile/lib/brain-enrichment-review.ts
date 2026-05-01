import type {
  BrainEnrichmentProposal,
  BrainEnrichmentSourceFamily,
} from "@thinkwork/react-native-sdk";

export interface BrainEnrichmentSelectionPayload {
  kind: "brain_enrichment_selection";
  selectedCandidateIds: string[];
  note?: string;
}

export type BrainEnrichmentReviewCandidate =
  BrainEnrichmentProposal["candidates"][number];

export function isBrainEnrichmentReviewPayload(
  payload: unknown,
): payload is Pick<
  BrainEnrichmentProposal,
  "candidates" | "providerStatuses"
> & { kind: "brain_enrichment_review" } {
  const parsed = parseMaybeJson(payload);
  return (
    !!parsed &&
    typeof parsed === "object" &&
    (parsed as { kind?: unknown }).kind === "brain_enrichment_review" &&
    Array.isArray((parsed as { candidates?: unknown }).candidates)
  );
}

export function candidatesForBrainEnrichmentReview(
  proposal: Pick<BrainEnrichmentProposal, "candidates"> | null | undefined,
): BrainEnrichmentReviewCandidate[] {
  return dedupeCandidatesForDisplay(proposal?.candidates ?? []);
}

export function defaultSelectedCandidateIds(
  candidates: BrainEnrichmentReviewCandidate[],
): string[] {
  return candidates.map((candidate) => candidate.id);
}

export function serializeBrainEnrichmentSelection(args: {
  selectedCandidateIds: Iterable<string>;
  note?: string;
}): string {
  const selectedCandidateIds = [...new Set(args.selectedCandidateIds)];
  const payload: BrainEnrichmentSelectionPayload = {
    kind: "brain_enrichment_selection",
    selectedCandidateIds,
  };
  const note = args.note?.trim();
  if (note) payload.note = note;
  return JSON.stringify(payload);
}

export function sourceLabel(family: BrainEnrichmentSourceFamily): string {
  if (family === "KNOWLEDGE_BASE") return "Knowledge base";
  if (family === "WEB") return "External research";
  return "Brain";
}

export function providerStatusLabel(status: {
  displayName: string;
  state: string;
  hitCount?: number | null;
}): string {
  if (status.state === "ok") {
    return `${status.displayName} ${status.hitCount ?? 0}`;
  }
  if (status.state === "skipped") return `${status.displayName} skipped`;
  if (status.state === "timeout") return `${status.displayName} timed out`;
  if (status.state === "error") return `${status.displayName} error`;
  return `${status.displayName} ${status.state}`;
}

function dedupeCandidatesForDisplay(
  candidates: BrainEnrichmentReviewCandidate[],
): BrainEnrichmentReviewCandidate[] {
  const deduped: BrainEnrichmentReviewCandidate[] = [];
  for (const candidate of candidates) {
    const existingIndex = deduped.findIndex(
      (existing) =>
        normalize(existing.title) === normalize(candidate.title) &&
        normalize(stripWebPrefix(existing.summary)) ===
          normalize(stripWebPrefix(candidate.summary)),
    );
    if (existingIndex === -1) {
      deduped.push(candidate);
      continue;
    }
    if (
      deduped[existingIndex]!.sourceFamily === "WEB" &&
      candidate.sourceFamily !== "WEB"
    ) {
      deduped[existingIndex] = candidate;
    }
  }
  return deduped;
}

function parseMaybeJson(payload: unknown): unknown {
  if (typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function stripWebPrefix(value: string): string {
  return value.replace(
    /^(external source|exa research|web search) reports:\s*/i,
    "",
  );
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[*_`#>[\](){}]/g, " ")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
