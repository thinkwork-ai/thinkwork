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

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { eq, and } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  agentCapabilities,
  emailReplyTokens,
} from "@thinkwork/database-pg/schema";
import { generateReplyToken } from "../lib/email-tokens.js";
import { deriveSpaceAddress } from "../lib/email/space-address.js";
import { validateTemplateSendEmail } from "../lib/templates/send-email-config.js";
import { renderForEmail } from "../lib/channel-rendering/email-renderer.js";

const THINKWORK_API_SECRET =
  process.env.THINKWORK_API_SECRET || process.env.API_AUTH_SECRET || "";

const db = getDb();

interface SendEmailRequest {
  agentId: string;
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
}

interface DirectSendEmailRequest {
  tenantId?: string;
  routineId?: string;
  executionId?: string;
  to?: string[] | string;
  cc?: string[] | string;
  subject?: string;
  body?: string;
  bodyFormat?: "text" | "html" | "markdown";
  source?: string;
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
  if (bearer && bearer === THINKWORK_API_SECRET) {
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

  // Build raw MIME email
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@agents.thinkwork.ai>`;

  const rawHeaders = [
    `From: ${emailAddress}`,
    `To: ${recipients.join(", ")}`,
    `Reply-To: ${emailAddress}`,
    `Subject: ${req.subject}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `X-Thinkwork-Reply-Token: ${token}`,
  ];

  if (req.inReplyTo) {
    const replyId = req.inReplyTo.includes("<")
      ? req.inReplyTo
      : `<${req.inReplyTo}>`;
    rawHeaders.push(`In-Reply-To: ${replyId}`);
    rawHeaders.push(`References: ${replyId}`);
  }

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
  const boundary = `thinkwork-alt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  rawHeaders.push(
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  );

  const rawMessage = [
    ...rawHeaders,
    "",
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    "",
    rendered.text,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    "",
    rendered.html,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  // Send via SES
  try {
    const { SESClient, SendRawEmailCommand } =
      await import("@aws-sdk/client-ses");
    const ses = new SESClient({});

    const result = await ses.send(
      new SendRawEmailCommand({
        Source: emailAddress,
        Destinations: recipients,
        RawMessage: {
          Data: Buffer.from(rawMessage),
        },
      }),
    );

    const sesMessageId = result.MessageId || "";

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
    console.error("[email-send] SES send failed:", sendErr);
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

async function sendDirectRoutineEmail(req: DirectSendEmailRequest) {
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

  const { SESClient, SendEmailCommand } = await import("@aws-sdk/client-ses");
  const ses = new SESClient({});
  const rendered = req.bodyFormat === "markdown" ? renderForEmail(body) : null;
  const messageBody =
    req.bodyFormat === "html"
      ? { Html: { Data: body, Charset: "UTF-8" } }
      : rendered
        ? {
            Text: { Data: rendered.text, Charset: "UTF-8" },
            Html: { Data: rendered.html, Charset: "UTF-8" },
          }
        : { Text: { Data: body, Charset: "UTF-8" } };

  const result = await ses.send(
    new SendEmailCommand({
      Source: source,
      Destination: {
        ToAddresses: recipients,
        ...(cc.length > 0 ? { CcAddresses: cc } : {}),
      },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: messageBody,
      },
    }),
  );

  return {
    messageId: result.MessageId ?? null,
    status: "sent",
  };
}
