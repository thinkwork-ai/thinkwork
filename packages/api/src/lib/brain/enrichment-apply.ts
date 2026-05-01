import {
  db as defaultDb,
  eq,
  inboxItems,
  messages,
  threadTurns,
  threads,
} from "../../graphql/utils.js";
import { tenantEntityPages, wikiPages } from "@thinkwork/database-pg/schema";
import {
  composeBodyFromSections,
  parseSections,
  type DraftCompileRegion,
} from "../wiki/draft-compile.js";
import type { BrainEnrichmentCandidate } from "./enrichment-service.js";

type DbLike = typeof defaultDb;

interface BrainEnrichmentConfig {
  targetPage?: {
    pageTable?: "wiki_pages" | "tenant_entity_pages";
    id?: string;
    title?: string;
  };
  threadId?: string;
  candidates?: BrainEnrichmentCandidate[];
}

interface BrainEnrichmentReviewPayload {
  kind?: string;
  targetPage?: {
    pageTable?: "wiki_pages" | "tenant_entity_pages";
    id?: string;
    title?: string;
  };
  candidates?: BrainEnrichmentCandidate[];
}

export function isBrainEnrichmentReviewPayload(
  payload: unknown,
): payload is BrainEnrichmentReviewPayload {
  const parsed = parseBrainEnrichmentReviewPayload(payload);
  return !!parsed;
}

function parseBrainEnrichmentReviewPayload(
  payload: unknown,
): BrainEnrichmentReviewPayload | null {
  if (typeof payload === "string") {
    try {
      return parseBrainEnrichmentReviewPayload(JSON.parse(payload));
    } catch {
      return null;
    }
  }
  return !!payload &&
    typeof payload === "object" &&
    (payload as BrainEnrichmentReviewPayload).kind === "brain_enrichment_review"
    ? (payload as BrainEnrichmentReviewPayload)
    : null;
}

export async function applyBrainEnrichmentWorkspaceReview(args: {
  payload: unknown;
  responseMarkdown?: string | null;
  tenantId: string;
  threadId?: string | null;
  turnId?: string | null;
  reviewerId?: string | null;
  db?: DbLike;
}): Promise<number> {
  const db = args.db ?? defaultDb;
  const payload = parseBrainEnrichmentReviewPayload(args.payload);
  if (!payload) return 0;
  const target = payload.targetPage;
  const candidates = selectApprovedCandidates(
    payload.candidates ?? [],
    args.responseMarkdown,
  );
  if (!target?.pageTable || !target.id || candidates.length === 0) {
    await completeReviewThread({
      db,
      tenantId: args.tenantId,
      threadId: args.threadId,
      turnId: args.turnId,
      preview: "No Brain enrichment suggestions were applied.",
      message: "No enrichment suggestions were selected for this Brain page.",
      reviewerId: args.reviewerId,
      status: "done",
    });
    return 0;
  }
  const resolvedTarget: {
    pageTable: "wiki_pages" | "tenant_entity_pages";
    id: string;
    title?: string;
  } = {
    pageTable: target.pageTable!,
    id: target.id!,
    title: target.title,
  };

  await appendCandidatesToPage({
    db,
    target: resolvedTarget,
    candidates,
  });
  await completeReviewThread({
    db,
    tenantId: args.tenantId,
    threadId: args.threadId,
    turnId: args.turnId,
    preview: `${candidates.length} Brain enrichment suggestions applied.`,
    message: `Applied ${candidates.length} approved enrichment suggestions to ${resolvedTarget.title ?? "the Brain page"}.`,
    reviewerId: args.reviewerId,
    status: "done",
  });
  return candidates.length;
}

