/**
 * Artifact Delivery Lambda
 *
 * Delivers artifact content via email (HTML from markdown).
 *
 * Route: POST /api/artifacts/:id/deliver
 *
 * Auth: THINKWORK_API_SECRET bearer token
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { artifacts, agents, agentCapabilities } from "@thinkwork/database-pg/schema";
import { renderEmailDelivery, renderSmsDelivery } from "../lib/artifact-delivery.js";
import {
	isArtifactPayloadS3Key,
	readArtifactPayloadFromS3,
} from "../lib/artifacts/payload-storage.js";

const THINKWORK_API_SECRET = process.env.THINKWORK_API_SECRET || "";

const db = getDb();

interface DeliverRequest {
	channel: "email" | "sms";
	to: string;
	/** Override the default subject (email only) */
	subject?: string;
}

export async function handler(event: APIGatewayProxyEventV2) {
	// Auth
	const authHeader = event.headers?.authorization || "";
	if (
		!authHeader.startsWith("Bearer ") ||
		authHeader.slice(7) !== THINKWORK_API_SECRET
	) {
		return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
	}

	if (event.requestContext.http.method !== "POST") {
		return {
			statusCode: 405,
			body: JSON.stringify({ error: "Method not allowed" }),
		};
	}

	// Extract artifact ID from path: /api/artifacts/:id/deliver
	const pathMatch = event.rawPath.match(
		/\/api\/artifacts\/([0-9a-f-]+)\/deliver$/i,
	);
	if (!pathMatch) {
		return {
			statusCode: 400,
			body: JSON.stringify({ error: "Invalid path — expected /api/artifacts/:id/deliver" }),
		};
	}
	const artifactId = pathMatch[1];

	let req: DeliverRequest;
	try {
		req = JSON.parse(event.body || "{}");
	} catch {
		return {
			statusCode: 400,
			body: JSON.stringify({ error: "Invalid JSON" }),
		};
	}

	if (!req.channel || !req.to) {
		return {
			statusCode: 400,
			body: JSON.stringify({
				error: "Missing required fields: channel, to",
			}),
		};
	}

	// Fetch artifact
	const [artifact] = await db
		.select()
		.from(artifacts)
		.where(eq(artifacts.id, artifactId));
	if (!artifact) {
		return {
			statusCode: 404,
			body: JSON.stringify({ error: "Artifact not found" }),
		};
	}

	let artifactContent = artifact.content;
	if (
		artifactContent === null &&
		artifact.s3_key &&
		artifact.type !== "applet" &&
		artifact.type !== "applet_state" &&
		isArtifactPayloadS3Key(artifact.tenant_id, artifact.s3_key)
	) {
		try {
			artifactContent = await readArtifactPayloadFromS3({
				tenantId: artifact.tenant_id,
				key: artifact.s3_key,
			});
		} catch (err) {
			console.warn(
				`[artifact-deliver] failed to read artifact payload ${artifact.id}: ${(err as Error).message}`,
			);
		}
	}

	if (artifactContent === null) {
		return {
			statusCode: 422,
			body: JSON.stringify({
				error: "Artifact content is unavailable for delivery",
			}),
		};
	}

	const payload = {
		id: artifact.id,
		title: artifact.title,
		type: artifact.type,
		status: artifact.status,
		content: artifactContent,
		summary: artifact.summary,
		metadata: artifact.metadata as Record<string, unknown> | null,
	};

	if (req.channel === "email") {
		const delivery = renderEmailDelivery(payload);
		const subject = req.subject ?? delivery.subject;

		// Resolve sender address from agent's email channel config
		let fromAddress = "noreply@agents.thinkwork.ai";
		if (artifact.agent_id) {
			const [cap] = await db
				.select()
				.from(agentCapabilities)
				.where(eq(agentCapabilities.agent_id, artifact.agent_id));
			if (cap?.config) {
				const config =
					typeof cap.config === "string"
						? JSON.parse(cap.config)
						: cap.config;
				if (config?.vanityAddress) {
					fromAddress = config.vanityAddress;
				}
			}
		}

		// Send via SES
		try {
			const { SESClient, SendRawEmailCommand } = await import(
				"@aws-sdk/client-ses"
			);
			const ses = new SESClient({});

			const recipients = req.to
				.split(",")
				.map((e) => e.trim())
				.filter(Boolean);
			if (recipients.length > 10) {
				return {
					statusCode: 400,
					body: JSON.stringify({
						error: "Maximum 10 recipients per delivery",
					}),
				};
			}

			const boundary = `----=_Part_${Date.now()}`;
			const rawEmail = [
				`From: Thinkwork <${fromAddress}>`,
				`To: ${recipients.join(", ")}`,
				`Subject: ${subject}`,
				`MIME-Version: 1.0`,
				`Content-Type: multipart/alternative; boundary="${boundary}"`,
				``,
				`--${boundary}`,
				`Content-Type: text/plain; charset=UTF-8`,
				`Content-Transfer-Encoding: 7bit`,
				``,
				delivery.textBody,
				``,
				`--${boundary}`,
				`Content-Type: text/html; charset=UTF-8`,
				`Content-Transfer-Encoding: 7bit`,
				``,
				delivery.htmlBody,
				``,
				`--${boundary}--`,
			].join("\r\n");

			await ses.send(
				new SendRawEmailCommand({
					RawMessage: {
						Data: Buffer.from(rawEmail, "utf-8"),
					},
				}),
			);

			return {
				statusCode: 200,
				body: JSON.stringify({
					ok: true,
					channel: "email",
					recipients,
					subject,
				}),
			};
		} catch (err: any) {
			console.error("[artifact-deliver] SES send failed:", err);
			return {
				statusCode: 502,
				body: JSON.stringify({
					error: "Email delivery failed",
					detail: err.message,
				}),
			};
		}
	}

	if (req.channel === "sms") {
		const sms = renderSmsDelivery(payload);

		// SMS delivery via SNS
		try {
			const { SNSClient, PublishCommand } = await import(
				"@aws-sdk/client-sns"
			);
			const sns = new SNSClient({});

			await sns.send(
				new PublishCommand({
					PhoneNumber: req.to,
					Message: sms.body,
				}),
			);

			return {
				statusCode: 200,
				body: JSON.stringify({
					ok: true,
					channel: "sms",
					to: req.to,
					body: sms.body,
				}),
			};
		} catch (err: any) {
			console.error("[artifact-deliver] SNS send failed:", err);
			return {
				statusCode: 502,
				body: JSON.stringify({
					error: "SMS delivery failed",
					detail: err.message,
				}),
			};
		}
	}

	return {
		statusCode: 400,
		body: JSON.stringify({
			error: `Unsupported channel: ${req.channel}. Supported: email, sms`,
		}),
	};
}
