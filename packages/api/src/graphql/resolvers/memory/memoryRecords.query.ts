/**
 * memoryRecords — List memory records from Hindsight's memory_units table.
 *
 * PRD-41B Phase 5: Replaces AgentCore Memory reads with direct Hindsight
 * Postgres queries against the `hindsight` schema.
 *
 * Supports single-agent (assistantId = agent UUID) and all-agents mode
 * (assistantId = "all", requires tenantId from auth context).
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, sql, agents } from "../../utils.js";

export const memoryRecords = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { assistantId } = args as { assistantId: string; namespace: string };

	let bankIds: string[];

	if (assistantId === "all") {
		if (!ctx.auth.tenantId) throw new Error("Tenant context required for all-agents query");
		const agentRows = await db
			.select({ slug: agents.slug })
			.from(agents)
			.where(eq(agents.tenant_id, ctx.auth.tenantId));
		bankIds = agentRows.map((a) => a.slug).filter(Boolean) as string[];
		if (bankIds.length === 0) return [];
	} else {
		const [agent] = await db
			.select({ tenant_id: agents.tenant_id, slug: agents.slug })
			.from(agents)
			.where(eq(agents.id, assistantId));
		if (!agent || (ctx.auth.tenantId && agent.tenant_id !== ctx.auth.tenantId)) {
			throw new Error("Agent not found or access denied");
		}
		bankIds = [agent.slug || assistantId];
	}

	const bankIdList = sql.join(bankIds.map((b) => sql`${b}`), sql`, `);
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
		// Hindsight schema may not exist (managed memory engine)
		return [];
	}

	return (result.rows || []).map((r: any) => {
		const strategy = factTypeToStrategy(r.fact_type);
		let meta: any = {};
		try { meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata || {}); } catch {}
		return {
			memoryRecordId: String(r.id),
			content: { text: String(r.text || "") },
			createdAt: toISO(r.created_at),
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
		};
	});
};

function toISO(val: any): string | null {
	if (!val) return null;
	try { return new Date(val).toISOString(); } catch { return null; }
}

function factTypeToStrategy(factType: string | null): string {
	switch (factType) {
		case "world": return "semantic";
		case "experience": return "episodes";
		case "opinion": return "preferences";
		case "observation": return "reflections";
		default: return "semantic";
	}
}
