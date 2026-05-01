import {
  db as defaultDb,
  eq,
  inboxItems,
  messages,
  threadTurns,
  threads,
} from "../../graphql/utils.js";
import { tenantEntityPages, wikiPages } from "@thinkwork/database-pg/schema";
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
