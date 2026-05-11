import type { GraphQLContext } from "../../context.js";
import {
	db,
	eq,
	and,
	or,
	inArray,
	artifacts,
	messages,
	messageArtifacts,
	threadAttachments,
	threads,
} from "../../utils.js";
import { documents, recipes, retryQueue } from "@thinkwork/database-pg/schema";
import { requireTenantMember } from "../core/authz.js";

export const deleteThread = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [thread] = await db
		.select({ id: threads.id, tenant_id: threads.tenant_id })
		.from(threads)
		.where(eq(threads.id, args.id));
	if (!thread) return false;

	if (ctx.auth.authType !== "apikey") {
		await requireTenantMember(ctx, thread.tenant_id);
	}

	return await db.transaction(async (tx) => {
		const messageRows = await tx
			.select({ id: messages.id })
			.from(messages)
			.where(eq(messages.thread_id, args.id));
		const messageIds = messageRows.map((row) => row.id);

		if (messageIds.length > 0) {
			await tx
				.delete(messageArtifacts)
				.where(
					or(
						eq(messageArtifacts.thread_id, args.id),
						inArray(messageArtifacts.message_id, messageIds),
					),
				);
			await tx
				.update(artifacts)
				.set({ source_message_id: null })
				.where(inArray(artifacts.source_message_id, messageIds));
		} else {
			await tx
				.delete(messageArtifacts)
				.where(eq(messageArtifacts.thread_id, args.id));
		}

		await tx
			.update(artifacts)
			.set({ thread_id: null })
			.where(eq(artifacts.thread_id, args.id));
		await tx
			.update(documents)
			.set({ thread_id: null })
			.where(eq(documents.thread_id, args.id));
		await tx
			.update(recipes)
			.set({ thread_id: null })
			.where(eq(recipes.thread_id, args.id));
		await tx
			.update(retryQueue)
			.set({ thread_id: null })
			.where(eq(retryQueue.thread_id, args.id));
		await tx
			.delete(threadAttachments)
			.where(eq(threadAttachments.thread_id, args.id));
		await tx.delete(messages).where(eq(messages.thread_id, args.id));

		const [row] = await tx
			.delete(threads)
			.where(
				and(
					eq(threads.id, args.id),
					eq(threads.tenant_id, thread.tenant_id),
				),
			)
			.returning({ id: threads.id });
		return !!row;
	});
};
