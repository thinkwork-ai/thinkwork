import { db as defaultDb, sql } from "../../graphql/utils.js";

export const CHAIN_DEPTH_CAP = 8;

export type WorkspaceReviewKind = "paired" | "system" | "unrouted";

export interface AgentChainNode {
  id: string;
  parent_agent_id: string | null;
  human_pair_id: string | null;
  source: string;
  level: number;
}

export interface ClassifyResult {
  kind: WorkspaceReviewKind;
  responsibleUserId: string | null;
}

export interface ClassifyChainStore {
  fetchAgentChain(
    tenantId: string,
    agentId: string,
    depthCap: number,
  ): Promise<AgentChainNode[]>;
}

/**
 * Classify a workspace run by walking its already-fetched agent chain. Pure;
 * walks ascending levels (level 0 = self) for the first agent with a
 * `human_pair_id`. If none is found, classifies the topmost node as system or
 * unrouted based on its `source` and whether the chain terminated.
 */
export function classifyChain(chain: AgentChainNode[]): ClassifyResult {
  if (chain.length === 0) {
    return { kind: "unrouted", responsibleUserId: null };
  }

  for (const node of chain) {
    if (node.human_pair_id) {
      return { kind: "paired", responsibleUserId: node.human_pair_id };
    }
  }

  const topmost = chain[chain.length - 1]!;

  // Chain hit the depth cap or pointed at a deleted/missing parent.
  if (topmost.parent_agent_id !== null) {
    return { kind: "unrouted", responsibleUserId: null };
  }

  if (topmost.source === "system") {
    return { kind: "system", responsibleUserId: null };
  }

  // Chain terminated cleanly at a user-source agent with no human pair: orphan.
  return { kind: "unrouted", responsibleUserId: null };
}

/**
 * Fetch the agent chain via the store and classify it. Tenant isolation is
 * enforced by the store; this orchestrator just composes the two steps.
 */
export async function classifyWorkspaceReview(
  store: ClassifyChainStore,
  args: { tenantId: string; agentId: string; depthCap?: number },
): Promise<ClassifyResult> {
  const depthCap = args.depthCap ?? CHAIN_DEPTH_CAP;
  const chain = await store.fetchAgentChain(
    args.tenantId,
    args.agentId,
    depthCap,
  );
  return classifyChain(chain);
}

interface AgentChainRow {
  id: string;
  parent_agent_id: string | null;
  human_pair_id: string | null;
  source: string;
  level: number;
}

/**
 * Drizzle-backed store. Walks `agents.parent_agent_id` from the given
 * `agentId` upward via a single recursive CTE, scoped to `tenantId` at every
 * level so cross-tenant rows never enter the chain.
 */
export function createDrizzleClassifyChainStore(
  database = defaultDb,
): ClassifyChainStore {
  return {
    async fetchAgentChain(tenantId, agentId, depthCap) {
      const result = await database.execute(sql`
        WITH RECURSIVE agent_chain AS (
          SELECT id, parent_agent_id, human_pair_id, source, 0 AS level
          FROM agents
          WHERE id = ${agentId}
            AND tenant_id = ${tenantId}
          UNION ALL
          SELECT a.id, a.parent_agent_id, a.human_pair_id, a.source, c.level + 1
          FROM agents a
          INNER JOIN agent_chain c ON a.id = c.parent_agent_id
          WHERE a.tenant_id = ${tenantId}
            AND c.level + 1 < ${depthCap}
        )
        SELECT id, parent_agent_id, human_pair_id, source, level
        FROM agent_chain
        ORDER BY level ASC
      `);
      const rows =
        (result as unknown as { rows?: AgentChainRow[] }).rows ?? [];
      return rows.map((row) => ({
        id: row.id,
        parent_agent_id: row.parent_agent_id,
        human_pair_id: row.human_pair_id,
        source: row.source,
        level: Number(row.level),
      }));
    },
  };
}
