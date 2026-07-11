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

/**
 * Reflect-exhaust marker (THINK-261 #2 / company-brain plan KTD-2). Stamped by
 * the runtime's retain client when the turn invoked the `reflect` memory tool.
 * Such turns are memory questions whose assistant content is synthesized from
 * existing memories — retaining them loops the Brain's own answers back into
 * the banks as if they were new knowledge.
 */
export function isReflectExhaustMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  const value = (metadata as { reflectExhaust?: unknown }).reflectExhaust;
  return value === true || value === "true";
}
