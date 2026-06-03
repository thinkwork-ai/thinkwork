import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, knowledgeBases, snakeToCamel } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { dispatchKbManager } from "./kb-manager-dispatch.js";

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
  // Surface a dispatch failure synchronously (U6/KTD7): if the ingestion job
  // never started, roll the KB back to active with a FAILED sync status and a
  // reason, then tell the caller — don't leave it stuck "syncing".
  try {
    await dispatchKbManager("sync", row.id);
  } catch (err) {
    await db
      .update(knowledgeBases)
      .set({
        status: "active",
        last_sync_status: "FAILED",
        error_message: (err instanceof Error ? err.message : String(err)).slice(
          0,
          1000,
        ),
        updated_at: new Date(),
      })
      .where(eq(knowledgeBases.id, row.id));
    throw new GraphQLError(
      "Failed to start knowledge base sync. Please try again.",
    );
  }
  return snakeToCamel(row);
};
