/**
 * Eval/test traffic marker (THINK-133 U3, KTD-5). Stamped by the runtime's
 * retain client (`evalTraffic` metadata) or directly by smoke/eval fixtures.
 * Marked traffic is excluded from derived-memory pipelines (high-confidence
 * facts, wiki compile, document-artifact ingest) so synthetic fixtures never
 * masquerade as institutional knowledge.
 */
export function isEvalTrafficMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  const value = (metadata as { evalTraffic?: unknown }).evalTraffic;
  return value === true || value === "true";
}
