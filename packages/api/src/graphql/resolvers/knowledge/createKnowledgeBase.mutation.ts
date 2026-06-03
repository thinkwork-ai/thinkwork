import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  knowledgeBases,
  snakeToCamel,
  generateSlug,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { dispatchKbManager } from "./kb-manager-dispatch.js";

export const createKnowledgeBase = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;
  // Authz: the caller must be an admin/owner of the target tenant before
  // we provision anything (these resolvers shipped with no gate — see U13).
  await requireAdminOrServiceCaller(ctx, i.tenantId, "create_knowledge_base");
  const slug =
    i.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || generateSlug();
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
  // Surface a dispatch failure synchronously (U6/KTD7) instead of leaving the
  // KB stuck in "creating" with no signal. Bedrock provisioning itself stays
  // async; only the dispatch is awaited. On failure the row is marked failed
  // so the operator can recover via retry (U9).
  try {
    await dispatchKbManager("create", row.id);
  } catch (err) {
    await db
      .update(knowledgeBases)
      .set({
        status: "failed",
        error_message: errorText(err),
        updated_at: new Date(),
      })
      .where(eq(knowledgeBases.id, row.id));
    throw new GraphQLError(
      "Failed to start knowledge base provisioning. The knowledge base is marked failed; you can retry it.",
    );
  }
  return snakeToCamel(row);
};

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}
