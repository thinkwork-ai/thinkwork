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

const THINKWORK_API_SECRET = process.env.THINKWORK_API_SECRET || "";

const db = getDb();

interface SendEmailRequest {
	agentId: string;
	to: string;
	subject: string;
	body: string;
	threadId?: string;
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

export async function handler(
	event: APIGatewayProxyEventV2 | DirectSendEmailRequest = {},
) {
	if (!isHttpEvent(event)) {
		return sendDirectRoutineEmail(event);
	}

	// Auth
	const authHeader = event.headers?.authorization || "";
	if (!authHeader.startsWith("Bearer ") || authHeader.slice(7) !== THINKWORK_API_SECRET) {
		return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
	}

	if (event.requestContext.http.method !== "POST") {
		return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
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
			body: JSON.stringify({ error: "Missing required fields: agentId, to, subject, body" }),
		};
	}

	// Validate agentId is a UUID (not a slug or literal "$AGENT_ID")
	const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if (!uuidPattern.test(req.agentId)) {
		return {
			statusCode: 400,
			body: JSON.stringify({ error: `Invalid agentId: "${req.agentId}" is not a valid UUID. Use the $AGENT_ID environment variable.` }),
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

	// Look up agent
	const [agent] = await db
		.select({
			id: agents.id,
			tenant_id: agents.tenant_id,
			slug: agents.slug,
		})
		.from(agents)
		.where(eq(agents.id, req.agentId));

	if (!agent) {
		return { statusCode: 404, body: JSON.stringify({ error: "Agent not found" }) };
	}

	// Look up email capability
	const [emailCap] = await db
		.select()
		.from(agentCapabilities)
		.where(
			and(
				eq(agentCapabilities.agent_id, agent.id),
				eq(agentCapabilities.capability, "email_channel"),
			),
		);

	if (!emailCap || !emailCap.enabled) {
		return {
			statusCode: 403,
			body: JSON.stringify({ error: "Email channel not enabled for this agent" }),
		};
	}

	const config = (emailCap.config as Record<string, unknown>) || {};
	const vanityAddress = config.vanityAddress ? `${config.vanityAddress}@agents.thinkwork.ai` : null;
	const emailAddress = vanityAddress || (config.emailAddress as string) || `${agent.slug}@agents.thinkwork.ai`;
	const maxReplyTokenAgeDays = (config.maxReplyTokenAgeDays as number) || 7;
	const maxReplyTokenUses = (config.maxReplyTokenUses as number) || 3;

	// Generate reply token
	const contextId = req.threadId || agent.id;
	const contextType = "thread" as const;
	const expiresAt = new Date(Date.now() + maxReplyTokenAgeDays * 24 * 60 * 60 * 1000);

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
		const replyId = req.inReplyTo.includes("<") ? req.inReplyTo : `<${req.inReplyTo}>`;
		rawHeaders.push(`In-Reply-To: ${replyId}`);
		rawHeaders.push(`References: ${replyId}`);
	}

	rawHeaders.push(
		`Content-Type: text/plain; charset=UTF-8`,
		`Content-Transfer-Encoding: 7bit`,
	);

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

	const rawMessage = [...rawHeaders, "", fullBody].join("\r\n");

	// Send via SES
	try {
		const { SESClient, SendRawEmailCommand } = await import("@aws-sdk/client-ses");
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

	const { SESClient, SendEmailCommand } = await import("@aws-sdk/client-ses");
	const ses = new SESClient({});
	const messageBody =
		req.bodyFormat === "html"
			? { Html: { Data: body, Charset: "UTF-8" } }
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
