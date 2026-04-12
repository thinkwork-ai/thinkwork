/**
 * memorySearch — semantic search across long-term memory.
 *
 * Tries two backends and merges:
 *
 * 1. **AgentCore Memory** via `RetrieveMemoryRecordsCommand` — semantic
 *    search against the managed memory resource. Always on when
 *    AGENTCORE_MEMORY_ID is set. Fans out over semantic + preferences
 *    namespaces per agent (same shape as memoryRecords).
 *
 * 2. **Hindsight recall API** — multi-strategy recall with cross-encoder
 *    reranking. Only used when HINDSIGHT_ENDPOINT is set.
 *
 * Results from both sources are merged, sorted by score DESC, and capped
 * at `limit`. Either backend can be absent.
 */

import {
	BedrockAgentCoreClient,
	RetrieveMemoryRecordsCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { GraphQLContext } from "../../context.js";
import { db, eq, agents } from "../../utils.js";

const HINDSIGHT_ENDPOINT = process.env.HINDSIGHT_ENDPOINT || "";

let _agentcoreClient: BedrockAgentCoreClient | null = null;
function getAgentCoreClient(): BedrockAgentCoreClient {
	if (!_agentcoreClient) {
		_agentcoreClient = new BedrockAgentCoreClient({
			region: process.env.AWS_REGION || "us-east-1",
		});
	}
	return _agentcoreClient;
}

const NAMESPACE_PREFIXES: Array<{ prefix: (slug: string) => string; strategy: string }> = [
	{ prefix: (slug) => `assistant_${slug}`, strategy: "semantic" },
	{ prefix: (slug) => `preferences_${slug}`, strategy: "preferences" },
];

type SearchRow = {
	memoryRecordId: string;
	content: { text: string };
	score: number;
	namespace: string;
	strategyId: string;
	strategy: string;
	createdAt: string | null;
};

export const memorySearch = async (
	_parent: unknown,
	args: { assistantId: string; query: string; strategy?: string; limit?: number },
	ctx: GraphQLContext,
) => {
	const { assistantId, query, limit = 10 } = args;

	// Verify agent belongs to tenant
	const [agent] = await db
		.select({ id: agents.id, slug: agents.slug, tenant_id: agents.tenant_id })
		.from(agents)
		.where(eq(agents.id, assistantId));

	if (!agent || (ctx.auth.tenantId && agent.tenant_id !== ctx.auth.tenantId)) {
		throw new Error("Agent not found or access denied");
	}

	// AgentCore Memory keys namespaces on the agent UUID (actorId set from
	// _ASSISTANT_ID in the container), whereas Hindsight keys bank_id on
	// the agent slug. Thread both identifiers into the backend calls.
	const agentId = agent.id as string;
	const bankId = agent.slug || assistantId;

	const [agentCoreResults, hindsightResults] = await Promise.all([
		searchAgentCore(agentId, query, limit),
		searchHindsight(bankId, query, limit),
	]);

	const merged = new Map<string, SearchRow>();
	for (const row of [...agentCoreResults, ...hindsightResults]) {
		if (!merged.has(row.memoryRecordId)) merged.set(row.memoryRecordId, row);
	}
	const sorted = [...merged.values()].sort((a, b) => b.score - a.score);
	const records = sorted.slice(0, limit);

	return {
		records,
		totalCount: merged.size,
	};
};

// ---------------------------------------------------------------------------
// AgentCore Memory semantic search
// ---------------------------------------------------------------------------

async function searchAgentCore(
	agentId: string,
	query: string,
	limit: number,
): Promise<SearchRow[]> {
	const memoryId = process.env.AGENTCORE_MEMORY_ID;
	if (!memoryId) return [];

	const client = getAgentCoreClient();
	const out: SearchRow[] = [];

	// Namespaces use the agent UUID (actorId from the container's
	// _ASSISTANT_ID env var), not the slug.
	const calls = NAMESPACE_PREFIXES.map(async ({ prefix, strategy }) => {
		try {
			const resp = await client.send(
				new RetrieveMemoryRecordsCommand({
					memoryId,
					namespace: prefix(agentId),
					searchCriteria: {
						searchQuery: query,
						topK: limit,
					},
					maxResults: limit,
				}),
			);
			return (resp.memoryRecordSummaries || []).map((r): SearchRow => {
				const text =
					(r.content && typeof (r.content as any).text === "string"
						? (r.content as any).text
						: "") || "";
				const ns =
					r.namespaces && r.namespaces.length > 0 ? r.namespaces[0] : prefix(agentId);
				return {
					memoryRecordId: r.memoryRecordId || `${ns}-${Math.random()}`,
					content: { text },
					score: typeof r.score === "number" ? r.score : 0,
					namespace: ns,
					strategyId: r.memoryStrategyId || "",
					strategy,
					createdAt: r.createdAt ? r.createdAt.toISOString() : null,
				};
			});
		} catch (err) {
			// eslint-disable-next-line no-console
			console.debug(
				`[memorySearch] AgentCore retrieve failed for ${agentId}/${prefix(agentId)}:`,
				(err as Error)?.message,
			);
			return [] as SearchRow[];
		}
	});
	const results = await Promise.all(calls);
	for (const arr of results) out.push(...arr);
	return out;
}

// ---------------------------------------------------------------------------
// Hindsight recall API
// ---------------------------------------------------------------------------

async function searchHindsight(
	bankId: string,
	query: string,
	limit: number,
): Promise<SearchRow[]> {
	if (!HINDSIGHT_ENDPOINT) return [];

	try {
		const resp = await fetch(
			`${HINDSIGHT_ENDPOINT}/v1/default/banks/${bankId}/memories/recall`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query, max_results: limit }),
				signal: AbortSignal.timeout(15_000),
			},
		);

		if (!resp.ok) {
			console.warn(`Hindsight recall failed: ${resp.status}`);
			return [];
		}

		const data = (await resp.json()) as any;
		const memories: Array<any> = data.memory_units || data.memories || data.results || [];
		return memories.map((m, idx) => ({
			memoryRecordId: String(m.id || `recall-${idx}`),
			content: { text: String(m.text || m.content || "") },
			score: m.relevance_score ?? m.score ?? 1.0 - idx * 0.05,
			namespace: m.context || bankId,
			strategyId: m.fact_type || "",
			strategy:
				m.fact_type === "experience"
					? "episodes"
					: m.fact_type === "opinion"
						? "preferences"
						: "semantic",
			createdAt: m.created_at || null,
		}));
	} catch (err) {
		console.warn(`Hindsight recall threw: ${(err as Error)?.message}`);
		return [];
	}
}
