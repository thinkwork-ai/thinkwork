/**
 * Unit tests for the draft-page review apply path (`applyBrainEnrichmentDraftReview`).
 *
 * Focus: the pure `mergeAcceptedRegions` function and `parseBrainEnrichmentDraftDecision`
 * envelope. The DB-side `applyBrainEnrichmentDraftReview` writes through Drizzle
 * to `wiki_pages` / `tenant_entity_pages` and `threads` / `messages` / `thread_turns`;
 * its DB integration is exercised by U5/U8 once the workspace dispatch lands.
 */

import { describe, expect, it } from "vitest";

import {
  mergeAcceptedRegions,
  parseBrainEnrichmentDraftDecision,
  wikiSectionsFromBodyMarkdown,
  type BrainEnrichmentDraftPayload,
} from "./enrichment-apply.js";
import type { DraftCompileRegion } from "../wiki/draft-compile.js";

// ---------------------------------------------------------------------------
// Decision envelope parsing
// ---------------------------------------------------------------------------

describe("parseBrainEnrichmentDraftDecision", () => {
  it("returns null for empty / missing input", () => {
    expect(parseBrainEnrichmentDraftDecision(null)).toBeNull();
    expect(parseBrainEnrichmentDraftDecision(undefined)).toBeNull();
    expect(parseBrainEnrichmentDraftDecision("")).toBeNull();
    expect(parseBrainEnrichmentDraftDecision("   ")).toBeNull();
  });

  it("returns null for non-JSON or wrong kind", () => {
    expect(parseBrainEnrichmentDraftDecision("not json")).toBeNull();
    expect(
      parseBrainEnrichmentDraftDecision(
        JSON.stringify({ kind: "brain_enrichment_selection", selectedCandidateIds: [] }),
      ),
    ).toBeNull();
  });

  it("parses a well-formed decision envelope", () => {
    const decision = parseBrainEnrichmentDraftDecision(
      JSON.stringify({
        kind: "brain_enrichment_draft_decision",
        acceptedRegionIds: ["r1", "r3"],
        rejectedRegionIds: ["r2"],
        note: "lgtm",
      }),
    );
    expect(decision).toEqual({
      acceptedRegionIds: ["r1", "r3"],
      rejectedRegionIds: ["r2"],
      note: "lgtm",
    });
  });

  it("filters non-string IDs", () => {
    const decision = parseBrainEnrichmentDraftDecision(
      JSON.stringify({
        kind: "brain_enrichment_draft_decision",
        acceptedRegionIds: ["r1", 1, null],
        rejectedRegionIds: [true, "r2"],
      }),
    );
    expect(decision).toEqual({
      acceptedRegionIds: ["r1"],
      rejectedRegionIds: ["r2"],
    });
  });

  it("omits note when not a string", () => {
    const decision = parseBrainEnrichmentDraftDecision(
      JSON.stringify({
        kind: "brain_enrichment_draft_decision",
        acceptedRegionIds: [],
        rejectedRegionIds: [],
        note: 42,
      }),
    );
    expect(decision).toEqual({
      acceptedRegionIds: [],
      rejectedRegionIds: [],
    });
  });
});

// ---------------------------------------------------------------------------
// mergeAcceptedRegions — the heart of U2
// ---------------------------------------------------------------------------

function region(args: Partial<DraftCompileRegion> & { id: string; sectionSlug: string }): DraftCompileRegion {
  return {
    sectionHeading: "",
    sourceFamily: "BRAIN",
    citation: null,
    beforeMd: "",
    afterMd: "",
    contributingCandidateIds: [],
    ...args,
  };
}

function payload(overrides: Partial<BrainEnrichmentDraftPayload>): BrainEnrichmentDraftPayload {
  return {
    proposedBodyMd: "",
    snapshotMd: "",
    regions: [],
    targetPage: { pageTable: "wiki_pages", id: "page-1" },
    ...overrides,
  };
}

