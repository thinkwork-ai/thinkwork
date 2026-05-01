import { describe, expect, it } from "vitest";

import {
  candidatesForBrainEnrichmentReview,
  defaultSelectedCandidateIds,
  isBrainEnrichmentReviewPayload,
  serializeBrainEnrichmentSelection,
  sourceLabel,
} from "../brain-enrichment-review";
import type { BrainEnrichmentProposal } from "@thinkwork/react-native-sdk";

function proposal(
  candidates: BrainEnrichmentProposal["candidates"],
): Pick<BrainEnrichmentProposal, "candidates"> {
  return { candidates };
}

describe("brain enrichment review helpers", () => {
  it("serializes selected candidates and note for inline and thread callers", () => {
    expect(
      serializeBrainEnrichmentSelection({
        selectedCandidateIds: ["candidate-1", "candidate-2"],
        note: "Looks right",
      }),
    ).toBe(
      JSON.stringify({
        kind: "brain_enrichment_selection",
        selectedCandidateIds: ["candidate-1", "candidate-2"],
        note: "Looks right",
      }),
    );
  });

  it("serializes explicit empty selection as an empty list", () => {
    expect(
      serializeBrainEnrichmentSelection({ selectedCandidateIds: [] }),
    ).toBe(
      JSON.stringify({
        kind: "brain_enrichment_selection",
        selectedCandidateIds: [],
      }),
    );
  });

  it("dedupes duplicate candidates for display without losing canonical IDs", () => {
    const candidates = candidatesForBrainEnrichmentReview(
      proposal([
        {
          id: "web-1",
          title: "Acme opened Austin office",
          summary: "Exa Research reports: Acme opened an Austin office.",
          sourceFamily: "WEB",
          providerId: "builtin:web-search",
        },
        {
          id: "brain-1",
          title: "Acme opened Austin office",
          summary: "Acme opened an Austin office.",
          sourceFamily: "BRAIN",
          providerId: "memory",
        },
      ]),
    );

    expect(candidates.map((candidate) => candidate.id)).toEqual(["brain-1"]);
    expect(defaultSelectedCandidateIds(candidates)).toEqual(["brain-1"]);
  });

  it("recognizes serialized enrichment review payloads", () => {
    expect(
      isBrainEnrichmentReviewPayload(
        JSON.stringify({
          kind: "brain_enrichment_review",
          candidates: [],
        }),
      ),
    ).toBe(true);
    expect(isBrainEnrichmentReviewPayload({ kind: "other" })).toBe(false);
  });

  it("labels Web as external/lower trust", () => {
    expect(sourceLabel("WEB")).toBe("External research");
  });
});
