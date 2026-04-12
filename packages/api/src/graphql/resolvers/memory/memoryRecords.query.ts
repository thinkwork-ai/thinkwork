/**
 * memoryRecords — list long-term memory records for one agent or all
 * agents in the tenant.
 *
 * Reads from two backends:
 *
 * 1. **AgentCore Memory** (always on). Every agent turn is automatically
 *    retained into a Bedrock AgentCore Memory resource via the
 *    `store_turn_pair` hook in the agent container, and background
 *    strategies extract facts into four namespaces. We call
 *    `ListMemoryRecordsCommand` with namespace prefixes `assistant_{slug}`
 *    (semantic) and `preferences_{slug}` (preferences) to fetch cross-
 *    thread facts and preferences. Session-scoped strategies (`session_*`
 *    and `episodes_*`) are intentionally skipped here — they need
 *    per-session fanout and have less value in the flat "all memories"
 *    view.
 *
 * 2. **Hindsight** (optional add-on). When the Hindsight ECS service is
 *    deployed, records also live in the `hindsight.memory_units` table in
 *    Aurora. We pull them via a direct SQL query and merge with the
 *    AgentCore results.
 *
 * Results from both sources are merged, sorted by createdAt DESC, and
 * capped at 500 total rows. Either backend can be absent and the resolver
 * still returns whatever the other backend has (or an empty array if both
 * are unavailable).
 *
 * Supports single-agent (`assistantId = <uuid>`) and all-agents mode
 * (`assistantId = "all"`, requires tenant context from auth).
 */

import {
	BedrockAgentCoreClient,
	ListMemoryRecordsCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { GraphQLContext } from "../../context.js";
import { db, eq, sql, agents } from "../../utils.js";

// Lazy-init singleton — one client per Lambda container.
let _agentcoreClient: BedrockAgentCoreClient | null = null;
function getAgentCoreClient(): BedrockAgentCoreClient {
	if (!_agentcoreClient) {
		_agentcoreClient = new BedrockAgentCoreClient({
			region: process.env.AWS_REGION || "us-east-1",
		});
	}
	return _agentcoreClient;
}

// Strategy namespaces that hold cross-thread records for an actor. These
// mirror memory.py:STRATEGY_NAMESPACES. The `semantic` and `preferences`
// namespaces are keyed on actorId alone, so we can fetch them with a
// prefix match per agent slug. The `session_*` and `episodes_*` namespaces
// also include a sessionId and are skipped here.
const NAMESPACE_PREFIXES: Array<{ prefix: (slug: string) => string; strategy: string }> = [
	{ prefix: (slug) => `assistant_${slug}`, strategy: "semantic" },
	{ prefix: (slug) => `preferences_${slug}`, strategy: "preferences" },
];

const PER_NAMESPACE_LIMIT = 50;
const TOTAL_CAP = 500;

interface MemoryRow {
	memoryRecordId: string;
	content: { text: string };
	createdAt: string | null;
	updatedAt: string | null;
	expiresAt: string | null;
	namespace: string;
	strategyId: string | null;
	strategy: string;
	score: number | null;
	agentSlug: string | null;
	factType: string | null;
	confidence: number | null;
	eventDate: string | null;
	occurredStart: string | null;
	occurredEnd: string | null;
	mentionedAt: string | null;
	tags: string[] | null;
	accessCount: number;
	proofCount: number | null;
	context: string | null;
	_sortKey: number;
}

export const memoryRecords = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { assistantId } = args as { assistantId: string; namespace: string };

	// Resolve the agents we're querying. AgentCore Memory keys namespaces on
	// `actorId` which the agent container sets to the agent UUID (via the
	// _ASSISTANT_ID env var), so records live at `assistant_<uuid>` /
	// `preferences_<uuid>`. Hindsight keys on `bank_id` which defaults to
	// the agent SLUG, so hindsight.memory_units rows live at `bank_id =
	// <slug>`. We resolve both for each agent and fan out accordingly.
	let agentList: Array<{ id: string; slug: string }>;

	if (assistantId === "all") {
		if (!ctx.auth.tenantId) throw new Error("Tenant context required for all-agents query");
		const agentRows = await db
			.select({ id: agents.id, slug: agents.slug })
			.from(agents)
			.where(eq(agents.tenant_id, ctx.auth.tenantId));
		agentList = agentRows
			.filter((a) => a.id)
			.map((a) => ({ id: a.id as string, slug: (a.slug || a.id) as string }));
		if (agentList.length === 0) return [];
	} else {
		const [agent] = await db
			.select({ id: agents.id, tenant_id: agents.tenant_id, slug: agents.slug })
			.from(agents)
			.where(eq(agents.id, assistantId));
		if (!agent || (ctx.auth.tenantId && agent.tenant_id !== ctx.auth.tenantId)) {
			throw new Error("Agent not found or access denied");
		}
		agentList = [{ id: agent.id as string, slug: (agent.slug || agent.id) as string }];
	}

	const agentSlugs = agentList.map((a) => a.slug);

	// Kick both backends off in parallel. Either may be empty/unavailable.
	const [agentCoreRows, hindsightRows] = await Promise.all([
		fetchAgentCoreRecords(agentList),
		fetchHindsightRecords(agentSlugs),
	]);

	// Merge, dedupe by memoryRecordId (defensive — shouldn't happen since
	// the ID namespaces are disjoint), sort newest-first, cap.
	const merged = new Map<string, MemoryRow>();
	for (const row of [...agentCoreRows, ...hindsightRows]) {
		if (!merged.has(row.memoryRecordId)) merged.set(row.memoryRecordId, row);
	}
	const sorted = [...merged.values()].sort((a, b) => b._sortKey - a._sortKey);
	const capped = sorted.slice(0, TOTAL_CAP);

	// Strip the internal _sortKey before returning.
	return capped.map(({ _sortKey: _drop, ...rest }) => rest);
};