export async function cancelBrainEnrichmentWorkspaceReview(args: {
  payload: unknown;
  tenantId: string;
  threadId?: string | null;
  turnId?: string | null;
  reviewerId?: string | null;
  db?: DbLike;
}): Promise<boolean> {
  const db = args.db ?? defaultDb;
  const payload = parseBrainEnrichmentReviewPayload(args.payload);
  if (!payload) return false;
  await completeReviewThread({
    db,
    tenantId: args.tenantId,
    threadId: args.threadId,
    turnId: args.turnId,
    preview: "Brain enrichment suggestions rejected.",
    message: "The Brain enrichment suggestions were rejected.",
    reviewerId: args.reviewerId,
    status: "cancelled",
  });
  return true;
}

export async function applyBrainEnrichmentInboxItem(args: {
  inboxItemId: string;
  reviewerId?: string | null;
  db?: DbLike;
}): Promise<void> {
  const db = args.db ?? defaultDb;
  const [item] = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.id, args.inboxItemId));
  if (!item || item.type !== "brain_enrichment_proposal") return;

  const config = item.config as BrainEnrichmentConfig | null;
  const target = config?.targetPage;
  const candidates = config?.candidates ?? [];
  if (!target?.pageTable || !target.id || candidates.length === 0) {
    await completeReviewThread({
      db,
      tenantId: item.tenant_id,
      threadId: config?.threadId,
      preview: "No Brain enrichment suggestions were applied.",
      message: "No candidate additions were available to apply.",
      reviewerId: args.reviewerId,
      status: "done",
    });
    return;
  }
  const resolvedTarget: {
    pageTable: "wiki_pages" | "tenant_entity_pages";
    id: string;
    title?: string;
  } = {
    pageTable: target.pageTable!,
    id: target.id!,
    title: target.title,
  };

  await appendCandidatesToPage({ db, target: resolvedTarget, candidates });

  await completeReviewThread({
    db,
    tenantId: item.tenant_id,
    threadId: config?.threadId,
    preview: `${candidates.length} Brain enrichment suggestions applied.`,
    message: `Applied ${candidates.length} approved enrichment suggestions to ${resolvedTarget.title ?? "the Brain page"}.`,
    reviewerId: args.reviewerId,
    status: "done",
  });
}

export async function closeBrainEnrichmentReviewThread(args: {
  inboxItemId: string;
  reviewerId?: string | null;
  status: "rejected" | "revision_requested";
  db?: DbLike;
}): Promise<void> {
  const db = args.db ?? defaultDb;
  const [item] = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.id, args.inboxItemId));
  if (!item || item.type !== "brain_enrichment_proposal") return;

  const config = item.config as BrainEnrichmentConfig | null;
  await completeReviewThread({
    db,
    tenantId: item.tenant_id,
    threadId: config?.threadId,
    preview:
      args.status === "rejected"
        ? "Brain enrichment suggestions rejected."
        : "Brain enrichment needs revision.",
    message:
      args.status === "rejected"
        ? "The enrichment suggestions were rejected."
        : "Revision requested for the enrichment suggestions.",
    reviewerId: args.reviewerId,
    status: args.status === "rejected" ? "cancelled" : "todo",
  });
}

function renderApprovedAdditions(
  candidates: BrainEnrichmentCandidate[],
): string {
  const lines = [
    `## Approved enrichment ${new Date().toISOString().slice(0, 10)}`,
    "",
  ];
  for (const candidate of candidates) {
    const source = candidate.citation?.label
      ? ` Source: ${candidate.citation.label}.`
      : "";
    lines.push(`- **${candidate.title}** — ${candidate.summary}${source}`);
  }
  return lines.join("\n");
}

export function selectApprovedCandidates(
  candidates: BrainEnrichmentCandidate[],
  responseMarkdown?: string | null,
): BrainEnrichmentCandidate[] {
  const selectedIds = parseSelectedCandidateIds(responseMarkdown);
  if (!selectedIds) return candidates;
  return candidates.filter((candidate) => selectedIds.has(candidate.id));
}

function parseSelectedCandidateIds(
  responseMarkdown?: string | null,
): Set<string> | null {
  const text = responseMarkdown?.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as {
      kind?: string;
      selectedCandidateIds?: unknown;
    };
    if (parsed.kind !== "brain_enrichment_selection") return null;
    if (!Array.isArray(parsed.selectedCandidateIds)) return null;
    return new Set(
      parsed.selectedCandidateIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    );
  } catch {
    return null;
  }
}

