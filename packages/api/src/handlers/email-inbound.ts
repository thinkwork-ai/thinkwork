/**
 * Email Inbound Lambda — Security Gateway (PRD-14)
 *
 * Invoked directly by SES receipt rule (not API Gateway).
 * Flow: SES event → parse recipient → validate reply/cold-contact gates →
 *       append to a thread or create a cold-contact Space thread.
 *
 * Security model:
 *   Ring 1: Reply Token — HMAC-signed tokens for agent-initiated conversations
 *   Ring 2: Cold-contact gate — enabled Space + tenant user + private membership
 *   Legacy per-agent addresses get an explicit retirement notice.
 *   Unauthorized Space/reply traffic → silent drop (no bounce = no info leakage)
 */

import { getConfig } from "@thinkwork/runtime-config";
import type { SESEvent } from "aws-lambda";
import { eq, and, gte, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  agentCapabilities,
  agentWakeupRequests,
  emailReplyTokens,
  messages,
  spaceMembers,
  spaces,
  tenants,
  threads,
  users,
} from "@thinkwork/database-pg/schema";
import { verifyReplyToken, hashToken } from "../lib/email-tokens.js";
import { createColdContactThread } from "../lib/email/cold-contact-trigger.js";
import { parseSpaceRecipient } from "../lib/email/space-address.js";
import { validateTemplateSendEmail } from "../lib/templates/send-email-config.js";

function workspaceBucket(): string {
  return (
    process.env.EMAIL_INBOUND_BUCKET || getConfig("WORKSPACE_BUCKET") || ""
  );
}

const db = getDb();

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function handler(event: SESEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (err) {
      console.error("[email-inbound] Error processing record:", err);
    }
  }
}

