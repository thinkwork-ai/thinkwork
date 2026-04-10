/**
 * Email Inbound Lambda — Security Gateway (PRD-14)
 *
 * Invoked directly by SES receipt rule (not API Gateway).
 * Flow: SES event → parse recipient → look up agent → security checks →
 *       parse email from S3 → enqueue wakeup request.
 *
 * Security model:
 *   Ring 1: Allowlist — only pre-approved senders pass
 *   Ring 2: Reply Token — HMAC-signed tokens for agent-initiated conversations
 *   Ring 3: Rate Limit — per-agent/tenant hourly limits
 *   Unauthorized → silent drop (no bounce = no info leakage)
 */

import type { SESEvent } from "aws-lambda";
import { eq, and, gte, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
	agents,
	agentCapabilities,
	agentWakeupRequests,
	emailReplyTokens,
} from "@thinkwork/database-pg/schema";
import { verifyReplyToken, hashToken } from "../lib/email-tokens.js";

const WORKSPACE_BUCKET = process.env.EMAIL_INBOUND_BUCKET || process.env.WORKSPACE_BUCKET || "";

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

async function processRecord(
	record: SESEvent["Records"][0],
): Promise<void> {
	const sesNotification = record.ses;
	const mail = sesNotification.mail;
	const sesMessageId = mail.messageId;

	// 1. Extract recipient slug
	const recipients = sesNotification.receipt.recipients;
	if (!recipients || recipients.length === 0) {
		console.log("[email-inbound] No recipients, dropping");
		return;
	}

	const recipientEmail = recipients[0].toLowerCase();
	const slugMatch = recipientEmail.match(/^([^@]+)@agents\.thinkwork\.ai$/);
	if (!slugMatch) {
		console.log(`[email-inbound] Non-agents.thinkwork.ai recipient: ${recipientEmail}, dropping`);
		return;
	}

	const localPart = slugMatch[1];

	// 2. Look up agent by slug first, then fall back to vanity address
	let [agent] = await db
		.select({
			id: agents.id,
			tenant_id: agents.tenant_id,
			name: agents.name,
			slug: agents.slug,
		})
		.from(agents)
		.where(eq(agents.slug, localPart));

	// If not found by slug, try vanity address lookup
	if (!agent) {
		const [vanityMatch] = await db
			.select({ agent_id: agentCapabilities.agent_id })
			.from(agentCapabilities)
			.where(
				and(
					eq(agentCapabilities.capability, "email_channel"),
					sql`${agentCapabilities.config}->>'vanityAddress' = ${localPart}`,
				),
			);
		if (vanityMatch) {
			[agent] = await db
				.select({
					id: agents.id,
					tenant_id: agents.tenant_id,
					name: agents.name,
					slug: agents.slug,
				})
				.from(agents)
				.where(eq(agents.id, vanityMatch.agent_id));
		}
	}

	if (!agent) {
		console.log(`[email-inbound] No agent found for local-part: ${localPart}, silent drop`);
		return;
	}

	// 3. Look up email capability
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
		console.log(`[email-inbound] Email channel disabled for agent ${agent.id}, silent drop`);
		return;
	}

	const config = (emailCap.config as Record<string, unknown>) || {};
	const allowedSenders = (config.allowedSenders as string[]) || [];

	// 4. Extract sender
	const senderEmail = (mail.source || "").toLowerCase();
	if (!senderEmail) {
		console.log("[email-inbound] No sender, dropping");
		return;
	}

	// 5. SECURITY CHECK 1: Allowlist
	const isAllowlisted = checkAllowlist(senderEmail, allowedSenders);

	// 6. SECURITY CHECK 2: Reply Token (if not allowlisted)
	let replyTokenContextId: string | null = null;
	let replyTokenContextType: string | null = null;

	if (!isAllowlisted) {
		// Check for reply token in common headers
		const headers = mail.headers || [];
		const replyTokenHeader = headers.find(
			(h: { name: string; value: string }) => h.name.toLowerCase() === "x-thinkwork-reply-token",
		);

		if (replyTokenHeader?.value) {
			const tokenResult = await verifyAndConsumeToken(
				replyTokenHeader.value,
				agent.id,
			);
			if (tokenResult) {
				replyTokenContextId = tokenResult.contextId;
				replyTokenContextType = tokenResult.contextType;
			} else {
				console.log(
					`[email-inbound] Invalid reply token from ${senderEmail} to ${localPart}, silent drop`,
				);
				return;
			}
		} else {
			console.log(
				`[email-inbound] Unauthorized sender ${senderEmail} to ${localPart}, silent drop`,
			);
			return;
		}
	}

	// 7. RATE LIMIT: Count recent email_received wakeups for this agent
	const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
	const [rateCount] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(agentWakeupRequests)
		.where(
			and(
				eq(agentWakeupRequests.agent_id, agent.id),
				eq(agentWakeupRequests.source, "email_received"),
				gte(agentWakeupRequests.created_at, oneHourAgo),
			),
		);

	const agentRateLimit = (config.rateLimitPerHour as number) || 50;
	if ((rateCount?.count || 0) >= agentRateLimit) {
		console.log(
			`[email-inbound] Rate limit hit for agent ${agent.id}: ${rateCount?.count}/${agentRateLimit}/hour`,
		);
		return;
	}

	// Per-tenant rate limit (200/hour)
	const [tenantRateCount] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(agentWakeupRequests)
		.where(
			and(
				eq(agentWakeupRequests.tenant_id, agent.tenant_id),
				eq(agentWakeupRequests.source, "email_received"),
				gte(agentWakeupRequests.created_at, oneHourAgo),
			),
		);

	if ((tenantRateCount?.count || 0) >= 200) {
		console.log(
			`[email-inbound] Tenant rate limit hit for tenant ${agent.tenant_id}: ${tenantRateCount?.count}/200/hour`,
		);
		return;
	}

	// 8. PARSE: Fetch raw email from S3 and parse
	const s3Key = `email/inbound/${sesMessageId}`;
	let subject = "";
	let textBody = "";
	let originalMessageId = "";

	try {
		const { S3Client, GetObjectCommand } = await import(
			"@aws-sdk/client-s3"
		);
		const s3 = new S3Client({});
		const obj = await s3.send(
			new GetObjectCommand({
				Bucket: WORKSPACE_BUCKET,
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
		}
	} catch (parseErr) {
		console.error("[email-inbound] Failed to parse email from S3:", parseErr);
		// Fall back to SES headers for subject and Message-ID
		const subjectHeader = mail.headers?.find(
			(h: { name: string; value: string }) => h.name.toLowerCase() === "subject",
		);
		subject = subjectHeader?.value || "(no subject)";
		const messageIdHeader = mail.headers?.find(
			(h: { name: string; value: string }) => h.name.toLowerCase() === "message-id",
		);
		originalMessageId = messageIdHeader?.value || "";
	}

	// Truncate body to prevent prompt stuffing (max 10k chars)
	if (textBody.length > 10000) {
		textBody = textBody.slice(0, 10000) + "\n\n[... truncated — email body exceeds 10,000 characters]";
	}

	// 9. ENQUEUE: Insert wakeup request
	const idempotencyKey = `email:${sesMessageId}`;

	try {
		await db.insert(agentWakeupRequests).values({
			tenant_id: agent.tenant_id,
			agent_id: agent.id,
			source: "email_received",
			trigger_detail: `email:${sesMessageId}`,
			reason: `Email from ${senderEmail}: ${subject}`,
			idempotency_key: idempotencyKey,
			payload: {
				from: senderEmail,
				subject,
				body: textBody,
				s3Key,
				sesMessageId,
				originalMessageId,
				replyTokenContextId,
				replyTokenContextType,
				isFromAllowlist: isAllowlisted,
			},
			status: "queued",
		});

		console.log(
			`[email-inbound] Enqueued wakeup for agent=${agent.id} from=${senderEmail} subject="${subject}"`,
		);
	} catch (insertErr: unknown) {
		// Handle idempotency constraint violation gracefully
		if (
			insertErr instanceof Error &&
			insertErr.message.includes("idempotency")
		) {
			console.log(
				`[email-inbound] Duplicate email ${sesMessageId}, skipping`,
			);
			return;
		}
		throw insertErr;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if sender is on the allowlist (case-insensitive).
 * Supports wildcard domain matching (*@company.com).
 */
function checkAllowlist(sender: string, allowedSenders: string[]): boolean {
	const senderLower = sender.toLowerCase();

	for (const allowed of allowedSenders) {
		const pattern = allowed.toLowerCase();

		// Exact match
		if (senderLower === pattern) return true;

		// Wildcard domain match (*@domain.com)
		if (pattern.startsWith("*@")) {
			const domain = pattern.slice(2);
			if (senderLower.endsWith(`@${domain}`)) return true;
		}
	}

	return false;
}

/**
 * Verify a reply token and increment its use count.
 * Returns context info if valid, null otherwise.
 */
async function verifyAndConsumeToken(
	tokenValue: string,
	agentId: string,
): Promise<{ contextId: string; contextType: string } | null> {
	// 1. Verify HMAC signature and expiry
	const payload = verifyReplyToken(tokenValue);
	if (!payload) return null;

	// 2. Verify agent matches
	if (payload.agentId !== agentId) return null;

	// 3. Look up token in DB by hash
	const tokenHash = hashToken(tokenValue);
	const [tokenRow] = await db
		.select()
		.from(emailReplyTokens)
		.where(eq(emailReplyTokens.token_hash, tokenHash));

	if (!tokenRow) return null;

	// 4. Check use count
	if (tokenRow.use_count >= tokenRow.max_uses) return null;

	// 5. Check DB-level expiry
	if (tokenRow.expires_at < new Date()) return null;

	// 6. Increment use count
	await db
		.update(emailReplyTokens)
		.set({
			use_count: sql`${emailReplyTokens.use_count} + 1`,
			consumed_at: tokenRow.use_count + 1 >= tokenRow.max_uses ? new Date() : undefined,
		})
		.where(eq(emailReplyTokens.id, tokenRow.id));

	return {
		contextId: payload.contextId,
		contextType: payload.contextType,
	};
}
