import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  and,
  eq,
  inArray,
  agents,
  knowledgeBases,
  agentKnowledgeBases,
  snakeToCamel,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

export const setAgentKnowledgeBases = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  // Resolve the agent's tenant first so we can gate before any write and
  // derive the tenant pin from the row (U13 — shipped with no gate, and the
  // delete used to run before the agent lookup, mutating on a missing agent).
  const [agent] = await db
    .select({ tenant_id: agents.tenant_id })
    .from(agents)
    .where(eq(agents.id, args.agentId));
  if (!agent) throw new GraphQLError("Agent not found");
  await requireAdminOrServiceCaller(
    ctx,
    agent.tenant_id,
    "set_agent_knowledge_bases",
  );

  const requestedIds: string[] = args.knowledgeBases.map(
    (kb: any) => kb.knowledgeBaseId,
  );

  // Cross-tenant guard: every supplied KB must belong to the agent's tenant,
  // or a caller could bind another tenant's KB into this agent's context.
  if (requestedIds.length > 0) {
    const tenantKbs = await db
      .select({ id: knowledgeBases.id })
      .from(knowledgeBases)
      .where(
        and(
          eq(knowledgeBases.tenant_id, agent.tenant_id),
          inArray(knowledgeBases.id, requestedIds),
        ),
      );
    const tenantKbIds = new Set(tenantKbs.map((kb) => kb.id));
    const foreignId = requestedIds.find((id) => !tenantKbIds.has(id));
    if (foreignId) {
      throw new GraphQLError("Knowledge base not found for tenant");
    }
  }

  await db
    .delete(agentKnowledgeBases)
    .where(eq(agentKnowledgeBases.agent_id, args.agentId));
  if (requestedIds.length === 0) return [];

  const rows = await db
    .insert(agentKnowledgeBases)
    .values(
      args.knowledgeBases.map((kb: any) => ({
        agent_id: args.agentId,
        tenant_id: agent.tenant_id,
        knowledge_base_id: kb.knowledgeBaseId,
        enabled: kb.enabled ?? true,
        search_config: kb.searchConfig
          ? JSON.parse(kb.searchConfig)
          : undefined,
      })),
    )
    .returning();
  // Resolve joined KB details
  const kbIds = rows.map((r) => r.knowledge_base_id);
  const kbs =
    kbIds.length > 0
      ? await db
          .select()
          .from(knowledgeBases)
          .where(inArray(knowledgeBases.id, kbIds))
      : [];
  const kbMap = new Map(kbs.map((kb) => [kb.id, snakeToCamel(kb)]));

  return rows.map((r) => ({
    ...snakeToCamel(r),
    knowledgeBase: kbMap.get(r.knowledge_base_id) ?? null,
  }));
};