async function processRecord(record: SESEvent["Records"][0]): Promise<void> {
  const sesNotification = record.ses;
  const mail = sesNotification.mail;
  const sesMessageId = mail.messageId;

  const recipient = parseThinkworkRecipient(sesNotification.receipt.recipients);
  if (!recipient) return;

  const senderEmail = extractEmailAddress(mail.source || "");
  if (!senderEmail) {
    console.log("[email-inbound] No sender, dropping");
    return;
  }

  const parsedEmail = await fetchEmailBody(mail, sesMessageId);
  const replyTokenHeader = getHeader(mail, "x-thinkwork-reply-token");
  const inReplyTo = parsedEmail.inReplyTo || getHeader(mail, "in-reply-to");
  const spaceAddress = parseSpaceRecipient(recipient.recipientEmail);

  let inReplyToRoute: Awaited<ReturnType<typeof consumeTokenByInReplyTo>>;
  try {
    inReplyToRoute = await consumeTokenByInReplyTo(inReplyTo, senderEmail);
  } catch (err) {
    if (err instanceof InvalidReplyTokenError) return;
    throw err;
  }
  let headerRoute: Awaited<ReturnType<typeof verifyAndConsumeToken>> = null;
  if (spaceAddress && !inReplyToRoute && replyTokenHeader) {
    headerRoute = await verifyAndConsumeToken(
      replyTokenHeader,
      undefined,
      senderEmail,
    );
    if (!headerRoute) {
      console.log(
        `[email-inbound] reply_rejected:invalid_header_token sender=${senderEmail}`,
      );
      return;
    }
  }
  const replyRoute = inReplyToRoute || headerRoute;
  if (replyRoute) {
    if (
      replyRoute.contextType === "thread" &&
      (await appendReplyToThread({
        threadId: replyRoute.contextId,
        senderEmail,
        sesMessageId,
        subject: parsedEmail.subject,
        textBody: parsedEmail.textBody,
        originalMessageId: parsedEmail.originalMessageId,
      }))
    ) {
      return;
    }

    await enqueueReplyWakeup({
      agentId: replyRoute.agentId,
      senderEmail,
      sesMessageId,
      subject: parsedEmail.subject,
      textBody: parsedEmail.textBody,
      s3Key: parsedEmail.s3Key,
      originalMessageId: parsedEmail.originalMessageId,
      replyTokenContextId: replyRoute.contextId,
      replyTokenContextType: replyRoute.contextType,
      isAllowlisted: false,
    });
    return;
  }

  if (spaceAddress) {
    await processColdContact({
      ...spaceAddress,
      senderEmail,
      sesMessageId,
      subject: parsedEmail.subject,
      textBody: parsedEmail.textBody,
      originalMessageId: parsedEmail.originalMessageId,
    });
    return;
  }

  await sendLegacyAddressRetirementNotice({
    recipientEmail: recipient.recipientEmail,
    senderEmail,
    subject: parsedEmail.subject,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseThinkworkRecipient(recipients: string[] | undefined) {
  if (!recipients || recipients.length === 0) {
    console.log("[email-inbound] No recipients, dropping");
    return null;
  }

  const recipientEmail = recipients[0].toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.thinkwork\.ai$/.test(recipientEmail)) {
    console.log(
      `[email-inbound] Non-thinkwork.ai recipient: ${recipientEmail}, dropping`,
    );
    return null;
  }

  return { recipientEmail };
}

function getHeader(
  mail: SESEvent["Records"][0]["ses"]["mail"],
  name: string,
): string {
  return (
    mail.headers?.find(
      (h: { name: string; value: string }) =>
        h.name.toLowerCase() === name.toLowerCase(),
    )?.value || ""
  );
}

function extractEmailAddress(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const angleMatch = trimmed.match(/<([^>]+)>/);
  return (angleMatch?.[1] || trimmed).trim().toLowerCase();
}

async function fetchEmailBody(
  mail: SESEvent["Records"][0]["ses"]["mail"],
  sesMessageId: string,
) {
  const s3Key = `email/inbound/${sesMessageId}`;
  let subject = "";
  let textBody = "";
  let originalMessageId = "";
  let inReplyTo = "";

  try {
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({});
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: workspaceBucket(),
        Key: s3Key,
      }),
    );
    const rawEmail = await obj.Body?.transformToString();

    if (rawEmail) {
      const { simpleParser } = await import("mailparser");
      const parsed = await simpleParser(rawEmail);
      subject = parsed.subject || "";
      textBody = parsed.text || "";
      originalMessageId = parsed.messageId || "";
      inReplyTo = typeof parsed.inReplyTo === "string" ? parsed.inReplyTo : "";
    }
  } catch (parseErr) {
    console.error("[email-inbound] Failed to parse email from S3:", parseErr);
    subject = getHeader(mail, "subject") || "(no subject)";
    originalMessageId = getHeader(mail, "message-id");
    inReplyTo = getHeader(mail, "in-reply-to");
  }

  if (textBody.length > 10000) {
    textBody =
      textBody.slice(0, 10000) +
      "\n\n[... truncated — email body exceeds 10,000 characters]";
  }

  return { s3Key, subject, textBody, originalMessageId, inReplyTo };
}