// ---------------------------------------------------------------------------
// AgentCore Memory backend
// ---------------------------------------------------------------------------

async function fetchAgentCoreRecords(
	agentList: Array<{ id: string; slug: string }>,
): Promise<MemoryRow[]> {
	const memoryId = process.env.AGENTCORE_MEMORY_ID;
	if (!memoryId) return [];

	const client = getAgentCoreClient();
	const out: MemoryRow[] = [];

	// Fan out: for each agent, hit each namespace prefix. Namespaces use
	// the agent UUID (actorId from the container's _ASSISTANT_ID env var),
	// so we query by agent.id. We also thread the agent.slug through so
	// the returned MemoryRow can carry it for the UI's agentNamesBySlug
	// lookup.
	for (const agent of agentList) {
		const calls = NAMESPACE_PREFIXES.map(async ({ prefix, strategy }) => {
			try {
				const resp = await client.send(
					new ListMemoryRecordsCommand({
						memoryId,
						namespace: prefix(agent.id),
						maxResults: PER_NAMESPACE_LIMIT,
					}),
				);
				return (resp.memoryRecordSummaries || []).map((r) =>
					mapAgentCoreRecord(r, agent, strategy),
				);
			} catch (err) {
				// Missing namespace / no extracted records yet is normal —
				// the strategies run in the background and may not have
				// processed any events yet. Log at debug only.
				// eslint-disable-next-line no-console
				console.debug(
					`[memoryRecords] AgentCore list failed for ${agent.id}/${prefix(agent.id)}:`,
					(err as Error)?.message,
				);
				return [] as MemoryRow[];
			}
		});
		const results = await Promise.all(calls);
		for (const arr of results) out.push(...arr);
	}
	return out;
}

