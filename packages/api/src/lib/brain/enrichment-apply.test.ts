import { describe, expect, it } from "vitest";

import { selectApprovedCandidates } from "./enrichment-apply.js";
import type { BrainEnrichmentCandidate } from "./enrichment-service.js";

const candidates: BrainEnrichmentCandidate[] = [
  {
    id: "candidate-1",
    title: "One",
    summary: "First",
    sourceFamily: "BRAIN",
    providerId: "memory",
  },
  {
    id: "candidate-2",
    title: "Two",
    summary: "Second",
    sourceFamily: "WEB",
    providerId: "builtin:web-search",
  },
];

describe("Brain enrichment review apply selection", () => {
  it("keeps legacy behavior when no structured selection is supplied", () => {
    expect(selectApprovedCandidates(candidates, "LGTM")).toEqual(candidates);
  });

  it("applies only selected candidates from structured review response", () => {
    expect(
      selectApprovedCandidates(
        candidates,
        JSON.stringify({
          kind: "brain_enrichment_selection",
          selectedCandidateIds: ["candidate-2"],
        }),
      ),
    ).toEqual([candidates[1]]);
  });

  it("applies zero candidates for an explicit empty selection", () => {
    expect(
      selectApprovedCandidates(
        candidates,
        JSON.stringify({
          kind: "brain_enrichment_selection",
          selectedCandidateIds: [],
        }),
      ),
    ).toEqual([]);
  });
});
