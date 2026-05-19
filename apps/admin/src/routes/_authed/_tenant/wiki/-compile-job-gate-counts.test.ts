import { describe, expect, it } from "vitest";

import { compileJobGateCounts } from "./-compile-job-gate-counts";

describe("compileJobGateCounts", () => {
  it("summarizes ontology gate and Brain materialization metrics", () => {
    expect(
      compileJobGateCounts({
        ontology_gate_approved_pages: 2,
        ontology_gate_approved_facets: 5,
        ontology_gate_approved_relationships: 3,
        ontology_gate_rejected_pages: 1,
        ontology_gate_rejected_facets: 4,
        ontology_gate_rejected_relationships: 2,
        ontology_gate_unresolved_observations: 6,
        ontology_gate_suggestion_candidates: 7,
        brain_pages_upserted: 8,
        brain_facets_written: 9,
        brain_links_upserted: 10,
      }),
    ).toEqual({
      approved: 10,
      rejected: 7,
      unresolved: 6,
      suggestions: 7,
      brainPages: 8,
      brainFacets: 9,
      brainLinks: 10,
    });
  });

  it("treats missing or malformed metrics as zero", () => {
    expect(compileJobGateCounts(null)).toEqual({
      approved: 0,
      rejected: 0,
      unresolved: 0,
      suggestions: 0,
      brainPages: 0,
      brainFacets: 0,
      brainLinks: 0,
    });
  });
});
