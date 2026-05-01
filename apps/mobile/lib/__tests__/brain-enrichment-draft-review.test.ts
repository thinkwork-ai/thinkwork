import { describe, expect, it } from "vitest";

import {
  defaultAcceptedRegionIds,
  isBrainEnrichmentDraftReviewPayload,
  regionFamilyLabel,
  serializeBrainEnrichmentDraftDecision,
} from "../brain-enrichment-draft-review";

describe("isBrainEnrichmentDraftReviewPayload", () => {
  const validPayload = {
    kind: "brain_enrichment_draft_review",
    proposedBodyMd: "## A\n\nbody",
    snapshotMd: "",
    regions: [],
    pageTitle: "Page",
    targetPageTable: "wiki_pages",
    targetPageId: "p1",
  };

  it("accepts the canonical shape", () => {
    expect(isBrainEnrichmentDraftReviewPayload(validPayload)).toBe(true);
  });

  it("accepts a JSON-stringified shape", () => {
    expect(
      isBrainEnrichmentDraftReviewPayload(JSON.stringify(validPayload)),
    ).toBe(true);
  });

  it("rejects the legacy candidate-card kind", () => {
    expect(
      isBrainEnrichmentDraftReviewPayload({
        kind: "brain_enrichment_review",
        candidates: [],
      }),
    ).toBe(false);
  });

  it("rejects non-JSON strings", () => {
    expect(isBrainEnrichmentDraftReviewPayload("not json")).toBe(false);
  });

  it("rejects shape with missing proposedBodyMd", () => {
    expect(
      isBrainEnrichmentDraftReviewPayload({
        kind: "brain_enrichment_draft_review",
        regions: [],
      }),
    ).toBe(false);
  });
});

describe("defaultAcceptedRegionIds", () => {
  it("returns ids in original order with no dedup", () => {
    const ids = defaultAcceptedRegionIds([
      { id: "r1" } as never,
      { id: "r2" } as never,
      { id: "r3" } as never,
    ]);
    expect(ids).toEqual(["r1", "r2", "r3"]);
  });
});

describe("serializeBrainEnrichmentDraftDecision", () => {
  it("emits the canonical envelope with sorted unique ids", () => {
    const json = serializeBrainEnrichmentDraftDecision({
      acceptedRegionIds: ["r1", "r1", "r2"],
      rejectedRegionIds: ["r3"],
    });
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe("brain_enrichment_draft_decision");
    expect(parsed.acceptedRegionIds).toEqual(["r1", "r2"]);
    expect(parsed.rejectedRegionIds).toEqual(["r3"]);
    expect(parsed.note).toBeUndefined();
  });

  it("includes note when present and non-empty", () => {
    const json = serializeBrainEnrichmentDraftDecision({
      acceptedRegionIds: [],
      rejectedRegionIds: [],
      note: "  looks good  ",
    });
    expect(JSON.parse(json).note).toBe("looks good");
  });

  it("omits empty / whitespace notes", () => {
    const json = serializeBrainEnrichmentDraftDecision({
      acceptedRegionIds: [],
      rejectedRegionIds: [],
      note: "   ",
    });
    expect(JSON.parse(json).note).toBeUndefined();
  });
});

describe("regionFamilyLabel", () => {
  it("maps each family to its display label", () => {
    expect(regionFamilyLabel("BRAIN")).toBe("Brain");
    expect(regionFamilyLabel("KNOWLEDGE_BASE")).toBe("Knowledge base");
    expect(regionFamilyLabel("WEB")).toBe("External research");
    expect(regionFamilyLabel("MIXED")).toBe("Multiple sources");
  });
});
