import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  knowledgeBases,
  agentKnowledgeBases,
  spaceKnowledgeBases,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { dispatchKbManager } from "./kb-manager-dispatch.js";

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

  // Mark as deleting, then clean up both binding tables. The agent binding
  // was already cleared here; the space binding was being orphaned (U6) —
  // a KB deleted while bound to a Space left a dangling space_knowledge_bases
  // row pointing at a now-gone KB.
  const [row] = await db
    .update(knowledgeBases)
    .set({ status: "deleting", updated_at: new Date() })
    .where(eq(knowledgeBases.id, args.id))
    .returning();
  if (!row) throw new GraphQLError("Knowledge base not found");
  await db
    .delete(agentKnowledgeBases)
    .where(eq(agentKnowledgeBases.knowledge_base_id, args.id));
  await db
    .delete(spaceKnowledgeBases)
    .where(eq(spaceKnowledgeBases.knowledge_base_id, args.id));
  // Best-effort Bedrock teardown — the DB rows are already cleared, so a
  // dispatch failure is logged rather than surfaced.
  try {
    await dispatchKbManager("delete", args.id);
  } catch (err) {
    console.error("[graphql] Failed to invoke KB manager for delete:", err);
  }
  return true;
};
