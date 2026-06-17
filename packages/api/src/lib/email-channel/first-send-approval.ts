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

type Db = Pick<Database, "select" | "insert" | "update">;

type EmailSendFunction = (
  provider: EmailChannelProvider,
  input: {
    tenantId?: string;
    from: string;
    to: string[];
    subject: string;
    text: string;
  },
) => Promise<EmailProviderSendResult>;

export interface EmailDraftApprovalInput {
  db: Db;
  tenantId: string;
  providerInstallId: string;
  provider: EmailChannelProvider;
  agentId: string;
  spaceId?: string | null;
  threadId?: string | null;
  from: string;
  to: string[];
  subject: string;
  body: string;
}

export async function requestFirstSendApproval(
  input: EmailDraftApprovalInput,
): Promise<{
  status: "pending_review" | "send";
  conversationId: string;
  inboxItemId?: string;
}> {
  const participantHash = conversationParticipantHash(input.to);
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

  const [conversation] = await input.db
    .insert(emailConversations)
    .values({
      tenant_id: input.tenantId,
      space_id: input.spaceId ?? null,
      thread_id: input.threadId ?? null,
      provider_install_id: input.providerInstallId,
      subject: input.subject,
      status: "pending_approval",
      participant_hash: participantHash,
      metadata: {
        from: input.from,
        to: input.to,
        firstSendReviewRequired: true,
      },
    })
    .returning();

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
      type: "computer_approval",
      title: `Review email to ${input.to.join(", ")}`,
      description:
        "First outbound email in this conversation requires human review.",
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
    const result = await input.send(channel.provider as EmailChannelProvider, {
      tenantId: input.inboxItem.tenant_id,
      from: commonLedger.from_email,
      to: recipients,
      subject,
      text: body,
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
