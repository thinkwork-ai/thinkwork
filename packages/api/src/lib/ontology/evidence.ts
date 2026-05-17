export interface OntologyEvidenceInput {
  sourceKind: string;
  sourceRef: string | null;
  sourceLabel: string | null;
  quote: string;
  observedAt?: Date | string | null;
  metadata?: Record<string, unknown>;
}

export function compactEvidenceQuote(value: string, maxLength = 280): string {
  const compacted = value
    .replace(/\s+/g, " ")
    .replace(/[#*_`>[\](){}]/g, "")
    .trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, maxLength - 3).trimEnd()}...`;
}

export function evidenceFromText(args: {
  sourceKind: string;
  sourceRef?: string | null;
  sourceLabel?: string | null;
  text: string;
  observedAt?: Date | string | null;
  metadata?: Record<string, unknown>;
}): OntologyEvidenceInput | null {
  const quote = compactEvidenceQuote(args.text);
  if (!quote) return null;
  return {
    sourceKind: args.sourceKind,
    sourceRef: args.sourceRef ?? null,
    sourceLabel: args.sourceLabel ?? null,
    quote,
    observedAt: args.observedAt ?? null,
    metadata: args.metadata ?? {},
  };
}

export function dedupeEvidence(
  evidence: OntologyEvidenceInput[],
  limit = 5,
): OntologyEvidenceInput[] {
  const seen = new Set<string>();
  const deduped: OntologyEvidenceInput[] = [];
  for (const item of evidence) {
    const key = [
      item.sourceKind,
      item.sourceRef ?? "",
      item.quote.toLowerCase(),
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= limit) break;
  }
  return deduped;
}