describe("mergeAcceptedRegions", () => {
  it("bulk-accepts when no decision is provided (legacy compat)", () => {
    const draft = payload({
      proposedBodyMd: "## A\n\nproposed-a",
      snapshotMd: "## A\n\nsnapshot-a",
      regions: [
        region({
          id: "r1",
          sectionSlug: "a",
          sectionHeading: "A",
          beforeMd: "snapshot-a",
          afterMd: "proposed-a",
        }),
      ],
    });
    expect(mergeAcceptedRegions({ draftPayload: draft, decision: null })).toBe(
      "## A\n\nproposed-a",
    );
  });

  it("bulk-accepts when decision has empty rejected list and at least one region", () => {
    const draft = payload({
      proposedBodyMd: "## A\n\nproposed-a\n\n## B\n\nproposed-b",
      snapshotMd: "## A\n\nsnapshot-a",
      regions: [
        region({ id: "r1", sectionSlug: "b", sectionHeading: "B", afterMd: "proposed-b" }),
      ],
    });
    expect(
      mergeAcceptedRegions({
        draftPayload: draft,
        decision: { acceptedRegionIds: ["r1"], rejectedRegionIds: [] },
      }),
    ).toBe("## A\n\nproposed-a\n\n## B\n\nproposed-b");
  });

  it("reject-all returns the snapshot verbatim", () => {
    const draft = payload({
      proposedBodyMd: "## A\n\nproposed-a",
      snapshotMd: "## A\n\nsnapshot-a",
      regions: [
        region({
          id: "r1",
          sectionSlug: "a",
          sectionHeading: "A",
          beforeMd: "snapshot-a",
          afterMd: "proposed-a",
        }),
      ],
    });
    expect(
      mergeAcceptedRegions({
        draftPayload: draft,
        decision: { acceptedRegionIds: [], rejectedRegionIds: ["r1"] },
      }),
    ).toBe("## A\n\nsnapshot-a");
  });

  it("mixed: rejected modify-region reverts to beforeMd in place; accepted regions stay", () => {
    const draft = payload({
      proposedBodyMd: "## A\n\nproposed-a\n\n## B\n\nproposed-b\n\n## C\n\nproposed-c",
      snapshotMd: "## A\n\nsnapshot-a\n\n## B\n\nsnapshot-b\n\n## C\n\nsnapshot-c",
      regions: [
        region({
          id: "r1",
          sectionSlug: "a",
          sectionHeading: "A",
          beforeMd: "snapshot-a",
          afterMd: "proposed-a",
        }),
        region({
          id: "r2",
          sectionSlug: "b",
          sectionHeading: "B",
          beforeMd: "snapshot-b",
          afterMd: "proposed-b",
        }),
        region({
          id: "r3",
          sectionSlug: "c",
          sectionHeading: "C",
          beforeMd: "snapshot-c",
          afterMd: "proposed-c",
        }),
      ],
    });
    const result = mergeAcceptedRegions({
      draftPayload: draft,
      decision: { acceptedRegionIds: ["r1", "r3"], rejectedRegionIds: ["r2"] },
    });
    expect(result).toBe(
      "## A\n\nproposed-a\n\n## B\n\nsnapshot-b\n\n## C\n\nproposed-c",
    );
  });

  it("rejecting a brand-new region (empty beforeMd) drops the section", () => {
    const draft = payload({
      proposedBodyMd: "## A\n\nproposed-a\n\n## New\n\nbrand new",
      snapshotMd: "## A\n\nproposed-a",
      regions: [
        region({
          id: "rNew",
          sectionSlug: "new",
          sectionHeading: "New",
          beforeMd: "",
          afterMd: "brand new",
        }),
      ],
    });
    const result = mergeAcceptedRegions({
      draftPayload: draft,
      decision: { acceptedRegionIds: [], rejectedRegionIds: ["rNew"] },
    });
    expect(result).toBe("## A\n\nproposed-a");
  });

  it("rejecting a removed-section region re-inserts that section at the end", () => {
    const draft = payload({
      proposedBodyMd: "## A\n\nproposed-a",
      snapshotMd: "## A\n\nproposed-a\n\n## Old\n\nold body",
      regions: [
        region({
          id: "rOld",
          sectionSlug: "old",
          sectionHeading: "Old",
          beforeMd: "old body",
          afterMd: "",
        }),
      ],
    });
    const result = mergeAcceptedRegions({
      draftPayload: draft,
      decision: { acceptedRegionIds: [], rejectedRegionIds: ["rOld"] },
    });
    expect(result).toBe("## A\n\nproposed-a\n\n## Old\n\nold body");
  });

  it("accepted removed-section region drops the section (proposed wins)", () => {
    const draft = payload({
      proposedBodyMd: "## A\n\nproposed-a",
      snapshotMd: "## A\n\nproposed-a\n\n## Old\n\nold body",
      regions: [
        region({
          id: "rOld",
          sectionSlug: "old",
          sectionHeading: "Old",
          beforeMd: "old body",
          afterMd: "",
        }),
      ],
    });
    const result = mergeAcceptedRegions({
      draftPayload: draft,
      decision: { acceptedRegionIds: ["rOld"], rejectedRegionIds: [] },
    });
    expect(result).toBe("## A\n\nproposed-a");
  });

  it("appends accepted regions that are missing from proposedBodyMd", () => {
    const draft = payload({
      proposedBodyMd: "## Overview\n\nexisting overview",
      snapshotMd: "## Overview\n\nexisting overview",
      regions: [
        region({
          id: "rJournal",
          sectionSlug: "erics-test-journal",
          sectionHeading: "Eric’s Test Journal",
          beforeMd: "",
          afterMd:
            "A journal entry titled “Eric’s Test Journal” contains street-art content.",
        }),
        region({
          id: "rWork",
          sectionSlug: "work",
          sectionHeading: "Work",
          beforeMd: "",
          afterMd:
            "A task titled “Fix MCP Server Calling Issue from Lastmile” was created.",
        }),
      ],
    });
    const result = mergeAcceptedRegions({
      draftPayload: draft,
      decision: {
        acceptedRegionIds: ["rJournal", "rWork"],
        rejectedRegionIds: [],
      },
    });
    expect(result).toBe(
      "## Overview\n\nexisting overview\n\n## Eric’s Test Journal\n\nA journal entry titled “Eric’s Test Journal” contains street-art content.\n\n## Work\n\nA task titled “Fix MCP Server Calling Issue from Lastmile” was created.",
    );
  });

  it("does not append missing regions that were rejected", () => {
    const draft = payload({
      proposedBodyMd: "## Overview\n\nexisting overview",
      snapshotMd: "## Overview\n\nexisting overview",
      regions: [
        region({
          id: "rJournal",
          sectionSlug: "erics-test-journal",
          sectionHeading: "Eric’s Test Journal",
          beforeMd: "",
          afterMd:
            "A journal entry titled “Eric’s Test Journal” contains street-art content.",
        }),
      ],
    });
    const result = mergeAcceptedRegions({
      draftPayload: draft,
      decision: {
        acceptedRegionIds: [],
        rejectedRegionIds: ["rJournal"],
      },
    });
    expect(result).toBe("## Overview\n\nexisting overview");
  });

  it("empty regions array returns proposedBodyMd unchanged", () => {
    const draft = payload({
      proposedBodyMd: "## A\n\nproposed-a",
      snapshotMd: "## A\n\nsnapshot-a",
      regions: [],
    });
    expect(
      mergeAcceptedRegions({
        draftPayload: draft,
        decision: { acceptedRegionIds: [], rejectedRegionIds: [] },
      }),
    ).toBe("## A\n\nproposed-a");
  });

  it("snapshot has _preamble and proposed drops it: no removed-region for _preamble (preamble is silently absorbed)", () => {
    // mergeAcceptedRegions is the apply-side merge; the no-region-for-_preamble
    // contract is enforced upstream in computeRegions (draft-compile.ts), so a
    // payload that shouldn't have one wouldn't be in `regions` to begin with.
    // This test pins the intended behavior at the apply-side: when the regions
    // list contains no _preamble entry but snapshot has preamble prose, the
    // proposed body wins verbatim — no implicit re-insertion.
    const draft = payload({
      proposedBodyMd: "## Details\n\ndetails body",
      snapshotMd: "Top-line preamble.\n\n## Details\n\ndetails body",
      regions: [],
    });
    expect(
      mergeAcceptedRegions({
        draftPayload: draft,
        decision: { acceptedRegionIds: [], rejectedRegionIds: [] },
      }),
    ).toBe("## Details\n\ndetails body");
  });

  it("rejecting an unknown region id is a no-op (region not in payload)", () => {
    const draft = payload({
      proposedBodyMd: "## A\n\nproposed-a",
      snapshotMd: "## A\n\nproposed-a",
      regions: [
        region({
          id: "r1",
          sectionSlug: "a",
          sectionHeading: "A",
          beforeMd: "proposed-a",
          afterMd: "proposed-a",
        }),
      ],
    });
    expect(
      mergeAcceptedRegions({
        draftPayload: draft,
        decision: {
          acceptedRegionIds: ["r1"],
          rejectedRegionIds: ["r-does-not-exist"],
        },
      }),
    ).toBe("## A\n\nproposed-a");
  });
});

describe("wikiSectionsFromBodyMarkdown", () => {
  it("maps the final merged page body into ordered wiki section rows", () => {
    expect(
      wikiSectionsFromBodyMarkdown(
        "## Overview\n\nExisting overview.\n\n## Eric’s Test Journal\n\nJournal summary.\n\n## Work\n\nWork summary.",
      ),
    ).toEqual([
      {
        section_slug: "overview",
        heading: "Overview",
        body_md: "Existing overview.",
        position: 1,
      },
      {
        section_slug: "eric-s-test-journal",
        heading: "Eric’s Test Journal",
        body_md: "Journal summary.",
        position: 2,
      },
      {
        section_slug: "work",
        heading: "Work",
        body_md: "Work summary.",
        position: 3,
      },
    ]);
  });
});
