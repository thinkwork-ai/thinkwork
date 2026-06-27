import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { requireSpaceMemoryScope } from "./space-memory-scope.js";
import { toSearchRow } from "./memorySearch.query.js";

export const spaceMemorySearch = async (
  _parent: unknown,
  args: {
    tenantId?: string | null;
    spaceId: string;
    query: string;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) => {
  const query = args.query.trim();
  if (!query) {
    throw new Error("Search query is required");
  }

  const { tenantId, spaceId, requesterUserId } = await requireSpaceMemoryScope(
    ctx,
    args,
  );
  const limit = args.limit ?? 10;

  const { adapter, recall: recallService } = getMemoryServices();
  const capabilities = await adapter.capabilities();
  if (!capabilities.spaceMemory || !capabilities.recall) {
    throw new Error(
      "Active memory engine does not support Space memory search",
    );
  }
  const hits = await recallService.recall({
    tenantId,
    ownerType: "space",
    ownerId: spaceId,
    query,
    limit,
    hindsight: {
      include: {
        sourceFacts: true,
      },
    },
    requestContext: {
      contextClass: "space_memory_search",
      requesterUserId: requesterUserId ?? undefined,
      sourceSurface: "graphql.spaceMemorySearch",
    },
  });

  const rows = hits.map((hit) => toSearchRow(hit, `space_${spaceId}`));
  const sorted = rows.sort((a, b) => b.score - a.score).slice(0, limit);

  return {
    records: sorted,
    totalCount: sorted.length,
  };
};
