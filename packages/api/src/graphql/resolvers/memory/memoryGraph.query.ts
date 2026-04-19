/**
 * memoryGraph — Fetch knowledge graph from the active memory engine.
 *
 * Capability-gated: engines without graph inspection (AgentCore) return
 * an empty graph. Hindsight's entity / cooccurrence tables live directly
 * in the shared Aurora instance so the SQL path stays inline here,
 * gated on the adapter's `inspectGraph` capability.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, sql, agents } from "../../utils.js";
import { getMemoryServices } from "../../../lib/memory/index.js";

export const memoryGraph = async (
	_parent: unknown,
	args: { assistantId: string },
	ctx: GraphQLContext,
) => {
	const { assistantId } = args;

	const [agent] = await db
		.select({ id: agents.id, tenant_id: agents.tenant_id, slug: agents.slug })
		.from(agents)
		.where(eq(agents.id, assistantId));

	if (!agent || (ctx.auth.tenantId && agent.tenant_id !== ctx.auth.tenantId)) {
		throw new Error("Agent not found or access denied");
	}

	const { inspect: inspectService } = getMemoryServices();
	const capabilities = await inspectService.capabilities();
	if (!capabilities.inspectGraph) {
		return { nodes: [], edges: [] };
	}

	const bankId = agent.slug;
	if (!bankId) {
		return { nodes: [], edges: [] };
	}

	let entityRows: any;
	try {
		entityRows = await db.execute(sql`
			SELECT id, canonical_name, mention_count, metadata
			FROM hindsight.entities
			WHERE bank_id = ${bankId}
			ORDER BY mention_count DESC
			LIMIT 200
		`);
	} catch {
		return { nodes: [], edges: [] };
	}

	const edgeRows = await db.execute(sql`
		SELECT
			e1.id AS source_id,
			e2.id AS target_id,
			ec.cooccurrence_count
		FROM hindsight.entity_cooccurrences ec
		JOIN hindsight.entities e1 ON e1.id = ec.entity_id_1
		JOIN hindsight.entities e2 ON e2.id = ec.entity_id_2
		WHERE e1.bank_id = ${bankId}
		ORDER BY ec.cooccurrence_count DESC
		LIMIT 500
	`);

	const entityIds: string[] = (entityRows.rows || []).map((r: any) => String(r.id));

	// For each entity, look up the most recent source memory_unit that carries
	// a thread_id in its metadata. Surfaces the originating thread in the
	// knowledge-graph detail sheet. One query, bounded by the 200-entity cap.
	const threadByEntity = new Map<string, string>();
	if (entityIds.length > 0) {
		try {
			const threadRows = await db.execute(sql`
				SELECT DISTINCT ON (ue.entity_id)
					ue.entity_id::text AS entity_id,
					m.metadata->>'thread_id' AS thread_id
				FROM hindsight.unit_entities ue
				JOIN hindsight.memory_units m ON m.id = ue.unit_id
				WHERE ue.entity_id = ANY(${entityIds}::uuid[])
					AND m.metadata->>'thread_id' IS NOT NULL
				ORDER BY ue.entity_id, m.created_at DESC
			`);
			for (const tr of (threadRows.rows || []) as any[]) {
				if (tr.entity_id && tr.thread_id) {
					threadByEntity.set(String(tr.entity_id), String(tr.thread_id));
				}
			}
		} catch {
			// Best-effort — missing unit_entities or metadata just means no link.
		}
	}

	const nodes = (entityRows.rows || []).map((r: any) => {
		let meta: any = {};
		try {
			meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata || {});
		} catch { /* ignore */ }
		const id = String(r.id);
		return {
			id,
			label: String(r.canonical_name || ""),
			type: "entity",
			strategy: null,
			entityType: meta.ontology_type || null,
			edgeCount: Number(r.mention_count) || 0,
			latestThreadId: threadByEntity.get(id) || null,
		};
	});

	const maxCooccurrence = Math.max(
		1,
		...(edgeRows.rows || []).map((r: any) => Number(r.cooccurrence_count) || 1),
	);

	const edges = (edgeRows.rows || []).map((r: any) => ({
		source: String(r.source_id),
		target: String(r.target_id),
		type: "COOCCURS",
		label: null,
		weight: (Number(r.cooccurrence_count) || 1) / maxCooccurrence,
	}));

	return { nodes, edges };
};
