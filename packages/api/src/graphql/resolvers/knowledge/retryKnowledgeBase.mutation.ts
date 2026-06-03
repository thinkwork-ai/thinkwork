import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, knowledgeBases, snakeToCamel } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { dispatchKbManager } from "./kb-manager-dispatch.js";

/**
 * Re-provision a KB stuck in `failed`. Re-dispatches the create path, which is
 * now idempotent in the manager Lambda (it guards each Bedrock call on the
 * persisted `aws_kb_id` / `aws_data_source_id`), so a retry resumes the
 * partially-provisioned KB instead of orphaning a duplicate Bedrock KB (U9).
 */
export const retryKnowledgeBase = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const [existing] = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, args.id));
  if (!existing) throw new GraphQLError("Knowledge base not found");
  await requireAdminOrServiceCaller(
    ctx,
    existing.tenant_id,
    "retry_knowledge_base",
  );
  if (existing.status !== "failed") {
    throw new GraphQLError("Only a failed knowledge base can be retried.");
  }

  const [row] = await db
    .update(knowledgeBases)
    .set({ status: "creating", error_message: null, updated_at: new Date() })
    .where(eq(knowledgeBases.id, args.id))
    .returning();

  try {
    await dispatchKbManager("create", args.id);
  } catch (err) {
    await db
      .update(knowledgeBases)
      .set({
        status: "failed",
        error_message: (err instanceof Error ? err.message : String(err)).slice(
          0,
          1000,
        ),
        updated_at: new Date(),
      })
      .where(eq(knowledgeBases.id, args.id));
    throw new GraphQLError(
      "Failed to start knowledge base provisioning. Please try again.",
    );
  }
  return snakeToCamel(row);
};
