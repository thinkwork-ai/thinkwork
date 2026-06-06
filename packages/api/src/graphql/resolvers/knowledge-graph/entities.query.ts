import type { GraphQLContext } from "../../context.js";
import { loadFilteredEntities, type EntityFilterArgs } from "./shared.js";

export async function knowledgeGraphEntities(
  _parent: unknown,
  args: EntityFilterArgs,
  ctx: GraphQLContext,
) {
  return loadFilteredEntities(ctx, args, "knowledge_graph_entities");
}
