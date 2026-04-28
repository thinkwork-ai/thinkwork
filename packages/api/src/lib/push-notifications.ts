/**
 * Expo Push Notification sender.
 *
 * Sends push notifications via Expo's HTTP API directly (no SDK dependency)
 * to avoid CommonJS/ESM bundling issues in Lambda.
 */

import { getDb } from "@thinkwork/database-pg";
import { eq } from "drizzle-orm";
import { agents, users } from "@thinkwork/database-pg/schema";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface SendPushParams {
	threadId: string;
	tenantId: string;
	agentId: string;
	title: string;
	body: string;
}

function isExpoPushToken(token: string): boolean {
	return typeof token === "string" && token.startsWith("ExponentPushToken[") && token.endsWith("]");
}

interface SendExternalTaskPushParams {
	userId: string;
	tenantId: string;
	threadId: string;
	title: string;
	body: string;
	eventKind: string;
}

/**
 * Send a push to a specific ThinkWork user (no agent hop). Used by the
 * external-task webhook pipeline: when an external task provider delivers
 * an assignment or status change, we push users a banner so they know something happened without
 * having to open the app.
 *
 * `data.threadId` is what `use-push-notifications.ts:62-81` reads to deep
 * link on tap, so the tap always routes to the task detail screen.
 */
export async function sendExternalTaskPush({
	userId,
	tenantId: _tenantId,
	threadId,
	title,
	body,
	eventKind,
}: SendExternalTaskPushParams) {
	try {
		const db = getDb();

		const rows = await db
			.select({ id: users.id, email: users.email, token: users.expo_push_token })
			.from(users)
			.where(eq(users.id, userId));

		if (rows.length === 0) {
			console.log(`[push-notifications] User ${userId}: not found, skipping external task push`);
			return;
		}

		const row = rows[0];
		if (!row.token) {
			console.log(`[push-notifications] User ${row.email}: no Expo push token, skipping`);
			return;
		}
		if (!isExpoPushToken(row.token)) {
			console.warn(`[push-notifications] Invalid token for user ${row.email}: ${row.token.slice(0, 30)}`);
			return;
		}

		const message = {
			to: row.token,
			sound: "default",
			title,
			body: body.length > 150 ? body.slice(0, 147) + "..." : body,
			data: { threadId, type: "external_task_event", eventKind },
		};

		try {
			const res = await fetch(EXPO_PUSH_URL, {
				method: "POST",
				headers: {
					"Accept": "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify([message]),
			});
			const result = await res.json();
			console.log(
				`[push-notifications] external_task_event push (${res.status}) to ${row.email}:`,
				JSON.stringify(result),
			);
		} catch (err) {
			console.error("[push-notifications] External task push failed:", err);
		}
	} catch (err) {
		// Never let push failures break the ingest pipeline.
		console.error("[push-notifications] sendExternalTaskPush error:", err);
	}
}

/**
 * Send a push notification to the user paired with the agent (agents.human_pair_id).
 */
export async function sendTurnCompletedPush({ threadId, tenantId, agentId, title, body }: SendPushParams) {
	try {
		const db = getDb();

		// Get the paired user's push token via agents.human_pair_id → users
		const rows = await db
			.select({ id: users.id, email: users.email, token: users.expo_push_token })
			.from(agents)
			.innerJoin(users, eq(agents.human_pair_id, users.id))
			.where(eq(agents.id, agentId));

		if (rows.length === 0) {
			console.log(`[push-notifications] Agent ${agentId}: no paired user, skipping`);
			return;
		}

		console.log(`[push-notifications] Agent ${agentId}: paired user ${rows[0].email}`);

		// Validate tokens
		const pushTokens: string[] = [];
		for (const row of rows) {
			if (row.token && isExpoPushToken(row.token)) {
				pushTokens.push(row.token);
			} else {
				console.warn(`[push-notifications] Invalid token for user ${row.email}: ${row.token?.slice(0, 30)}`);
			}
		}

		if (pushTokens.length === 0) {
			console.warn("[push-notifications] No valid Expo push tokens found");
			return;
		}

		console.log(`[push-notifications] Sending to ${pushTokens.length} token(s) for thread ${threadId}`);

		// Build messages
		const messages = pushTokens.map((token) => ({
			to: token,
			sound: "default",
			title,
			body: body.length > 150 ? body.slice(0, 147) + "..." : body,
			data: { threadId, type: "turn_completed" },
		}));

		// Send via Expo HTTP API
		try {
			const res = await fetch(EXPO_PUSH_URL, {
				method: "POST",
				headers: {
					"Accept": "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify(messages),
			});
			const result = await res.json();
			console.log(`[push-notifications] Expo response (${res.status}):`, JSON.stringify(result));
		} catch (err) {
			console.error("[push-notifications] Failed to send:", err);
		}

		console.log(`[push-notifications] Done — sent ${pushTokens.length} notification(s) for thread ${threadId}`);
	} catch (err) {
		// Never let push notification failures break the turn completion flow
		console.error("[push-notifications] Error:", err);
	}
}
