import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	agents, threads, threadComments, agentWakeupRequests,
	snakeToCamel,
} from "../../utils.js";

export const addThreadComment = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [thread] = await db
		.select({
			tenant_id: threads.tenant_id,
			assignee_type: threads.assignee_type,
			assignee_id: threads.assignee_id,
			agent_id: threads.agent_id,
		})
		.from(threads)
		.where(eq(threads.id, i.threadId));
	if (!thread) throw new Error("Thread not found");
	const [row] = await db
		.insert(threadComments)
		.values({
			thread_id: i.threadId,
			tenant_id: thread.tenant_id,
			content: i.content,
			author_type: i.authorType,
			author_id: i.authorId,
			metadata: i.metadata ? JSON.parse(i.metadata) : undefined,
		})
		.returning();

	// Trigger: wake assigned agent when a non-agent user comments
	if (i.authorType !== "agent" && thread.assignee_type === "agent" && thread.assignee_id) {
		try {
			// Check agent's wakeOnComment config (default true)
			const [assignedAgent] = await db
				.select({ runtime_config: agents.runtime_config })
				.from(agents)
				.where(eq(agents.id, thread.assignee_id));
			const heartbeatCfg = (assignedAgent?.runtime_config as Record<string, unknown>)?.heartbeat as Record<string, unknown> | undefined;
			const wakeOnComment = heartbeatCfg?.wakeOnComment !== false;

			if (wakeOnComment) {
				await db.insert(agentWakeupRequests).values({
					tenant_id: thread.tenant_id,
					agent_id: thread.assignee_id,
					source: "issue_commented",
					reason: `Comment on thread`,
					trigger_detail: `thread:${i.threadId}`,
					payload: { threadId: i.threadId, commentId: row.id },
					requested_by_actor_type: i.authorType || "user",
					requested_by_actor_id: i.authorId,
				});
			}
		} catch (triggerErr) {
			console.error("[addThreadComment] Failed to insert wakeup for comment trigger:", triggerErr);
		}
	}

	// Trigger: parse @mentions and wake mentioned agents
	try {
		const mentionPattern = /@([a-f0-9-]{36})/g;
		let match;
		while ((match = mentionPattern.exec(i.content)) !== null) {
			const mentionedId = match[1];
			// Only wake if mentioned ID differs from commenter
			if (mentionedId !== i.authorId) {
				await db.insert(agentWakeupRequests).values({
					tenant_id: thread.tenant_id,
					agent_id: mentionedId,
					source: "issue_comment_mentioned",
					reason: `Mentioned in comment on thread`,
					trigger_detail: `thread:${i.threadId}`,
					payload: { threadId: i.threadId, commentId: row.id },
					requested_by_actor_type: i.authorType || "user",
					requested_by_actor_id: i.authorId,
				});
			}
		}
	} catch (mentionErr) {
		console.error("[addThreadComment] Failed to insert wakeup for mention trigger:", mentionErr);
	}

	return snakeToCamel(row);
};
