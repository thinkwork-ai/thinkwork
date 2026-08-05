/**
 * Email Send Lambda (PRD-14)
 *
 * Handles outbound email from agents. Generates reply tokens for
 * bidirectional email conversations.
 *
 * Route: POST /api/email/send (API Gateway)
 *
 * Auth: THINKWORK_API_SECRET bearer token (agent runtime → API)
 */

import { getApiAuthSecret, getConfig } from "@thinkwork/runtime-config";
import { S3Client } from "@aws-sdk/client-s3";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { eq, and } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  agentCapabilities,
  emailReplyTokens,
  spaces,
  tenants,
} from "@thinkwork/database-pg/schema";
import { generateReplyToken } from "../lib/email-tokens.js";
import { deriveSpaceAddress } from "../lib/email/space-address.js";
import { validateTemplateSendEmail } from "../lib/templates/send-email-config.js";
import { renderForEmail } from "../lib/channel-rendering/email-renderer.js";
import { createEmailChannelService } from "../lib/email-channel/channel-service.js";
import { requestFirstSendApproval } from "../lib/email-channel/first-send-approval.js";
import { evaluateOutboundEmailPolicy } from "../lib/email-channel/outbound-policy.js";
import { buildOutboundMime } from "../lib/email-channel/outbound-mime.js";
import { withSendLedger } from "../lib/email-channel/ledger.js";
import {
  EmailAttachmentError,
  loadEmailAttachmentBytes,
  resolveEmailAttachments,
  type ResolvedEmailAttachment,
} from "../lib/email-channel/email-attachments.js";

const db = getDb();
const emailChannel = createEmailChannelService();
const s3ForAttachments = new S3Client({});

interface SendEmailRequest {
  agentId: string;
  /** Exact authenticated turn participant supplied by the managed runtime. */
  requestingUserId?: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  spaceTenantSlug?: string;
  spaceSlug?: string;
  activeSpaceTenantSlug?: string;
  activeSpaceSlug?: string;
  inReplyTo?: string;
  quotedFrom?: string;
  quotedBody?: string;
  /** thread_attachments row ids to attach (tenant-validated, max 5). */
  attachments?: Array<{ attachmentId?: string; name?: string }>;
}

export interface DirectSendEmailRequest {
  tenantId?: string;
  routineId?: string;
  executionId?: string;
  agentId?: string;
  requestingUserId?: string;
  spaceId?: string;
  threadId?: string;
  to?: string[] | string;
  cc?: string[] | string;
  subject?: string;
  body?: string;
  bodyFormat?: "text" | "html" | "markdown";
  source?: string;
  idempotencyKey?: string;
}

function isHttpEvent(event: unknown): event is APIGatewayProxyEventV2 {
  return (
    typeof event === "object" &&
    event !== null &&
    "requestContext" in event &&
    "headers" in event
  );
}