function mapAgentCoreRecord(
	r: {
		memoryRecordId?: string;
		content?: { text?: string } | any;
		memoryStrategyId?: string;
		namespaces?: string[];
		createdAt?: Date;
		score?: number;
		metadata?: Record<string, any>;
	},
	agent: { id: string; slug: string },
	strategy: string,
): MemoryRow {
	// MemoryContent is a discriminated union; the TextMember has a
	// `text` string. Be defensive against the `$unknown` member.
	const text =
		(r.content && typeof (r.content as any).text === "string"
			? (r.content as any).text
			: "") || "";
	const ns = r.namespaces && r.namespaces.length > 0 ? r.namespaces[0] : "";
	const createdAtISO = r.createdAt ? r.createdAt.toISOString() : null;
	return {
		memoryRecordId: r.memoryRecordId || `${agent.id}-${ns}-${Math.random()}`,
		content: { text },
		createdAt: createdAtISO,
		updatedAt: createdAtISO,
		expiresAt: null,
		namespace: ns || agent.id,
		strategyId: r.memoryStrategyId || null,
		strategy,
		score: typeof r.score === "number" ? r.score : null,
		agentSlug: agent.slug,
		factType: null,
		confidence: typeof r.score === "number" ? r.score : null,
		eventDate: null,
		occurredStart: null,
		occurredEnd: null,
		mentionedAt: null,
		tags: null,
		accessCount: 0,
		proofCount: null,
		context: null,
		_sortKey: r.createdAt ? r.createdAt.getTime() : 0,
	};
}

// ---------------------------------------------------------------------------
// Hindsight backend
// ---------------------------------------------------------------------------

async function fetchHindsightRecords(agentSlugs: string[]): Promise<MemoryRow[]> {
	if (!process.env.HINDSIGHT_ENDPOINT) return [];

	const bankIdList = sql.join(agentSlugs.map((b) => sql`${b}`), sql`, `);
	let result: any;
	try {
		result = await db.execute(sql`
			SELECT
				id, bank_id, text, context, fact_type,
				event_date, occurred_start, occurred_end,
				mentioned_at, tags, access_count, proof_count,
				metadata, created_at, updated_at
			FROM hindsight.memory_units
			WHERE bank_id IN (${bankIdList})
			ORDER BY created_at DESC
			LIMIT 500
		`);
	} catch {
		// hindsight schema may not exist even when HINDSIGHT_ENDPOINT is set
		// (e.g. during a provisioning window). Return empty rather than
		// throw so AgentCore results still surface.
		return [];
	}

	return (result.rows || []).map((r: any): MemoryRow => {
		const strategy = factTypeToStrategy(r.fact_type);
		let meta: any = {};
		try {
			meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata || {});
		} catch {}
		const createdAt = toISO(r.created_at);
		return {
			memoryRecordId: String(r.id),
			content: { text: String(r.text || "") },
			createdAt,
			updatedAt: toISO(r.updated_at),
			expiresAt: null,
			namespace: r.bank_id || "",
			strategyId: r.fact_type || strategy,
			strategy,
			score: meta.confidence ?? null,
			agentSlug: r.bank_id || null,
			factType: r.fact_type || null,
			confidence: meta.confidence ?? null,
			eventDate: toISO(r.event_date),
			occurredStart: toISO(r.occurred_start),
			occurredEnd: toISO(r.occurred_end),
			mentionedAt: toISO(r.mentioned_at),
			tags: r.tags && r.tags.length > 0 ? r.tags : null,
			accessCount: r.access_count ?? 0,
			proofCount: r.proof_count ?? null,
			context: r.context || null,
			_sortKey: createdAt ? new Date(createdAt).getTime() : 0,
		};
	});
}

function toISO(val: any): string | null {
	if (!val) return null;
	try {
		return new Date(val).toISOString();
	} catch {
		return null;
	}
}

function factTypeToStrategy(factType: string | null): string {
	switch (factType) {
		case "world":
			return "semantic";
		case "experience":
			return "episodes";
		case "opinion":
			return "preferences";
		case "observation":
			return "reflections";
		default:
			return "semantic";
	}
}
