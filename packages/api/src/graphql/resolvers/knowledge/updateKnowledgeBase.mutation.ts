import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, knowledgeBases, snakeToCamel } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { dispatchKbManager } from "./kb-manager-dispatch.js";

export const updateKnowledgeBase = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;
  // Authz: derive the tenant pin from the row being mutated, then gate
  // before any write (U13 — these resolvers shipped with no gate). The
  // existing chunking values are read so we only re-ingest when they change.
  const [existing] = await db
    .select({
      tenant_id: knowledgeBases.tenant_id,
      chunking_strategy: knowledgeBases.chunking_strategy,
      chunk_size_tokens: knowledgeBases.chunk_size_tokens,
      chunk_overlap_percent: knowledgeBases.chunk_overlap_percent,
    })
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
  if (i.chunkingStrategy !== undefined)
    updates.chunking_strategy = i.chunkingStrategy;
  if (i.chunkSizeTokens !== undefined)
    updates.chunk_size_tokens = i.chunkSizeTokens;
  if (i.chunkOverlapPercent !== undefined)
    updates.chunk_overlap_percent = i.chunkOverlapPercent;

  const chunkingChanged =
    (i.chunkingStrategy !== undefined &&
      i.chunkingStrategy !== existing.chunking_strategy) ||
    (i.chunkSizeTokens !== undefined &&
      i.chunkSizeTokens !== existing.chunk_size_tokens) ||
    (i.chunkOverlapPercent !== undefined &&
      i.chunkOverlapPercent !== existing.chunk_overlap_percent);

  const [row] = await db
    .update(knowledgeBases)
    .set(updates)
    .where(eq(knowledgeBases.id, args.id))
    .returning();
  if (!row) throw new GraphQLError("Knowledge base not found");

  // A chunking change reprocesses every document (U8). Name/description-only
  // edits skip this entirely so they don't trigger a needless re-ingest.
  if (chunkingChanged) {
    try {
      await dispatchKbManager("rechunk", args.id);
    } catch (err) {
      await db
        .update(knowledgeBases)
        .set({
          status: "failed",
          error_message: (err instanceof Error
            ? err.message
            : String(err)
          ).slice(0, 1000),
          updated_at: new Date(),
        })
        .where(eq(knowledgeBases.id, args.id));
      throw new GraphQLError(
        "Chunking saved, but re-processing failed to start. Retry the change.",
      );
    }
  }
  return snakeToCamel(row);
};