async function sendLegacyAddressRetirementNotice(input: {
  recipientEmail: string;
  senderEmail: string;
  subject: string;
}) {
  console.log(
    `[email-inbound] legacy_agent_address_retired recipient=${input.recipientEmail} sender=${input.senderEmail}`,
  );
  try {
    const { SESClient, SendEmailCommand } = await import("@aws-sdk/client-ses");
    const ses = new SESClient({});
    await ses.send(
      new SendEmailCommand({
        Source: "noreply@agents.thinkwork.ai",
        Destination: { ToAddresses: [input.senderEmail] },
        Message: {
          Subject: {
            Data: "This Thinkwork agent email address has changed",
            Charset: "UTF-8",
          },
          Body: {
            Text: {
              Data: [
                `Your email to ${input.recipientEmail} was not delivered.`,
                "",
                "Thinkwork agent email addresses now use Space addresses in the form:",
                "space-slug@tenant-slug.thinkwork.ai",
                "",
                "Please contact the recipient for the current Space email address and resend your message there.",
                "",
                input.subject ? `Original subject: ${input.subject}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              Charset: "UTF-8",
            },
          },
        },
      }),
    );
  } catch (err) {
    console.error(
      "[email-inbound] Failed to send legacy-address retirement notice:",
      err,
    );
  }
}

async function processColdContact(input: {
  tenantSlug: string;
  spaceSlug: string;
  senderEmail: string;
  sesMessageId: string;
  subject: string;
  textBody: string;
  originalMessageId: string;
}) {
  const [space] = await db
    .select({
      tenantId: tenants.id,
      spaceId: spaces.id,
      accessMode: spaces.access_mode,
      status: spaces.status,
      emailTriggerStatus: spaces.email_trigger_status,
    })
    .from(tenants)
    .innerJoin(
      spaces,
      and(eq(spaces.tenant_id, tenants.id), eq(spaces.slug, input.spaceSlug)),
    )
    .where(eq(tenants.slug, input.tenantSlug))
    .limit(1);

  if (!space || space.status === "archived") {
    logColdContactReject("space_not_found", input);
    return;
  }
  if (space.emailTriggerStatus !== "enabled") {
    logColdContactReject("triggers_disabled", input);
    return;
  }

  const [sender] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenant_id, space.tenantId),
        sql`lower(${users.email}) = ${input.senderEmail}`,
      ),
    )
    .limit(1);
  if (!sender) {
    logColdContactReject("sender_not_registered", input);
    return;
  }

  if (space.accessMode === "private") {
    const [member] = await db
      .select({ id: spaceMembers.id })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.tenant_id, space.tenantId),
          eq(spaceMembers.space_id, space.spaceId),
          eq(spaceMembers.user_id, sender.id),
        ),
      )
      .limit(1);
    if (!member) {
      logColdContactReject("not_space_member", input);
      return;
    }
  }

  const thread = await createColdContactThread({
    tenantId: space.tenantId,
    spaceId: space.spaceId,
    senderUserId: sender.id,
    senderEmail: input.senderEmail,
    emailSubject: input.subject,
    emailBody: input.textBody,
    sesMessageId: input.sesMessageId,
    originalMessageId: input.originalMessageId,
  });
  console.log(
    `[email-inbound] cold_contact_thread_created tenant=${input.tenantSlug} space=${input.spaceSlug} sender=${input.senderEmail} thread=${thread.threadId}`,
  );
}

async function appendReplyToThread(input: {
  threadId: string;
  senderEmail: string;
  sesMessageId: string;
  subject: string;
  textBody: string;
  originalMessageId: string;
}) {
  const [thread] = await db
    .select({
      tenant_id: threads.tenant_id,
      space_id: threads.space_id,
    })
    .from(threads)
    .where(eq(threads.id, input.threadId))
    .limit(1);

  if (!thread) {
    console.log(
      `[email-inbound] reply_rejected:thread_not_found thread=${input.threadId}`,
    );
    return true;
  }

  const [sender] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenant_id, thread.tenant_id),
        sql`lower(${users.email}) = ${input.senderEmail}`,
      ),
    )
    .limit(1);

  const createdAt = new Date();
  const [message] = await db
    .insert(messages)
    .values({
      tenant_id: thread.tenant_id,
      thread_id: input.threadId,
      role: "user",
      content: input.textBody || "(empty email)",
      sender_type: "user",
      sender_id: sender?.id ?? null,
      metadata: {
        source: "email_reply",
        senderEmail: input.senderEmail,
        subject: input.subject,
        sesMessageId: input.sesMessageId,
        originalMessageId: input.originalMessageId || null,
      },
      created_at: createdAt,
    })
    .returning({ id: messages.id });

  if (!message) throw new Error("Email reply message insert failed");

  await db
    .update(threads)
    .set({ updated_at: createdAt })
    .where(eq(threads.id, input.threadId));

  console.log(
    `[email-inbound] reply_thread_recorded thread=${input.threadId} sender=${input.senderEmail} subject="${input.subject}"`,
  );
  return true;
}

async function resolveAgentById(agentId: string) {
  const [agent] = await db
    .select({
      id: agents.id,
      tenant_id: agents.tenant_id,
      name: agents.name,
      slug: agents.slug,
      send_email: agents.send_email,
    })
    .from(agents)
    .where(eq(agents.id, agentId));
  return agent ?? null;
}

async function resolveLegacyEmailCapability(agentId: string) {
  const [emailCap] = await db
    .select()
    .from(agentCapabilities)
    .where(
      and(
        eq(agentCapabilities.agent_id, agentId),
        eq(agentCapabilities.capability, "email_channel"),
      ),
    );
  return emailCap ?? null;
}

async function enqueueReplyWakeup(input: {
  agentId: string;
  senderEmail: string;
  sesMessageId: string;
  subject: string;
  textBody: string;
  s3Key: string;
  originalMessageId: string;
  replyTokenContextId: string;
  replyTokenContextType: string;
  isAllowlisted: boolean;
}) {
  const agent = await resolveAgentById(input.agentId);
  if (!agent) {
    console.log(
      `[email-inbound] reply_rejected:agent_not_found agent=${input.agentId}`,
    );
    return;
  }
  const sendEmailResult = validateTemplateSendEmail(agent.send_email);
  const sendEmailEnabled = sendEmailResult.ok
    ? sendEmailResult.value?.enabled === true
    : false;
  if (!sendEmailEnabled) {
    console.log(
      `[email-inbound] reply_rejected:email_disabled agent=${agent.id}`,
    );
    return;
  }
  const emailCap = await resolveLegacyEmailCapability(agent.id);
  const config =
    emailCap && emailCap.enabled !== false
      ? (emailCap.config as Record<string, unknown>) || {}
      : {};
  if (!(await checkWakeupRateLimit(agent.id, agent.tenant_id, config))) return;

  await insertWakeupRequest({
    tenantId: agent.tenant_id,
    agentId: agent.id,
    senderEmail: input.senderEmail,
    sesMessageId: input.sesMessageId,
    subject: input.subject,
    textBody: input.textBody,
    s3Key: input.s3Key,
    originalMessageId: input.originalMessageId,
    replyTokenContextId: input.replyTokenContextId,
    replyTokenContextType: input.replyTokenContextType,
    isAllowlisted: input.isAllowlisted,
  });
}

async function checkWakeupRateLimit(
  agentId: string,
  tenantId: string,
  config: Record<string, unknown>,
) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [rateCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.agent_id, agentId),
        eq(agentWakeupRequests.source, "email_received"),
        gte(agentWakeupRequests.created_at, oneHourAgo),
      ),
    );

  const agentRateLimit = (config.rateLimitPerHour as number) || 50;
  if ((rateCount?.count || 0) >= agentRateLimit) {
    console.log(
      `[email-inbound] Rate limit hit for agent ${agentId}: ${rateCount?.count}/${agentRateLimit}/hour`,
    );
    return false;
  }

  const [tenantRateCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.tenant_id, tenantId),
        eq(agentWakeupRequests.source, "email_received"),
        gte(agentWakeupRequests.created_at, oneHourAgo),
      ),
    );

  if ((tenantRateCount?.count || 0) >= 200) {
    console.log(
      `[email-inbound] Tenant rate limit hit for tenant ${tenantId}: ${tenantRateCount?.count}/200/hour`,
    );
    return false;
  }
  return true;
}

async function insertWakeupRequest(input: {
  tenantId: string;
  agentId: string;
  senderEmail: string;
  sesMessageId: string;
  subject: string;
  textBody: string;
  s3Key: string;
  originalMessageId: string;
  replyTokenContextId: string | null;
  replyTokenContextType: string | null;
  isAllowlisted: boolean;
}) {
  const idempotencyKey = `email:${input.sesMessageId}`;
  try {
    await db.insert(agentWakeupRequests).values({
      tenant_id: input.tenantId,
      agent_id: input.agentId,
      source: "email_received",
      trigger_detail: `email:${input.sesMessageId}`,
      reason: `Email from ${input.senderEmail}: ${input.subject}`,
      idempotency_key: idempotencyKey,
      payload: {
        from: input.senderEmail,
        subject: input.subject,
        body: input.textBody,
        s3Key: input.s3Key,
        sesMessageId: input.sesMessageId,
        originalMessageId: input.originalMessageId,
        replyTokenContextId: input.replyTokenContextId,
        replyTokenContextType: input.replyTokenContextType,
        isFromAllowlist: input.isAllowlisted,
      },
      status: "queued",
    });

    console.log(
      `[email-inbound] Enqueued wakeup for agent=${input.agentId} from=${input.senderEmail} subject="${input.subject}"`,
    );
  } catch (insertErr: unknown) {
    if (
      insertErr instanceof Error &&
      insertErr.message.includes("idempotency")
    ) {
      console.log(
        `[email-inbound] Duplicate email ${input.sesMessageId}, skipping`,
      );
      return;
    }
    throw insertErr;
  }
}

function logColdContactReject(
  reason: string,
  input: {
    tenantSlug: string;
    spaceSlug: string;
    senderEmail: string;
    sesMessageId: string;
  },
) {
  console.log(
    `[email-inbound] cold_contact_rejected:${reason} tenant=${input.tenantSlug} space=${input.spaceSlug} sender=${input.senderEmail} ses=${input.sesMessageId}`,
  );
}

/**
 * Verify a reply token and increment its use count.
 * Returns context info if valid, null otherwise.
 */
async function verifyAndConsumeToken(
  tokenValue: string,
  agentId?: string,
  senderEmail?: string,
): Promise<{
  agentId: string;
  contextId: string;
  contextType: string;
} | null> {
  const payload = verifyReplyToken(tokenValue);
  if (!payload) return null;

  if (agentId && payload.agentId !== agentId) return null;

  const tokenHash = hashToken(tokenValue);
  const [tokenRow] = await db
    .select()
    .from(emailReplyTokens)
    .where(eq(emailReplyTokens.token_hash, tokenHash));

  if (!tokenRow) return null;
  if (!isTokenRowValid(tokenRow, senderEmail)) return null;

  await consumeTokenRow(tokenRow);

  return {
    agentId: tokenRow.agent_id,
    contextId: payload.contextId,
    contextType: payload.contextType,
  };
}

async function consumeTokenByInReplyTo(
  inReplyTo: string,
  senderEmail: string,
): Promise<{
  agentId: string;
  contextId: string;
  contextType: string;
} | null> {
  const messageIds = normalizeMessageIdCandidates(inReplyTo);
  for (const messageId of messageIds) {
    const [tokenRow] = await db
      .select()
      .from(emailReplyTokens)
      .where(eq(emailReplyTokens.ses_message_id, messageId));
    if (!tokenRow) continue;
    if (!isTokenRowValid(tokenRow, senderEmail)) {
      console.log(
        `[email-inbound] reply_rejected:${replyTokenRejectReason(tokenRow, senderEmail)} sesMessageId=${messageId}`,
      );
      throw new InvalidReplyTokenError();
    }
    await consumeTokenRow(tokenRow);
    return {
      agentId: tokenRow.agent_id,
      contextId: tokenRow.context_id,
      contextType: tokenRow.context_type,
    };
  }
  return null;
}

class InvalidReplyTokenError extends Error {}

function normalizeMessageIdCandidates(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const withoutAngles = trimmed.replace(/^<|>$/g, "");
  return Array.from(new Set([trimmed, withoutAngles, `<${withoutAngles}>`]));
}

function isTokenRowValid(
  tokenRow: typeof emailReplyTokens.$inferSelect,
  senderEmail?: string,
) {
  return !replyTokenRejectReason(tokenRow, senderEmail);
}

function replyTokenRejectReason(
  tokenRow: typeof emailReplyTokens.$inferSelect,
  senderEmail?: string,
) {
  if (
    senderEmail &&
    tokenRow.recipient_email.toLowerCase() !== senderEmail.toLowerCase()
  ) {
    return "sender_mismatch";
  }
  if (tokenRow.use_count >= tokenRow.max_uses) return "exhausted";
  if (tokenRow.expires_at < new Date()) return "expired";
  return "";
}

async function consumeTokenRow(tokenRow: typeof emailReplyTokens.$inferSelect) {
  await db
    .update(emailReplyTokens)
    .set({
      use_count: sql`${emailReplyTokens.use_count} + 1`,
      consumed_at:
        tokenRow.use_count + 1 >= tokenRow.max_uses ? new Date() : undefined,
    })
    .where(eq(emailReplyTokens.id, tokenRow.id));
}
