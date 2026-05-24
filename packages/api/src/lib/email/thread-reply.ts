/**
 * Auto-reply emails for cold-contact threads.
 *
 * When a thread originates from an inbound email (cold contact or reply
 * via reply-token), each completed agent turn dispatches the assistant
 * response back to the original sender via SES, so the conversation
 * continues in email even though the agent runs without an explicit
 * send_email tool invocation.
 *
 * The dispatch is best-effort: failures are logged and swallowed by the
 * caller so a SES blip never breaks the agent's in-app message.
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  emailReplyTokens,
  messages,
  spaces,
  tenants,
  threads,
} from "@thinkwork/database-pg/schema";
import { generateReplyToken } from "../email-tokens.js";
import { deriveSpaceAddress } from "./space-address.js";

const db = getDb();

const REPLY_TOKEN_AGE_DAYS = 7;
const REPLY_TOKEN_MAX_USES = 5;

const EMAIL_SOURCES_TRIGGERING_REPLY = new Set([
  "email_cold_contact",
  "email_reply",
]);

export interface SendThreadReplyEmailInput {
  tenantId: string;
  threadId: string;
  agentId: string;
  body: string;
}

export type SendThreadReplyEmailResult =
  | { sent: true; sesMessageId: string }
  | { sent: false; reason: SkipReason };

type SkipReason =
  | "not_email_thread"
  | "last_user_message_not_email"
  | "missing_sender_email"
  | "missing_space_routing"
  | "empty_body";

/**
 * Send the assistant's turn-completion response to the original email
 * sender if the thread was started via email and the latest user
 * message also came via email. Best-effort: callers should treat any
 * thrown error as a soft failure.
 */
export async function sendThreadReplyEmail(
  input: SendThreadReplyEmailInput,
): Promise<SendThreadReplyEmailResult> {
  const body = input.body?.trim();
  if (!body) return { sent: false, reason: "empty_body" };

  const [thread] = await db
    .select({
      id: threads.id,
      space_id: threads.space_id,
      metadata: threads.metadata,
    })
    .from(threads)
    .where(eq(threads.id, input.threadId))
    .limit(1);
  if (!thread) return { sent: false, reason: "not_email_thread" };

  const threadMeta = (thread.metadata ?? {}) as Record<string, unknown>;
  const coldContact = threadMeta.emailColdContact as
    | { senderEmail?: string }
    | undefined;
  if (!coldContact?.senderEmail) {
    return { sent: false, reason: "not_email_thread" };
  }

  const [latestUserMsg] = await db
    .select({ metadata: messages.metadata })
    .from(messages)
    .where(
      and(eq(messages.thread_id, input.threadId), eq(messages.role, "user")),
    )
    .orderBy(desc(messages.created_at))
    .limit(1);

  const userMeta = (latestUserMsg?.metadata ?? {}) as Record<string, unknown>;
  const userSource =
    typeof userMeta.source === "string" ? (userMeta.source as string) : "";
  if (!EMAIL_SOURCES_TRIGGERING_REPLY.has(userSource)) {
    return { sent: false, reason: "last_user_message_not_email" };
  }

  const senderEmail =
    typeof userMeta.senderEmail === "string"
      ? (userMeta.senderEmail as string)
      : coldContact.senderEmail;
  if (!senderEmail) return { sent: false, reason: "missing_sender_email" };

  const subjectFromMessage =
    typeof userMeta.subject === "string" ? (userMeta.subject as string) : "";
  const originalMessageId =
    typeof userMeta.originalMessageId === "string"
      ? (userMeta.originalMessageId as string)
      : "";

  const [routing] = await db
    .select({ spaceSlug: spaces.slug, tenantSlug: tenants.slug })
    .from(spaces)
    .innerJoin(tenants, eq(tenants.id, spaces.tenant_id))
    .where(eq(spaces.id, thread.space_id))
    .limit(1);
  if (!routing?.spaceSlug || !routing?.tenantSlug) {
    return { sent: false, reason: "missing_space_routing" };
  }

  const fromAddress = deriveSpaceAddress({
    tenantSlug: routing.tenantSlug,
    spaceSlug: routing.spaceSlug,
  });
  const subject = formatReplySubject(subjectFromMessage);
  const expiresAt = new Date(
    Date.now() + REPLY_TOKEN_AGE_DAYS * 24 * 60 * 60 * 1000,
  );
  const { token, tokenHash } = generateReplyToken({
    agentId: input.agentId,
    contextId: input.threadId,
    contextType: "thread",
    expiresAt,
  });

  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${routing.tenantSlug}.thinkwork.ai>`;
  const rawHeaders = [
    `From: ${fromAddress}`,
    `To: ${senderEmail}`,
    `Reply-To: ${fromAddress}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `X-Thinkwork-Reply-Token: ${token}`,
  ];
  if (originalMessageId) {
    const normalized = originalMessageId.includes("<")
      ? originalMessageId
      : `<${originalMessageId}>`;
    rawHeaders.push(`In-Reply-To: ${normalized}`);
    rawHeaders.push(`References: ${normalized}`);
  }
  rawHeaders.push(
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 7bit`,
  );

  const rawMessage = [...rawHeaders, "", body].join("\r\n");

  const { SESClient, SendRawEmailCommand } =
    await import("@aws-sdk/client-ses");
  const ses = new SESClient({});
  const result = await ses.send(
    new SendRawEmailCommand({
      Source: fromAddress,
      Destinations: [senderEmail],
      RawMessage: { Data: Buffer.from(rawMessage) },
    }),
  );

  const sesMessageId = result.MessageId || "";
  await db.insert(emailReplyTokens).values({
    tenant_id: input.tenantId,
    agent_id: input.agentId,
    token_hash: tokenHash,
    context_type: "thread",
    context_id: input.threadId,
    recipient_email: senderEmail,
    ses_message_id: sesMessageId,
    expires_at: expiresAt,
    max_uses: REPLY_TOKEN_MAX_USES,
  });

  console.log(
    `[thread-reply] Sent reply from ${fromAddress} to ${senderEmail} thread=${input.threadId} sesId=${sesMessageId}`,
  );
  return { sent: true, sesMessageId };
}

function formatReplySubject(original: string): string {
  const trimmed = original?.trim() || "";
  if (!trimmed) return "Re: Your message";
  return /^re:\s/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}
