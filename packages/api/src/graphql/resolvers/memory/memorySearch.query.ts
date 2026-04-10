/**
 * memorySearch — Semantic search via Hindsight recall API.
 *
 * PRD-41B Phase 5: Replaces AgentCore Memory retrieval with Hindsight's
 * multi-strategy recall (semantic + BM25 + graph + temporal + reranking).
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, agents } from "../../utils.js";

const HINDSIGHT_ENDPOINT = process.env.HINDSIGHT_ENDPOINT || "";

export const memorySearch = async (
  _parent: unknown,
  args: { assistantId: string; query: string; strategy?: string; limit?: number },
  ctx: GraphQLContext,
) => {
  const { assistantId, query, limit = 10 } = args;

  // Verify agent belongs to tenant
  const [agent] = await db
    .select({ slug: agents.slug, tenant_id: agents.tenant_id })
    .from(agents)
    .where(eq(agents.id, assistantId));

  if (!agent || (ctx.auth.tenantId && agent.tenant_id !== ctx.auth.tenantId)) {
    throw new Error("Agent not found or access denied");
  }

  const bankId = agent.slug || assistantId;

  if (!HINDSIGHT_ENDPOINT) {
    return { records: [], totalCount: 0 };
  }

  // Call Hindsight recall API — multi-strategy search with reranking
  const resp = await fetch(
    `${HINDSIGHT_ENDPOINT}/v1/default/banks/${bankId}/memories/recall`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        max_results: limit,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!resp.ok) {
    console.warn(`Hindsight recall failed: ${resp.status}`);
    return { records: [], totalCount: 0 };
  }

  const data = await resp.json();
  // Hindsight recall returns { memory_units: [...] } or { results: [...] }
  const memories: Array<{
    id?: string;
    text?: string;
    content?: string;
    score?: number;
    relevance_score?: number;
    created_at?: string;
    context?: string;
    fact_type?: string;
    metadata?: any;
  }> = data.memory_units || data.memories || data.results || [];

  const records = memories.map((m, idx) => ({
    memoryRecordId: String(m.id || `recall-${idx}`),
    content: { text: String(m.text || m.content || "") },
    score: m.relevance_score ?? m.score ?? 1.0 - idx * 0.05,
    namespace: m.context || bankId,
    strategyId: m.fact_type || "",
    strategy: m.fact_type === "experience" ? "episodes" : m.fact_type === "opinion" ? "preferences" : "semantic",
    createdAt: m.created_at || null,
  }));

  return {
    records: records.slice(0, limit),
    totalCount: records.length,
  };
};