async function appendCandidatesToPage(args: {
  db: DbLike;
  target: {
    pageTable: "wiki_pages" | "tenant_entity_pages";
    id: string;
  };
  candidates: BrainEnrichmentCandidate[];
}) {
  const addition = renderApprovedAdditions(args.candidates);
  if (args.target.pageTable === "tenant_entity_pages") {
    const [page] = await args.db
      .select({ bodyMd: tenantEntityPages.body_md })
      .from(tenantEntityPages)
      .where(eq(tenantEntityPages.id, args.target.id));
    await args.db
      .update(tenantEntityPages)
      .set({
        body_md: appendMarkdown(page?.bodyMd ?? "", addition),
        updated_at: new Date(),
      })
      .where(eq(tenantEntityPages.id, args.target.id));
  } else {
    const [page] = await args.db
      .select({ bodyMd: wikiPages.body_md })
      .from(wikiPages)
      .where(eq(wikiPages.id, args.target.id));
    await args.db
      .update(wikiPages)
      .set({
        body_md: appendMarkdown(page?.bodyMd ?? "", addition),
        updated_at: new Date(),
      })
      .where(eq(wikiPages.id, args.target.id));
  }
}

function appendMarkdown(existing: string, addition: string): string {
  const trimmed = existing.trim();
  return trimmed ? `${trimmed}\n\n${addition}` : addition;
}

// ---------------------------------------------------------------------------
// Draft-page review apply (U2 — sibling to applyBrainEnrichmentWorkspaceReview)
// ---------------------------------------------------------------------------

export interface BrainEnrichmentDraftPayload {
  proposedBodyMd: string;
  snapshotMd: string;
  regions: DraftCompileRegion[];
  targetPage: {
    pageTable: "wiki_pages" | "tenant_entity_pages";
    id: string;
    title?: string;
  };
}

export interface BrainEnrichmentDraftDecision {
  acceptedRegionIds: string[];
  rejectedRegionIds: string[];
  note?: string;
}

const DRAFT_DECISION_KIND = "brain_enrichment_draft_decision";

/**
 * Parse a `responseMarkdown` JSON envelope produced by the mobile draft-review
 * panel. Returns null when the payload is missing or malformed (caller
 * defaults to bulk-accept).
 */
