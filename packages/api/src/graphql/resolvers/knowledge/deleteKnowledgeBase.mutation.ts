import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  knowledgeBases,
  agentKnowledgeBases,
  getKbManagerFnArn,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

export const deleteKnowledgeBase = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  // Authz: derive the tenant pin from the row being deleted, then gate
  // before any side effect (U13 — these resolvers shipped with no gate).
  const [existing] = await db
    .select({ tenant_id: knowledgeBases.tenant_id })
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, args.id));
  if (!existing) throw new GraphQLError("Knowledge base not found");
  await requireAdminOrServiceCaller(
    ctx,
    existing.tenant_id,
    "delete_knowledge_base",
  );

  // Mark as deleting, fire-and-forget cleanup
  const [row] = await db
    .update(knowledgeBases)
    .set({ status: "deleting", updated_at: new Date() })
    .where(eq(knowledgeBases.id, args.id))
    .returning();
  if (!row) throw new GraphQLError("Knowledge base not found");
  // Remove agent assignments
  await db
    .delete(agentKnowledgeBases)
    .where(eq(agentKnowledgeBases.knowledge_base_id, args.id));
  // Fire-and-forget: invoke KB manager Lambda to delete in Bedrock
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
          Payload: JSON.stringify({
            action: "delete",
            knowledgeBaseId: args.id,
          }),
        }),
      );
    }
  } catch (err) {
    console.error("[graphql] Failed to invoke KB manager for delete:", err);
  }
  return true;
};
