import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	knowledgeBases,
	snakeToCamel, getKbManagerFnArn,
} from "../../utils.js";

export const syncKnowledgeBase = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.update(knowledgeBases)
		.set({ status: "syncing", last_sync_status: "IN_PROGRESS", updated_at: new Date() })
		.where(eq(knowledgeBases.id, args.id))
		.returning();
	if (!row) throw new Error("Knowledge base not found");
	// Fire-and-forget: invoke KB manager Lambda to sync
	try {
		const kbManagerArn = await getKbManagerFnArn();
		if (kbManagerArn) {
			const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
			const lambda = new LambdaClient({});
			await lambda.send(new InvokeCommand({
				FunctionName: kbManagerArn,
				InvocationType: "Event",
				Payload: JSON.stringify({ action: "sync", knowledgeBaseId: args.id }),
			}));
		}
	} catch (err) {
		console.error("[graphql] Failed to invoke KB manager for sync:", err);
	}
	return snakeToCamel(row);
};
