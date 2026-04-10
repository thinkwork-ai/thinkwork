import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	messages, threads, agentWakeupRequests,
	messageToCamel, invokeChatAgent,
} from "../../utils.js";
import { notifyThreadUpdate } from "../../notify.js";

export const sendMessage = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [thread] = await db
		.select({ tenant_id: threads.tenant_id, agent_id: threads.agent_id, title: threads.title, status: threads.status })
		.from(threads)
		.where(eq(threads.id, i.threadId));
	if (!thread) throw new Error("Thread not found");

	const [row] = await db
		.insert(messages)
		.values({
			thread_id: i.threadId,
			tenant_id: thread.tenant_id,
			role: i.role.toLowerCase(),
			content: i.content,
			sender_type: i.senderType,
			sender_id: i.senderId,
			tool_calls: i.toolCalls ? JSON.parse(i.toolCalls) : undefined,
			tool_results: i.toolResults ? JSON.parse(i.toolResults) : undefined,
			metadata: i.metadata ? JSON.parse(i.metadata) : undefined,
		})
		.returning();

	const isUserMessage = i.role.toLowerCase() === "user";

	// Auto-generate thread title from first user message (no updated_at bump)
	if (isUserMessage && i.content && thread.title === "Untitled conversation") {
		const raw = i.content.trim();
		const autoTitle = raw.length <= 80 ? raw : raw.substring(0, 80).replace(/\s+\S*$/, "...");
		await db.update(threads).set({ title: autoTitle }).where(eq(threads.id, i.threadId));
	}

	// Only bump updated_at and notify for non-user messages (agent responses).
	// User messages should NOT move the thread to the top — that happens when
	// the agent responds (via chat-agent-invoke.ts).
	if (!isUserMessage) {
		await db.update(threads).set({ updated_at: new Date() }).where(eq(threads.id, i.threadId));
		notifyThreadUpdate({
			threadId: i.threadId,
			tenantId: thread.tenant_id,
			status: thread.status ?? "in_progress",
			title: thread.title,
		}).catch(() => {});
	}

	// Direct async Lambda invocation for instant chat response.
	// Falls back to wakeup queue if the Lambda ARN isn't available.
	if (i.role.toLowerCase() === "user" && thread.agent_id) {
		const dispatched = await invokeChatAgent({
			threadId: i.threadId,
			tenantId: thread.tenant_id,
			agentId: thread.agent_id,
			userMessage: i.content,
			messageId: row.id,
		});

		if (!dispatched) {
			// Fallback: insert wakeup request for the cron-based processor
			try {
				await db.insert(agentWakeupRequests).values({
					tenant_id: thread.tenant_id,
					agent_id: thread.agent_id,
					source: "chat_message",
					reason: "User sent a chat message",
					trigger_detail: `thread:${i.threadId}`,
					payload: {
						threadId: i.threadId,
						messageId: row.id,
						userMessage: i.content,
					},
					requested_by_actor_type: i.senderType || "user",
					requested_by_actor_id: i.senderId,
				});
				console.log(`[sendMessage] Wakeup request queued (fallback) for thread=${i.threadId} agent=${thread.agent_id}`);
			} catch (wakeupErr) {
				console.error("[sendMessage] Failed to queue wakeup request:", wakeupErr);
			}
		}
	}

	return messageToCamel(row);
};