function parseRecipients(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

// Minimal RFC-ish email shape check: a local part, "@", and a dotted domain.
// SES rejects malformed addresses with an opaque 400 ("Missing final '@domain'")
// that surfaces to the agent as a generic "server error". Validating here turns
// that into an actionable message and never hands SES garbage (e.g. an
// unresolved "me" or a bare name that slipped through the tool).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Return the first address that is not a well-formed email, or undefined. */
function findInvalidEmail(addresses: string[]): string | undefined {
  return addresses.find((address) => !EMAIL_PATTERN.test(address));
}

export async function handler(
  event: APIGatewayProxyEventV2 | DirectSendEmailRequest = {},
) {
  if (!isHttpEvent(event)) {
    return sendDirectRoutineEmail(event);
  }

  // Auth — service secret from the managed cloud runtime.
  const authHeader = event.headers?.authorization || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (bearer && bearer === getApiAuthSecret()) {
    // service-authed: trust the request body's agentId (existing behavior).
  } else {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  if (event.requestContext.http.method !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  let req: SendEmailRequest;
  try {
    req = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  if (!req.agentId || !req.to || !req.subject || !req.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Missing required fields: agentId, to, subject, body",
      }),
    };
  }

  // Validate agentId is a UUID (not a slug or literal "$AGENT_ID")
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(req.agentId)) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: `Invalid agentId: "${req.agentId}" is not a valid UUID. Use the $AGENT_ID environment variable.`,
      }),
    };
  }

  // Validate recipient count (max 5)
  const recipients = parseRecipients(req.to);
  if (recipients.length > 5) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Maximum 5 recipients per email" }),
    };
  }
  const invalidRecipient = findInvalidEmail(recipients);
  if (invalidRecipient) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: `Recipient "${invalidRecipient}" is not a valid email address. Provide a full address like name@example.com.`,
      }),
    };
  }

  // Look up agent
  const [agent] = await db
    .select({
      id: agents.id,
      tenant_id: agents.tenant_id,
      send_email: agents.send_email,
    })
    .from(agents)
    .where(eq(agents.id, req.agentId));

  if (!agent) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "Agent not found" }),
    };
  }

  const sendEmailResult = validateTemplateSendEmail(agent.send_email);
  const sendEmailEnabled = sendEmailResult.ok
    ? sendEmailResult.value?.enabled === true
    : false;
  if (!sendEmailEnabled) {
    return {
      statusCode: 403,
      body: JSON.stringify({
        error: "Send Email not enabled for this agent",
      }),
    };
  }

  // Legacy capability rows no longer gate Send Email. The runtime config and
  // Space tool policy decide whether the tool is injected, but older rows may
  // still carry reply-token limits that this endpoint should honor.
  const [emailCap] = await db
    .select()
    .from(agentCapabilities)
    .where(
      and(
        eq(agentCapabilities.agent_id, agent.id),
        eq(agentCapabilities.capability, "email_channel"),
      ),
    );

  const config =
    emailCap && emailCap.enabled !== false
      ? (emailCap.config as Record<string, unknown>) || {}
      : {};
  let spaceAddress: string | null;
  try {
    spaceAddress = deriveSpaceAddressFromRequest(req);
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error:
          err instanceof Error
            ? err.message
            : "Invalid Space email address context",
      }),
    };
  }
  if (!spaceAddress) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error:
          "Active Space email context is required. Provide spaceTenantSlug and spaceSlug.",
      }),
    };
  }
  const emailAddress = spaceAddress;

  // Resolve the Space row so the outbound policy can consult the Space
  // email policy — passing null here would skip a Space-level disable.
  const spaceSlugFromReq = req.spaceSlug || req.activeSpaceSlug || "";
  const [spaceRow] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.tenant_id, agent.tenant_id),
        eq(spaces.slug, spaceSlugFromReq),
      ),
    );
  const spaceId = spaceRow?.id ?? null;

  const maxReplyTokenAgeDays = (config.maxReplyTokenAgeDays as number) || 7;
  const maxReplyTokenUses = (config.maxReplyTokenUses as number) || 3;

  // Generate reply token
  const contextId = req.threadId || agent.id;
  const contextType = "thread" as const;
  const expiresAt = new Date(
    Date.now() + maxReplyTokenAgeDays * 24 * 60 * 60 * 1000,
  );

  const { token, tokenHash } = generateReplyToken({
    agentId: agent.id,
    contextId,
    contextType,
    expiresAt,
  });

  // Resolve attachment refs before the approval gate so a bad ref fails
  // fast and the approval draft records exactly what will be attached.
  let resolvedAttachments: ResolvedEmailAttachment[] = [];
  try {
    resolvedAttachments = await resolveEmailAttachments({
      db,
      tenantId: agent.tenant_id,
      refs: (req.attachments ?? [])
        .map((ref) => ({
          attachmentId: String(ref?.attachmentId ?? "").trim(),
          name: ref?.name ? String(ref.name) : undefined,
        }))
        .filter((ref) => ref.attachmentId),
    });
  } catch (err) {
    if (err instanceof EmailAttachmentError) {
      return { statusCode: 400, body: JSON.stringify({ error: err.message }) };
    }
    throw err;
  }

  // Build raw MIME email
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@agents.thinkwork.ai>`;

  // Build full body: agent reply + quoted original thread
  let fullBody = req.body;
  if (req.inReplyTo && req.quotedBody) {
    const quoted = req.quotedBody
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const from = req.quotedFrom || "unknown";
    fullBody += `\n\nOn ${new Date().toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })}, ${from} wrote:\n${quoted}`;
  }

  const rendered = renderForEmail(fullBody);
  const mimeAttachments =
    resolvedAttachments.length > 0
      ? await loadEmailAttachmentBytes({
          s3: s3ForAttachments,
          bucket: getConfig("WORKSPACE_BUCKET") || "",
          attachments: resolvedAttachments,
        })
      : [];
  const rawMessage = buildOutboundMime({
    from: emailAddress,
    to: recipients,
    replyTo: emailAddress,
    subject: req.subject,
    messageId,
    extraHeaders: [`X-Thinkwork-Reply-Token: ${token}`],
    inReplyTo: req.inReplyTo,
    text: rendered.text,
    html: rendered.html,
    attachments: mimeAttachments,
  });

  const policy = await evaluateOutboundEmailPolicy({
    db,
    tenantId: agent.tenant_id,
    spaceId,
  });
  if (!policy.allowed) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        status: "blocked",
        reasonCode: policy.reasonCode,
        error: policy.message,
      }),
    };
  }
  // Non-null when review was skipped because this recipient set is already
  // approved somewhere in the tenant — the "fast path".
  let approvedConversationId: string | null = null;
  if (policy.firstSendReviewRequired) {
    const approval = await requestFirstSendApproval({
      db,
      tenantId: agent.tenant_id,
      providerInstallId: policy.providerInstallId,
      provider: policy.provider,
      agentId: agent.id,
      requestingUserId: req.requestingUserId ?? null,
      spaceId,
      threadId: req.threadId ?? null,
      from: emailAddress,
      to: recipients,
      subject: req.subject,
      body: req.body,
      attachments: resolvedAttachments,
    });
    if (approval.status === "pending_review") {
      return {
        statusCode: 202,
        body: JSON.stringify({
          status: "pending_review",
          conversationId: approval.conversationId,
          inboxItemId: approval.inboxItemId,
          approvalUrl: `/approvals/${approval.inboxItemId}`,
        }),
      };
    }
    approvedConversationId = approval.conversationId;
  }

  try {
    // Every outbound send lands in the ledger, not just reviewed ones
    // (THINK-600) — the fast path used to be audit-invisible.
    const result = await withSendLedger(
      {
        db,
        tenantId: agent.tenant_id,
        conversationId: approvedConversationId,
        spaceId,
        threadId: req.threadId ?? null,
        providerInstallId: policy.providerInstallId,
        subject: req.subject,
        fromEmail: emailAddress,
        toEmails: recipients,
        source: approvedConversationId
          ? "approved_fast_path"
          : "review_not_required",
      },
      () =>
        emailChannel.send(policy.provider, {
          tenantId: agent.tenant_id,
          from: emailAddress,
          to: recipients,
          subject: req.subject,
          rawMessage,
        }),
    );
    const sesMessageId = result.providerMessageId;

    // Store reply token in DB
    await db.insert(emailReplyTokens).values({
      tenant_id: agent.tenant_id,
      agent_id: agent.id,
      token_hash: tokenHash,
      context_type: contextType,
      context_id: contextId,
      recipient_email: recipients[0],
      ses_message_id: sesMessageId,
      expires_at: expiresAt,
      max_uses: maxReplyTokenUses,
    });

    console.log(
      `[email-send] Sent email from ${emailAddress} to ${recipients.join(", ")} subject="${req.subject}" sesId=${sesMessageId}`,
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        messageId: sesMessageId,
        status: "sent",
      }),
    };
  } catch (sendErr) {
    console.error("[email-send] provider send failed:", sendErr);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to send email" }),
    };
  }
}

function deriveSpaceAddressFromRequest(req: SendEmailRequest): string | null {
  const tenantSlug = req.spaceTenantSlug || req.activeSpaceTenantSlug || "";
  const spaceSlug = req.spaceSlug || req.activeSpaceSlug || "";
  if (!tenantSlug || !spaceSlug) return null;
  return deriveSpaceAddress({ tenantSlug, spaceSlug });
}

export async function sendDirectRoutineEmail(req: DirectSendEmailRequest) {
  const recipients = parseRecipients(req.to);
  const cc = parseRecipients(req.cc);
  const subject = req.subject?.trim() ?? "";
  const body = req.body?.trim() ?? "";
  const source =
    req.source?.trim() ||
    process.env.ROUTINE_EMAIL_SOURCE ||
    "automation@agents.thinkwork.ai";

  if (recipients.length === 0 || !subject || !body) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Missing required fields: to, subject, body",
      }),
    };
  }
  if (recipients.length > 5) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Maximum 5 recipients per email" }),
    };
  }
  const invalidAddress = findInvalidEmail([...recipients, ...cc]);
  if (invalidAddress) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: `Recipient "${invalidAddress}" is not a valid email address.`,
      }),
    };
  }

  if (req.agentId && req.spaceId && req.tenantId) {
    return sendRoutineChannelEmail({
      req,
      recipients,
      cc,
      subject,
      body,
    });
  }

  const rendered = req.bodyFormat === "markdown" ? renderForEmail(body) : null;
  const result = await emailChannel.send("ses", {
    from: source,
    to: recipients,
    cc,
    subject,
    text: rendered
      ? rendered.text
      : req.bodyFormat === "html"
        ? undefined
        : body,
    html: rendered
      ? rendered.html
      : req.bodyFormat === "html"
        ? body
        : undefined,
  });

  return {
    messageId: result.providerMessageId || null,
    status: "sent",
  };
}

async function sendRoutineChannelEmail(input: {
  req: DirectSendEmailRequest;
  recipients: string[];
  cc: string[];
  subject: string;
  body: string;
}) {
  const tenantId = input.req.tenantId!;
  const agentId = input.req.agentId!;
  const spaceId = input.req.spaceId!;
  const [agent] = await db
    .select({
      id: agents.id,
      tenant_id: agents.tenant_id,
      send_email: agents.send_email,
    })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)));
  if (!agent) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "Agent not found" }),
    };
  }
  const sendEmailResult = validateTemplateSendEmail(agent.send_email);
  const sendEmailEnabled = sendEmailResult.ok
    ? sendEmailResult.value?.enabled === true
    : false;
  if (!sendEmailEnabled) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: "Send Email not enabled for this agent" }),
    };
  }

  const [space] = await db
    .select({
      id: spaces.id,
      tenant_id: spaces.tenant_id,
      slug: spaces.slug,
    })
    .from(spaces)
    .where(and(eq(spaces.id, spaceId), eq(spaces.tenant_id, tenantId)));
  if (!space) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "Space not found" }),
    };
  }
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "Tenant email domain not found" }),
    };
  }

  const fromAddress = deriveSpaceAddress({
    tenantSlug: tenant.slug,
    spaceSlug: space.slug,
  });
  const policy = await evaluateOutboundEmailPolicy({
    db,
    tenantId,
    spaceId,
  });
  if (!policy.allowed) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        status: "blocked",
        reasonCode: policy.reasonCode,
        error: policy.message,
      }),
    };
  }
  let approvedConversationId: string | null = null;
  if (policy.firstSendReviewRequired) {
    const approval = await requestFirstSendApproval({
      db,
      tenantId,
      providerInstallId: policy.providerInstallId,
      provider: policy.provider,
      agentId,
      requestingUserId: input.req.requestingUserId ?? null,
      spaceId,
      threadId: input.req.threadId ?? null,
      from: fromAddress,
      to: input.recipients,
      subject: input.subject,
      body: input.body,
    });
    if (approval.status === "pending_review") {
      return {
        statusCode: 202,
        body: JSON.stringify({
          status: "pending_review",
          conversationId: approval.conversationId,
          inboxItemId: approval.inboxItemId,
          approvalUrl: `/approvals/${approval.inboxItemId}`,
        }),
      };
    }
    approvedConversationId = approval.conversationId;
  }

  const rendered =
    input.req.bodyFormat === "markdown" ? renderForEmail(input.body) : null;
  const result = await withSendLedger(
    {
      db,
      tenantId,
      conversationId: approvedConversationId,
      spaceId,
      threadId: input.req.threadId ?? null,
      providerInstallId: policy.providerInstallId,
      subject: input.subject,
      fromEmail: fromAddress,
      toEmails: input.recipients,
      source: approvedConversationId
        ? "approved_fast_path"
        : "review_not_required",
    },
    () =>
      emailChannel.send(policy.provider, {
        tenantId,
        providerInstallId: policy.providerInstallId ?? undefined,
        from: fromAddress,
        to: input.recipients,
        cc: input.cc,
        subject: input.subject,
        idempotencyKey: input.req.idempotencyKey,
        text: rendered
          ? rendered.text
          : input.req.bodyFormat === "html"
            ? undefined
            : input.body,
        html: rendered
          ? rendered.html
          : input.req.bodyFormat === "html"
            ? input.body
            : undefined,
      }),
  );

  return {
    messageId: result.providerMessageId || null,
    status: "sent",
  };
}