export function parseBrainEnrichmentDraftDecision(
  responseMarkdown: string | null | undefined,
): BrainEnrichmentDraftDecision | null {
  const text = responseMarkdown?.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as {
      kind?: string;
      acceptedRegionIds?: unknown;
      rejectedRegionIds?: unknown;
      note?: unknown;
    };
    if (parsed.kind !== DRAFT_DECISION_KIND) return null;
    const accepted = Array.isArray(parsed.acceptedRegionIds)
      ? parsed.acceptedRegionIds.filter((v): v is string => typeof v === "string")
      : [];
    const rejected = Array.isArray(parsed.rejectedRegionIds)
      ? parsed.rejectedRegionIds.filter((v): v is string => typeof v === "string")
      : [];
    const note = typeof parsed.note === "string" ? parsed.note : undefined;
    return {
      acceptedRegionIds: accepted,
      rejectedRegionIds: rejected,
      ...(note ? { note } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Pure function: compute the final page body markdown from a draft payload
 * plus an accept/reject decision.
 *
 * Semantics:
 *   - Sections with no region → unchanged (use proposed.afterMd).
 *   - Sections with a region NOT in rejectedRegionIds → accepted (use afterMd).
 *   - Sections with a region in rejectedRegionIds:
 *       - region has non-empty beforeMd  → revert to beforeMd in place.
 *       - region has empty beforeMd      → drop the section (it was a new
 *                                           addition the user rejected).
 *   - Removed regions (in snapshot, absent from proposed) in rejectedRegionIds
 *     → re-append the snapshot section at the end of the body.
 *
 * Reject-all behaves the same as whole-draft cancel: final body = snapshot.
 */
export function mergeAcceptedRegions(args: {
  draftPayload: BrainEnrichmentDraftPayload;
  decision: BrainEnrichmentDraftDecision | null;
}): string {
  const { proposedBodyMd, snapshotMd, regions } = args.draftPayload;
  const decision = args.decision;

  // Bulk-accept short-circuit.
  if (
    !decision ||
    (decision.rejectedRegionIds.length === 0 && regions.length > 0)
  ) {
    return proposedBodyMd;
  }

  // Reject-all short-circuit.
  const rejectedSet = new Set(decision.rejectedRegionIds);
  const allRegionsRejected =
    regions.length > 0 && regions.every((r) => rejectedSet.has(r.id));
  if (allRegionsRejected) {
    return snapshotMd;
  }

  const proposedSections = parseSections(proposedBodyMd);
  const regionsBySlug = new Map(regions.map((r) => [r.sectionSlug, r]));

  const finalSections: Array<{
    slug: string;
    heading: string;
    bodyMd: string;
  }> = [];

  for (const section of proposedSections) {
    const region = regionsBySlug.get(section.slug);
    if (!region || !rejectedSet.has(region.id)) {
      finalSections.push(section);
      continue;
    }
    // Region rejected.
    if (region.beforeMd.trim()) {
      // Modified section rejected → revert to before content in place.
      finalSections.push({
        slug: section.slug,
        heading: section.heading,
        bodyMd: region.beforeMd,
      });
    }
    // Brand-new section rejected (empty beforeMd) → omit.
  }

  // Re-append snapshot sections for removed-and-rejected regions.
  const proposedSlugs = new Set(proposedSections.map((s) => s.slug));
  for (const region of regions) {
    if (proposedSlugs.has(region.sectionSlug)) continue;
    if (!rejectedSet.has(region.id)) continue;
    if (!region.beforeMd.trim()) continue;
    finalSections.push({
      slug: region.sectionSlug,
      heading: region.sectionHeading,
      bodyMd: region.beforeMd,
    });
  }

  return composeBodyFromSections(finalSections);
}

export interface ApplyBrainEnrichmentDraftReviewArgs {
  draftPayload: BrainEnrichmentDraftPayload;
  decision: BrainEnrichmentDraftDecision | null;
  tenantId: string;
  threadId?: string | null;
  turnId?: string | null;
  reviewerId?: string | null;
  db?: DbLike;
}

export interface ApplyBrainEnrichmentDraftReviewResult {
  acceptedRegionCount: number;
  rejectedRegionCount: number;
  bodyChanged: boolean;
}

/**
 * Apply a draft-page review decision: write the merged body to the target
 * page, then close the review thread with an outcome message. Sibling to
 * `applyBrainEnrichmentWorkspaceReview` — does NOT modify the legacy append
 * path.
 *
 * Ships inert (no caller in `decideWorkspaceReview` yet — origin plan U5/U6
 * wire the dispatch).
 */
export async function applyBrainEnrichmentDraftReview(
  args: ApplyBrainEnrichmentDraftReviewArgs,
): Promise<ApplyBrainEnrichmentDraftReviewResult> {
  const db = args.db ?? defaultDb;
  const { draftPayload, decision } = args;
  const target = draftPayload.targetPage;

  const finalBody = mergeAcceptedRegions({ draftPayload, decision });

  await replacePageBody({
    db,
    target,
    bodyMd: finalBody,
  });

  const acceptedCount = countAccepted(draftPayload.regions, decision);
  const rejectedCount = decision?.rejectedRegionIds.length ?? 0;

  await completeReviewThread({
    db,
    tenantId: args.tenantId,
    threadId: args.threadId,
    turnId: args.turnId,
    preview: outcomePreview(acceptedCount, rejectedCount),
    message: outcomeMessage({
      title: target.title,
      acceptedCount,
      rejectedCount,
    }),
    reviewerId: args.reviewerId,
    status: "done",
  });

  return {
    acceptedRegionCount: acceptedCount,
    rejectedRegionCount: rejectedCount,
    bodyChanged: finalBody !== draftPayload.snapshotMd,
  };
}

/**
 * Whole-draft reject for draft-page reviews — leaves the page unchanged and
 * marks the thread cancelled.
 */
export async function cancelBrainEnrichmentDraftReview(args: {
  draftPayload: BrainEnrichmentDraftPayload;
  tenantId: string;
  threadId?: string | null;
  turnId?: string | null;
  reviewerId?: string | null;
  note?: string;
  db?: DbLike;
}): Promise<void> {
  const db = args.db ?? defaultDb;
  await completeReviewThread({
    db,
    tenantId: args.tenantId,
    threadId: args.threadId,
    turnId: args.turnId,
    preview: "Draft-page review rejected.",
    message: args.note
      ? `Draft was rejected. Reviewer note: ${args.note}`
      : "Draft was rejected.",
    reviewerId: args.reviewerId,
    status: "cancelled",
  });
}

function countAccepted(
  regions: DraftCompileRegion[],
  decision: BrainEnrichmentDraftDecision | null,
): number {
  if (!decision) return regions.length;
  const rejected = new Set(decision.rejectedRegionIds);
  return regions.filter((r) => !rejected.has(r.id)).length;
}

function outcomePreview(accepted: number, rejected: number): string {
  if (accepted === 0 && rejected > 0) return "All draft regions rejected.";
  if (rejected === 0) return `${accepted} draft regions applied.`;
  return `${accepted} accepted, ${rejected} rejected.`;
}

function outcomeMessage(args: {
  title?: string;
  acceptedCount: number;
  rejectedCount: number;
}): string {
  const target = args.title ? `${args.title}` : "the page";
  if (args.acceptedCount === 0) {
    return `Draft applied to ${target}: all ${args.rejectedCount} regions rejected; page unchanged.`;
  }
  if (args.rejectedCount === 0) {
    return `Draft applied to ${target}: ${args.acceptedCount} regions accepted.`;
  }
  return `Draft applied to ${target}: ${args.acceptedCount} accepted, ${args.rejectedCount} rejected.`;
}

async function replacePageBody(args: {
  db: DbLike;
  target: {
    pageTable: "wiki_pages" | "tenant_entity_pages";
    id: string;
  };
  bodyMd: string;
}) {
  if (args.target.pageTable === "tenant_entity_pages") {
    await args.db
      .update(tenantEntityPages)
      .set({
        body_md: args.bodyMd,
        updated_at: new Date(),
      })
      .where(eq(tenantEntityPages.id, args.target.id));
  } else {
    await args.db
      .update(wikiPages)
      .set({
        body_md: args.bodyMd,
        updated_at: new Date(),
      })
      .where(eq(wikiPages.id, args.target.id));
  }
}

async function completeReviewThread(args: {
  db: DbLike;
  tenantId: string;
  threadId?: string | null;
  turnId?: string | null;
  preview: string;
  message: string;
  reviewerId?: string | null;
  status: "done" | "cancelled" | "todo";
}) {
  if (!args.threadId) return;
  await args.db.insert(messages).values({
    thread_id: args.threadId,
    tenant_id: args.tenantId,
    role: "assistant",
    content: args.message,
    sender_type: "system",
    sender_id: args.reviewerId ?? undefined,
    metadata: { kind: "brain_enrichment_review_decision" },
  });
  await args.db
    .update(threads)
    .set({
      status: args.status,
      last_response_preview: args.preview,
      last_turn_completed_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(threads.id, args.threadId));
  if (args.turnId) {
    await args.db
      .update(threadTurns)
      .set({
        status: args.status === "cancelled" ? "cancelled" : "succeeded",
        finished_at: new Date(),
        last_activity_at: new Date(),
      })
      .where(eq(threadTurns.id, args.turnId));
  }
}
