/**
 * inbox-approval-sweeper — daily TTL cancel for stale pending approvals.
 *
 * A pending approval is a promise that a human will decide. Nobody decides
 * an item they never see, and the queue had no nav entry for months: one dev
 * tenant accumulated 34 pending email approvals dating back four months, each
 * one an email the agent believed it had queued and the user never received.
 * A stale queue is worse than an empty one — it trains people to ignore it.
 *
 * So: anything past `expires_at` is cancelled. Items created before the TTL
 * shipped have no `expires_at`, so they fall back to age-based cancellation
 * against the same window.
 *
 * Cancelled is deliberate, not "expired": `pending → cancelled` is already a
 * legal inbox transition (INBOX_ITEM_TRANSITIONS), and re-asking is the
 * agent's job, not a state this sweeper should invent. For email approvals we
 * also write an `approval_denied` ledger event with reason_code `expired`, so
 * the email audit trail explains why nothing was sent.
 *
 * Triggered by EventBridge (aws_scheduler_schedule `inbox-approval-sweeper`)
 * once per day. Has no HTTP surface.
 */

import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { emailLedgerEvents, inboxItems } from "@thinkwork/database-pg/schema";
import {
  EMAIL_APPROVAL_TTL_DAYS,
  isEmailSendApprovalInboxItem,
} from "../lib/email-channel/first-send-approval.js";

export interface InboxSweepResult {
  sweptAt: string;
  cutoff: string;
  cancelled: number;
  emailLedgerEvents: number;
  rows: Array<{ id: string; tenant_id: string; type: string }>;
}

export async function handler(): Promise<InboxSweepResult> {
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - EMAIL_APPROVAL_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const cancelled = await db
    .update(inboxItems)
    .set({
      status: "cancelled",
      review_notes: `Auto-cancelled: no decision within ${EMAIL_APPROVAL_TTL_DAYS} days.`,
      updated_at: now,
    })
    .where(
      and(
        eq(inboxItems.status, "pending"),
        eq(inboxItems.type, "computer_approval"),
        // Pre-TTL rows carry no expires_at — age them out on created_at
        // against the same window instead of leaving them immortal.
        or(
          lt(inboxItems.expires_at, now),
          and(isNull(inboxItems.expires_at), lt(inboxItems.created_at, cutoff)),
        ),
      ),
    )
    .returning({
      id: inboxItems.id,
      tenant_id: inboxItems.tenant_id,
      type: inboxItems.type,
      config: inboxItems.config,
    });

  // Email approvals get a ledger row so the conversation's audit trail shows
  // the send lapsed rather than silently vanishing. Best-effort: a ledger
  // failure must not undo the cancellations above.
  let ledgerWrites = 0;
  for (const row of cancelled) {
    if (!isEmailSendApprovalInboxItem(row)) continue;
    const config = (row.config ?? {}) as Record<string, unknown>;
    const channel = (config.emailChannel ?? {}) as Record<string, unknown>;
    const conversationId = textValue(channel.conversationId);
    if (!conversationId) continue;
    const draft = (config.emailDraft ?? {}) as Record<string, unknown>;
    const event = {
      tenant_id: row.tenant_id,
      conversation_id: conversationId,
      space_id: textValue(channel.spaceId),
      thread_id: textValue(channel.threadId),
      inbox_item_id: row.id,
      provider_install_id: textValue(channel.providerInstallId),
      event_type: "approval_denied",
      reason_code: "expired",
      subject: textValue(draft.subject),
      from_email: textValue(channel.from),
      to_emails: Array.isArray(channel.to) ? (channel.to as string[]) : [],
      metadata: { ttlDays: EMAIL_APPROVAL_TTL_DAYS, source: "sweeper" },
    };
    try {
      await db.insert(emailLedgerEvents).values(event);
      ledgerWrites += 1;
    } catch {
      // The optional space/thread references can dangle — deleting a thread
      // leaves the approval's config pointing at a row that no longer
      // exists, and the insert trips that FK. The ledger entry matters more
      // than its back-references, so retry without them before giving up.
      try {
        await db
          .insert(emailLedgerEvents)
          .values({ ...event, space_id: null, thread_id: null });
        ledgerWrites += 1;
      } catch (retryErr) {
        console.error("[inbox-approval-sweeper] ledger write failed", {
          inboxItemId: row.id,
          errorType: retryErr instanceof Error ? retryErr.name : "unknown",
        });
      }
    }
  }

  const result: InboxSweepResult = {
    sweptAt: now.toISOString(),
    cutoff: cutoff.toISOString(),
    cancelled: cancelled.length,
    emailLedgerEvents: ledgerWrites,
    rows: cancelled.map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      type: r.type,
    })),
  };

  if (result.cancelled > 0) {
    console.log(
      `[inbox-approval-sweeper] cancelled=${result.cancelled} ledger=${ledgerWrites} cutoff=${result.cutoff}`,
      JSON.stringify(result.rows),
    );
  } else {
    console.log(
      `[inbox-approval-sweeper] no stale pending approvals; cutoff=${result.cutoff}`,
    );
  }

  return result;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
