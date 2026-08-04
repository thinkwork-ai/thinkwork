import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  emailBodyObjects,
  emailConversations,
  emailLedgerEvents,
  inboxItems,
  type EmailChannelProvider,
} from "@thinkwork/database-pg/schema";
import type { Database } from "@thinkwork/database-pg";
import type { EmailProviderSendResult } from "./provider-contract.js";
import { sendComputerApprovalPush } from "../push-notifications.js";
import { S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import { buildOutboundMime } from "./outbound-mime.js";
import {
  loadEmailAttachmentBytes,
  type ResolvedEmailAttachment,
} from "./email-attachments.js";

type Db = Pick<Database, "select" | "insert" | "update">;

/**
 * How long an unanswered first-send review stays actionable. Past this the
 * inbox-approval-sweeper cancels it: an outbound draft nobody decided on in
 * a week is stale, and a queue full of month-old items reads as "nothing is
 * waiting on me" — which is how four months of sends went unnoticed.
 */
export const EMAIL_APPROVAL_TTL_DAYS = 7;

type EmailSendFunction = (
  provider: EmailChannelProvider,
  input: {
    tenantId?: string;
    from: string;
    to: string[];
    subject: string;
    text?: string;
    /** Full MIME when the approved draft carries attachments. */
    rawMessage?: string;
  },
) => Promise<EmailProviderSendResult>;

export interface EmailDraftApprovalInput {
  db: Db;
  tenantId: string;
  /** Null when sending through built-in SES with no provider install row. */
  providerInstallId: string | null;
  provider: EmailChannelProvider;
  agentId: string;
  /** Exact authenticated user who requested an interactive send. */
  requestingUserId?: string | null;
  spaceId?: string | null;
  threadId?: string | null;
  from: string;
  to: string[];
  subject: string;
  body: string;
  /** Resolved attachment metadata (bytes re-fetched at approved send). */
  attachments?: ResolvedEmailAttachment[];
}

export async function requestFirstSendApproval(
  input: EmailDraftApprovalInput,
): Promise<{
  status: "pending_review" | "send";
  conversationId: string;
  inboxItemId?: string;
}> {
  const participantHash = conversationParticipantHash(input.to);
  // Recipient-set approvals are TENANT-scoped, not thread-scoped (Eric,
  // 2026-08-04): once a human has approved sending to this exact recipient
  // set anywhere in the tenant, later threads must not re-raise the review
  // — "approve an address once", not "approve every email". The per-thread
  // conversation row below still tracks each thread's traffic; only the
  // review gate consults the tenant-wide history.
  const [tenantApproved] = await input.db
    .select()
    .from(emailConversations)
    .where(
      and(
        eq(emailConversations.tenant_id, input.tenantId),
        eq(emailConversations.participant_hash, participantHash),
        eq(emailConversations.status, "approved"),
      ),
    )
    .limit(1);
  if (tenantApproved?.status === "approved") {
    return {
      status: "send",
      conversationId: tenantApproved.id,
    };
  }
  const [existingConversation] = await input.db
    .select()
    .from(emailConversations)
    .where(
      and(
        eq(emailConversations.tenant_id, input.tenantId),
        input.threadId
          ? eq(emailConversations.thread_id, input.threadId)
          : isNull(emailConversations.thread_id),
        eq(emailConversations.participant_hash, participantHash),
      ),
    )
    .limit(1);
  if (existingConversation?.status === "approved") {
    return {
      status: "send",
      conversationId: existingConversation.id,
    };
  }

  // A pending conversation may already exist for this
  // (tenant, thread, participants) — the unique index
  // uq_email_conversations_thread_participants forbids a second row, so
  // reuse it (refreshing every mutable field to the latest request) and
  // raise a fresh review instead of crashing on the duplicate insert.
  const refresh = {
    space_id: input.spaceId ?? null,
    provider_install_id: input.providerInstallId,
    subject: input.subject,
    status: "pending_approval" as const,
    metadata: {
      from: input.from,
      to: input.to,
      firstSendReviewRequired: true,
    },
    updated_at: sql`now()`,
  };
  let conversation = existingConversation;
  if (conversation) {
    [conversation] = await input.db
      .update(emailConversations)
      .set(refresh)
      .where(eq(emailConversations.id, conversation.id))
      .returning();
    // Supersede the prior undecided review — a stale pending item would
    // otherwise stay approvable and send an outdated draft alongside the
    // new one.
    await input.db
      .update(inboxItems)
      .set({ status: "cancelled", updated_at: sql`now()` })
      .where(
        and(
          eq(inboxItems.tenant_id, input.tenantId),
          eq(inboxItems.entity_type, "email_conversation"),
          eq(inboxItems.entity_id, conversation.id),
          eq(inboxItems.status, "pending"),
        ),
      );
  } else {
    // onConflictDoUpdate closes the select-then-insert race: two concurrent
    // first sends for the same non-null thread land on one row instead of
    // the loser crashing with 23505. (Null-thread conversations are outside
    // the partial index and insert as before.)
    [conversation] = await input.db
      .insert(emailConversations)
      .values({
        tenant_id: input.tenantId,
        thread_id: input.threadId ?? null,
        participant_hash: participantHash,
        ...refresh,
      })
      .onConflictDoUpdate({
        target: [
          emailConversations.tenant_id,
          emailConversations.thread_id,
          emailConversations.participant_hash,
        ],
        targetWhere: sql`${emailConversations.thread_id} IS NOT NULL`,
        set: refresh,
      })
      .returning();
  }

  const bodyHash = contentHash(input.body);
  const [bodyObject] = await input.db
    .insert(emailBodyObjects)
    .values({
      tenant_id: input.tenantId,
      conversation_id: conversation.id,
      direction: "outbound",
      content_hash: bodyHash,
      object_ref: `email-channel://outbound-draft/${input.tenantId}/${bodyHash}`,
      retention_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      metadata: {
        phase: "draft",
        storage: "deferred",
      },
    })
    .returning();

  const [inboxItem] = await input.db
    .insert(inboxItems)
    .values({
      tenant_id: input.tenantId,
      requester_type: "agent",
      requester_id: input.agentId,
      recipient_id: input.requestingUserId ?? null,
      type: "computer_approval",
      title: `Review email to ${input.to.join(", ")}`,
      description:
        (input.attachments?.length ?? 0) > 0
          ? `First outbound email in this conversation requires human review. Attachments: ${input.attachments!.map((a) => a.name).join(", ")}.`
          : "First outbound email in this conversation requires human review.",
      expires_at: new Date(
        Date.now() + EMAIL_APPROVAL_TTL_DAYS * 24 * 60 * 60 * 1000,
      ),
      entity_type: "email_conversation",
      entity_id: conversation.id,
      config: {
        question: "Send this email?",
        actionType: "email_send",
        actionDescription:
          "Review the first outbound email before ThinkWork sends it.",
        emailDraft: {
          to: input.to.join(", "),
          subject: input.subject,
          body: input.body,
          attachmentNames: (input.attachments ?? []).map((a) => a.name),
        },
        emailChannel: {
          conversationId: conversation.id,
          providerInstallId: input.providerInstallId,
          provider: input.provider,
          from: input.from,
          to: input.to,
          spaceId: input.spaceId ?? null,
          threadId: input.threadId ?? null,
          draftBodyObjectId: bodyObject.id,
          draftBodyHash: bodyHash,
          attachments: input.attachments ?? [],
        },
      },
    })
    .returning();

  await input.db.insert(emailLedgerEvents).values({
    tenant_id: input.tenantId,
    conversation_id: conversation.id,
    space_id: input.spaceId ?? null,
    thread_id: input.threadId ?? null,
    inbox_item_id: inboxItem.id,
    provider_install_id: input.providerInstallId,
    event_type: "draft_created",
    body_object_id: bodyObject.id,
    subject: input.subject,
    from_email: input.from,
    to_emails: input.to,
    metadata: { bodyHash },
  });
  await input.db.insert(emailLedgerEvents).values({
    tenant_id: input.tenantId,
    conversation_id: conversation.id,
    space_id: input.spaceId ?? null,
    thread_id: input.threadId ?? null,
    inbox_item_id: inboxItem.id,
    provider_install_id: input.providerInstallId,
    event_type: "approval_requested",
    subject: input.subject,
    from_email: input.from,
    to_emails: input.to,
    metadata: { actionType: "email_send" },
  });

  // The Work Item is the durable approval surface. Assign it to the exact
  // requesting user and make mobile push a best-effort notification; neither
  // approval creation nor later delivery depends on an approval email.
  if (input.requestingUserId) {
    await sendComputerApprovalPush({
      userId: input.requestingUserId,
      tenantId: input.tenantId,
      approvalId: inboxItem.id,
      question: `Review email to ${input.to.join(", ")}`,
    }).catch((error) => {
      console.error("[first-send-approval] approval push failed", {
        tenantId: input.tenantId,
        inboxItemId: inboxItem.id,
        errorType: error instanceof Error ? error.name : "unknown",
      });
    });
  }

  return {
    status: "pending_review",
    conversationId: conversation.id,
    inboxItemId: inboxItem.id,
  };
}

export function isEmailSendApprovalInboxItem(input: {
  type?: string | null;
  config?: unknown;
}): boolean {
  const config = recordValue(input.config);
  return (
    input.type === "computer_approval" && config.actionType === "email_send"
  );
}

export async function bridgeEmailApprovalDecision(input: {
  db: Db;
  inboxItem: {
    id: string;
    tenant_id: string;
    type?: string | null;
    config?: unknown;
  };
  decision: "approved" | "rejected";
  actorId: string | null;
  decisionPayload?: {
    reviewNotes?: string | null;
    values?: Record<string, unknown>;
  };
  send: EmailSendFunction;
}): Promise<
  | { sent: true; providerMessageId: string }
  | { sent: false; reason: "rejected" }
> {
  const config = recordValue(input.inboxItem.config);
  const channel = recordValue(config.emailChannel);
  const originalDraft = recordValue(config.emailDraft);
  const recipients = stringArray(channel.to);
  const editedDraft = recordValue(input.decisionPayload?.values?.editedDraft);
  const draft =
    Object.keys(editedDraft).length > 0 ? editedDraft : originalDraft;
  const to = textValue(draft.to) ?? recipients.join(", ");
  const subject = textValue(draft.subject) ?? textValue(originalDraft.subject);
  const body = textValue(draft.body) ?? textValue(originalDraft.body);
  const normalizedEditedRecipients = normalizeRecipientList(to);
  const normalizedOriginalRecipients = normalizeRecipientList(recipients);
  if (
    normalizedEditedRecipients.join(",") !==
    normalizedOriginalRecipients.join(",")
  ) {
    throw new Error("Recipient edits are not supported for email approvals.");
  }

  const commonLedger = {
    tenant_id: input.inboxItem.tenant_id,
    conversation_id: textValue(channel.conversationId),
    space_id: textValue(channel.spaceId),
    thread_id: textValue(channel.threadId),
    inbox_item_id: input.inboxItem.id,
    provider_install_id: textValue(channel.providerInstallId),
    actor_user_id: input.actorId,
    subject,
    from_email: textValue(channel.from),
    to_emails: recipients,
  };
  const conversationId = textValue(channel.conversationId);
  if (!conversationId) {
    throw new Error("Email approval payload is missing conversation context.");
  }

  if (input.decision === "rejected") {
    await input.db.insert(emailLedgerEvents).values({
      ...commonLedger,
      event_type: "approval_denied",
      reason_code: "reviewer_rejected",
      metadata: { reviewNotes: input.decisionPayload?.reviewNotes ?? null },
    });
    return { sent: false, reason: "rejected" };
  }

  if (
    !subject ||
    !body ||
    !commonLedger.from_email ||
    recipients.length === 0
  ) {
    throw new Error("Email approval payload is missing required send fields.");
  }

  await input.db.insert(emailLedgerEvents).values({
    ...commonLedger,
    event_type: "approval_approved",
    metadata: {
      edited: Object.keys(editedDraft).length > 0,
      reviewNotes: input.decisionPayload?.reviewNotes ?? null,
    },
  });
  await input.db.insert(emailLedgerEvents).values({
    ...commonLedger,
    event_type: "send_attempted",
    metadata: { source: "first_send_approval" },
  });

  try {
    // A draft with attachments must go out as full MIME — the structured
    // {text} send has no attachment channel and would silently drop them.
    // Bytes are re-fetched from S3 at approval time (refs were persisted
    // in the inbox item config; drafts sit for up to a week).
    const draftAttachments = attachmentArray(channel.attachments);
    let rawMessage: string | undefined;
    if (draftAttachments.length > 0) {
      const bucket = getConfig("WORKSPACE_BUCKET") || "";
      if (!bucket) {
        throw new Error(
          "WORKSPACE_BUCKET is not configured; cannot load approved email attachments.",
        );
      }
      const mimeAttachments = await loadEmailAttachmentBytes({
        s3: approvalS3(),
        bucket,
        attachments: draftAttachments,
      });
      rawMessage = buildOutboundMime({
        from: commonLedger.from_email,
        to: recipients,
        replyTo: commonLedger.from_email,
        subject,
        messageId: `<${Date.now()}.${Math.random().toString(36).slice(2)}@agents.thinkwork.ai>`,
        text: body,
        attachments: mimeAttachments,
      });
    }
    const result = await input.send(channel.provider as EmailChannelProvider, {
      tenantId: input.inboxItem.tenant_id,
      from: commonLedger.from_email,
      to: recipients,
      subject,
      ...(rawMessage ? { rawMessage } : { text: body }),
    });
    await input.db
      .update(emailConversations)
      .set({
        status: "approved",
        approved_at: sql`now()`,
        approved_by_user_id: input.actorId,
        last_message_at: sql`now()`,
        updated_at: sql`now()`,
      })
      .where(eq(emailConversations.id, conversationId));
    await input.db.insert(emailLedgerEvents).values({
      ...commonLedger,
      event_type: "send_succeeded",
      provider_message_id: result.providerMessageId,
      metadata: { provider: result.provider, status: result.status },
    });
    return { sent: true, providerMessageId: result.providerMessageId };
  } catch (err) {
    await input.db.insert(emailLedgerEvents).values({
      ...commonLedger,
      event_type: "send_failed",
      reason_code: "provider_send_failed",
      metadata: {
        message: err instanceof Error ? err.message : "Unknown provider error",
      },
    });
    throw err;
  }
}

let approvalS3Client: S3Client | null = null;
function approvalS3(): S3Client {
  approvalS3Client ??= new S3Client({});
  return approvalS3Client;
}

function attachmentArray(value: unknown): ResolvedEmailAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = recordValue(item);
    const attachmentId = textValue(record.attachmentId);
    const s3Key = textValue(record.s3Key);
    if (!attachmentId || !s3Key) return [];
    return [
      {
        attachmentId,
        s3Key,
        name: textValue(record.name) ?? "attachment",
        contentType:
          textValue(record.contentType) ?? "application/octet-stream",
        sizeBytes: typeof record.sizeBytes === "number" ? record.sizeBytes : 0,
      },
    ];
  });
}

function conversationParticipantHash(recipients: string[]): string {
  return contentHash(normalizeRecipientList(recipients).join(","));
}

function contentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") return normalizeRecipientList(value);
  return [];
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRecipientList(value: unknown): string[] {
  return (Array.isArray(value) ? value : String(value).split(","))
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean)
    .sort();
}
