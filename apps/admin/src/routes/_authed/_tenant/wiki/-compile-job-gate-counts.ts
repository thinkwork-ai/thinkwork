export type CompileJobGateCounts = {
  approved: number;
  rejected: number;
  unresolved: number;
  suggestions: number;
  brainPages: number;
  brainFacets: number;
  brainLinks: number;
};

export function compileJobGateCounts(metrics: unknown): CompileJobGateCounts {
  return {
    approved: sumMetrics(metrics, [
      "ontology_gate_approved_pages",
      "ontology_gate_approved_facets",
      "ontology_gate_approved_relationships",
    ]),
    rejected: sumMetrics(metrics, [
      "ontology_gate_rejected_pages",
      "ontology_gate_rejected_facets",
      "ontology_gate_rejected_relationships",
    ]),
    unresolved: metricNumber(metrics, "ontology_gate_unresolved_observations"),
    suggestions: metricNumber(metrics, "ontology_gate_suggestion_candidates"),
    brainPages: metricNumber(metrics, "brain_pages_upserted"),
    brainFacets: metricNumber(metrics, "brain_facets_written"),
    brainLinks: metricNumber(metrics, "brain_links_upserted"),
  };
}

function metricNumber(metrics: unknown, key: string): number {
  if (!metrics || typeof metrics !== "object") return 0;
  const value = (metrics as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sumMetrics(metrics: unknown, keys: string[]): number {
  return keys.reduce((sum, key) => sum + metricNumber(metrics, key), 0);
}
