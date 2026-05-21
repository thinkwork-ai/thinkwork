import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  inArray,
  knowledgeBases,
  snakeToCamel,
  spaceKnowledgeBases,
  spaces,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { toGraphqlSpaceChild } from "./shared.js";

type SpaceKnowledgeBaseInput = {
  knowledgeBaseId: string;
  enabled?: boolean | null;
  searchConfig?: string | Record<string, unknown> | null;
};

type SetSpaceKnowledgeBasesInput = {
  tenantId: string;
  spaceId: string;
  knowledgeBases: SpaceKnowledgeBaseInput[];
};

export async function setSpaceKnowledgeBases(
  _parent: unknown,
  args: { input: SetSpaceKnowledgeBasesInput },
  ctx: GraphQLContext,
) {
  const input = args.input;
  await requireAdminOrServiceCaller(
    ctx,
    input.tenantId,
    "set_space_knowledge_bases",
  );

  const [spaceRow] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(eq(spaces.id, input.spaceId), eq(spaces.tenant_id, input.tenantId)),
    );
  if (!spaceRow) {
    throw new GraphQLError("Space not found for tenant");
  }

  const requestedById = new Map(
    input.knowledgeBases.map((item) => [item.knowledgeBaseId, item]),
  );
  const requestedIds = [...requestedById.keys()];

  if (requestedIds.length > 0) {
    const tenantKnowledgeBases = await db
      .select({ id: knowledgeBases.id })
      .from(knowledgeBases)
      .where(
        and(
          eq(knowledgeBases.tenant_id, input.tenantId),
          inArray(knowledgeBases.id, requestedIds),
        ),
      );
    const tenantKnowledgeBaseIds = new Set(
      tenantKnowledgeBases.map((knowledgeBase) => knowledgeBase.id),
    );
    const missingId = requestedIds.find(
      (id) => !tenantKnowledgeBaseIds.has(id),
    );
    if (missingId) {
      throw new GraphQLError("Knowledge base not found for tenant");
    }
  }

  const rows = await db.transaction(async (tx) => {
    await tx
      .delete(spaceKnowledgeBases)
      .where(
        and(
          eq(spaceKnowledgeBases.tenant_id, input.tenantId),
          eq(spaceKnowledgeBases.space_id, input.spaceId),
        ),
      );

    if (requestedIds.length === 0) return [];

    return tx
      .insert(spaceKnowledgeBases)
      .values(
        requestedIds.map((knowledgeBaseId) => {
          const item = requestedById.get(knowledgeBaseId);
          return {
            tenant_id: input.tenantId,
            space_id: input.spaceId,
            knowledge_base_id: knowledgeBaseId,
            enabled: item?.enabled ?? true,
            search_config: parseSearchConfig(item?.searchConfig),
          };
        }),
      )
      .returning();
  });

  const kbRows =
    rows.length > 0
      ? await db
          .select()
          .from(knowledgeBases)
          .where(
            inArray(
              knowledgeBases.id,
              rows.map((row) => row.knowledge_base_id),
            ),
          )
      : [];
  const kbById = new Map(
    kbRows.map((knowledgeBase) => [
      knowledgeBase.id,
      snakeToCamel(knowledgeBase),
    ]),
  );

  return rows.map((row) => ({
    ...toGraphqlSpaceChild(row),
    knowledgeBase: kbById.get(row.knowledge_base_id) ?? null,
  }));
}

function parseSearchConfig(
  value: SpaceKnowledgeBaseInput["searchConfig"],
): Record<string, unknown> | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return JSON.parse(value);
  return value;
}
