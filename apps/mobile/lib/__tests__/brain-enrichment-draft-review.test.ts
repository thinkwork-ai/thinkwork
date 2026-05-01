import { describe, expect, it } from "vitest";

import {
  defaultAcceptedRegionIds,
  isBrainEnrichmentDraftReviewPayload,
  parseDraftSections,
  regionFamilyLabel,
  serializeBrainEnrichmentDraftDecision,
  slugifyDraftHeading,
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
  it("dedupes preserving insertion order", () => {
    const json = serializeBrainEnrichmentDraftDecision({
      acceptedRegionIds: ["r2", "r2", "r1"],
      rejectedRegionIds: ["r3"],
    });
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe("brain_enrichment_draft_decision");
    // Insertion order preserved (r2 appears before r1 because it was first).
    expect(parsed.acceptedRegionIds).toEqual(["r2", "r1"]);
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

// Cross-package parity guard: import the server's slugifyTitle and assert
// the mobile mirror produces identical output across the cases that matter.
// Drift here silently breaks region lookups (sections render un-highlighted,
// user can't toggle accept/reject). Vitest in the mobile package can resolve
// the workspace-linked api package, so the import is cheap.
import { slugifyTitle } from "../../../../packages/api/src/lib/wiki/aliases.js";

describe("slugifyDraftHeading parity with server slugifyTitle", () => {
  const cases = [
    "Hello World",
    "Opéra",
    "Café Société",
    "Tickets & Subscriptions!",
    "foo - - - bar",
    "???",
    "Multi   Spaces",
    "ALL CAPS HEADING",
    "with-existing-dashes",
    "trailing punctuation.",
    "héllo wörld — em-dash",
    "x".repeat(150), // exercises the 120-char cap on both sides
  ];
  for (const input of cases) {
    it(`matches server for input: ${input.length > 30 ? input.slice(0, 30) + "…" : input}`, () => {
      expect(slugifyDraftHeading(input)).toBe(slugifyTitle(input));
    });
  }
});

describe("slugifyDraftHeading (must mirror server slugifyTitle)", () => {
  it("lowercases + dashes whitespace", () => {
    expect(slugifyDraftHeading("Hello World")).toBe("hello-world");
  });
  it("strips diacritics", () => {
    expect(slugifyDraftHeading("Opéra")).toBe("opera");
  });
  it("strips punctuation and symbols", () => {
    expect(slugifyDraftHeading("Tickets & Subscriptions!")).toBe(
      "tickets-subscriptions",
    );
  });
  it("collapses runs of dashes", () => {
    expect(slugifyDraftHeading("foo - - - bar")).toBe("foo-bar");
  });
  it("returns empty for non-alphanumeric input", () => {
    expect(slugifyDraftHeading("???")).toBe("");
  });
});

describe("parseDraftSections (mirrors server parseSections)", () => {
  it("returns empty array for empty body", () => {
    expect(parseDraftSections("")).toEqual([]);
  });
  it("parses two H2 sections in order", () => {
    expect(
      parseDraftSections(["## First", "", "first", "", "## Second", "", "second"].join("\n")),
    ).toEqual([
      { slug: "first", heading: "First", bodyMd: "first" },
      { slug: "second", heading: "Second", bodyMd: "second" },
    ]);
  });
  it("captures preamble before the first H2 as a synthetic _preamble section", () => {
    const md = ["intro prose", "", "## Details", "", "details body"].join("\n");
    expect(parseDraftSections(md)).toEqual([
      { slug: "_preamble", heading: "", bodyMd: "intro prose" },
      { slug: "details", heading: "Details", bodyMd: "details body" },
    ]);
  });
  it("keeps H3 inside the parent H2 section's body", () => {
    expect(parseDraftSections("## Top\n\n### Sub\n\nbody")).toEqual([
      { slug: "top", heading: "Top", bodyMd: "### Sub\n\nbody" },
    ]);
  });
  it("falls back to slug='section' when slugify returns empty", () => {
    expect(parseDraftSections("## ???\n\nbody")).toEqual([
      { slug: "section", heading: "???", bodyMd: "body" },
    ]);
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
