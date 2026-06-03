import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  knowledgeBases,
  snakeToCamel,
  getKbManagerFnArn,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

export const syncKnowledgeBase = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  // Authz: derive the tenant pin from the row, then gate before kicking
  // off a Bedrock ingestion job (U13 — these resolvers shipped with no gate).
  const [existing] = await db
    .select({ tenant_id: knowledgeBases.tenant_id })
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, args.id));
  if (!existing) throw new GraphQLError("Knowledge base not found");
  await requireAdminOrServiceCaller(
    ctx,
    existing.tenant_id,
    "sync_knowledge_base",
  );

  const [row] = await db
    .update(knowledgeBases)
    .set({
      status: "syncing",
      last_sync_status: "IN_PROGRESS",
      updated_at: new Date(),
    })
    .where(eq(knowledgeBases.id, args.id))
    .returning();
  if (!row) throw new GraphQLError("Knowledge base not found");
  // Fire-and-forget: invoke KB manager Lambda to sync
  try {
    const kbManagerArn = await getKbManagerFnArn();
    if (kbManagerArn) {
      const { LambdaClient, InvokeCommand } =
        await import("@aws-sdk/client-lambda");
      const lambda = new LambdaClient({});
      await lambda.send(
        new InvokeCommand({
          FunctionName: kbManagerArn,
          InvocationType: "Event",
          Payload: JSON.stringify({ action: "sync", knowledgeBaseId: args.id }),
        }),
      );
    }
  } catch (err) {
    console.error("[graphql] Failed to invoke KB manager for sync:", err);
  }
  return snakeToCamel(row);
};
