import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, knowledgeBases, snakeToCamel } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

export const updateKnowledgeBase = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;
  // Authz: derive the tenant pin from the row being mutated, then gate
  // before any write (U13 — these resolvers shipped with no gate).
  const [existing] = await db
    .select({ tenant_id: knowledgeBases.tenant_id })
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, args.id));
  if (!existing) throw new GraphQLError("Knowledge base not found");
  await requireAdminOrServiceCaller(
    ctx,
    existing.tenant_id,
    "update_knowledge_base",
  );

  const updates: Record<string, any> = { updated_at: new Date() };
  if (i.name !== undefined) updates.name = i.name;
  if (i.description !== undefined) updates.description = i.description;
  const [row] = await db
    .update(knowledgeBases)
    .set(updates)
    .where(eq(knowledgeBases.id, args.id))
    .returning();
  if (!row) throw new GraphQLError("Knowledge base not found");
  return snakeToCamel(row);
};
