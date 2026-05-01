import type {
  BrainEnrichmentDraftDecisionPayload,
  BrainEnrichmentDraftPage,
  BrainEnrichmentDraftRegion,
} from "@thinkwork/react-native-sdk";

// Inlined to keep this module type-only at the SDK boundary — pulling the
// runtime constants directly from the SDK index drags the provider tree into
// the test environment. The SDK still exports the same string literals; both
// places must change together if the wire format changes.
const BRAIN_ENRICHMENT_DRAFT_REVIEW_KIND = "brain_enrichment_draft_review" as const;
const BRAIN_ENRICHMENT_DRAFT_DECISION_KIND =
  "brain_enrichment_draft_decision" as const;

/**
 * Helpers for the draft-page review surface (origin plan: 2026-05-01-002).
 *
 * Sibling to `apps/mobile/lib/brain-enrichment-review.ts`, which serves the
 * legacy synchronous candidate-card flow. The two flows coexist — payload
 * `kind` discriminates which renderer runs.
 *
 * U3 ships these helpers inert; U4 wires the panel that consumes them.
 */

export interface BrainEnrichmentDraftReviewPayload extends BrainEnrichmentDraftPage {
  kind: typeof BRAIN_ENRICHMENT_DRAFT_REVIEW_KIND;
}

export function isBrainEnrichmentDraftReviewPayload(
  payload: unknown,
): payload is BrainEnrichmentDraftReviewPayload {
  const parsed = parseMaybeJson(payload);
  return (
    !!parsed &&
    typeof parsed === "object" &&
    (parsed as { kind?: unknown }).kind === BRAIN_ENRICHMENT_DRAFT_REVIEW_KIND &&
    typeof (parsed as { proposedBodyMd?: unknown }).proposedBodyMd === "string" &&
    Array.isArray((parsed as { regions?: unknown }).regions)
  );
}

export function defaultAcceptedRegionIds(
  regions: BrainEnrichmentDraftRegion[],
): string[] {
  return regions.map((r) => r.id);
}

/**
 * Serialize the user's per-region accept/reject decision into the wire shape
 * the server's `applyBrainEnrichmentDraftReview` expects (carried in the
 * `responseMarkdown` field on the workspace-review accept mutation).
 */
export function serializeBrainEnrichmentDraftDecision(args: {
  acceptedRegionIds: Iterable<string>;
  rejectedRegionIds: Iterable<string>;
  note?: string;
}): string {
  const accepted = [...new Set(args.acceptedRegionIds)];
  const rejected = [...new Set(args.rejectedRegionIds)];
  const payload: BrainEnrichmentDraftDecisionPayload = {
    kind: BRAIN_ENRICHMENT_DRAFT_DECISION_KIND,
    acceptedRegionIds: accepted,
    rejectedRegionIds: rejected,
  };
  const note = args.note?.trim();
  if (note) payload.note = note;
  return JSON.stringify(payload);
}

export function regionFamilyLabel(
  family: BrainEnrichmentDraftRegion["sourceFamily"],
): string {
  if (family === "KNOWLEDGE_BASE") return "Knowledge base";
  if (family === "WEB") return "External research";
  if (family === "MIXED") return "Multiple sources";
  return "Brain";
}

function parseMaybeJson(payload: unknown): unknown {
  if (typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Section parsing for in-place render (mirror of the API parser)
// ---------------------------------------------------------------------------

export interface ParsedDraftSection {
  slug: string;
  heading: string;
  bodyMd: string;
}

/**
 * Slugify a heading using the same algorithm the server uses for section
 * slugs. Must stay in sync with `slugifyTitle` in
 * `packages/api/src/lib/wiki/aliases.ts` so client-side region lookups
 * resolve to the same slug the server attached to each region.
 */
export function slugifyDraftHeading(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/**
 * Parse a markdown body into H2-bounded sections. Mirrors the API's
 * `parseSections` exactly so the panel can map section slugs to regions
 * the server attached. Content before the first H2 is exposed as a synthetic
 * `_preamble` section.
 */
export function parseDraftSections(bodyMd: string): ParsedDraftSection[] {
  const trimmed = bodyMd.trimEnd();
  if (!trimmed) return [];

  const lines = trimmed.split("\n");
  const sections: ParsedDraftSection[] = [];
  const preambleLines: string[] = [];
  let current: { heading: string; slug: string; lines: string[] } | null = null;

  const pushCurrent = () => {
    if (current) {
      sections.push({
        slug: current.slug,
        heading: current.heading,
        bodyMd: current.lines.join("\n").trim(),
      });
    }
  };

  for (const line of lines) {
    const h2Match = /^##\s+(.+?)\s*$/.exec(line);
    if (h2Match) {
      pushCurrent();
      const heading = h2Match[1]!.trim();
      current = {
        heading,
        slug: slugifyDraftHeading(heading) || "section",
        lines: [],
      };
      continue;
    }
    if (current) {
      current.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  pushCurrent();

  const preamble = preambleLines.join("\n").trim();
  if (preamble) {
    sections.unshift({
      slug: "_preamble",
      heading: "",
      bodyMd: preamble,
    });
  }

  return sections;
}
