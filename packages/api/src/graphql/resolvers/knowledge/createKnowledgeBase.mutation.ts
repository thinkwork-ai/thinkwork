import type { GraphQLContext } from "../../context.js";
import {
	db,
	knowledgeBases,
	snakeToCamel, generateSlug, getKbManagerFnArn,
} from "../../utils.js";

export const createKnowledgeBase = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const slug = i.name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		|| generateSlug();
	const [row] = await db
		.insert(knowledgeBases)
		.values({
			tenant_id: i.tenantId,
			name: i.name,
			slug,
			description: i.description,
			embedding_model: i.embeddingModel ?? "amazon.titan-embed-text-v2:0",
			chunking_strategy: i.chunkingStrategy ?? "FIXED_SIZE",
			chunk_size_tokens: i.chunkSizeTokens ?? 300,
			chunk_overlap_percent: i.chunkOverlapPercent ?? 20,
			status: "creating",
		})
		.returning();
	// Fire-and-forget: invoke KB manager Lambda to provision in Bedrock
	try {
		const kbManagerArn = await getKbManagerFnArn();
		if (kbManagerArn) {
			const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
			const lambda = new LambdaClient({});
			await lambda.send(new InvokeCommand({
				FunctionName: kbManagerArn,
				InvocationType: "Event",
				Payload: JSON.stringify({ action: "create", knowledgeBaseId: row.id }),
			}));
		}
	} catch (err) {
		console.error("[graphql] Failed to invoke KB manager:", err);
	}
	return snakeToCamel(row);
};
