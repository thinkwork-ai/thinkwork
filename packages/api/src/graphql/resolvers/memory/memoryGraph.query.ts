/**
 * memoryGraph — Fetch knowledge graph from Hindsight for visualization.
 *
 * Reads directly from Hindsight's tables in the `hindsight` schema
 * on the shared Aurora instance.
 *
 * Nodes = entities (people, orgs, concepts) — colored by ontology_type from metadata
 * Edges = entity cooccurrences — all labeled "COOCCURS"
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, sql, agents } from "../../utils.js";

export const memoryGraph = async (
	_parent: unknown,
	args: { assistantId: string },
	ctx: GraphQLContext,
) => {
	const { assistantId } = args;

	// Verify agent belongs to tenant and get slug (Hindsight bank_id)
	const [agent] = await db
		.select({ id: agents.id, tenant_id: agents.tenant_id, slug: agents.slug })
		.from(agents)
		.where(eq(agents.id, assistantId));

	if (!agent || (ctx.auth.tenantId && agent.tenant_id !== ctx.auth.tenantId)) {
		throw new Error("Agent not found or access denied");
	}

	const bankId = agent.slug;
	if (!bankId) {
		return { nodes: [], edges: [] };
	}

	// Query entities from Hindsight schema
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
		// Hindsight schema may not exist (managed memory engine)
		return { nodes: [], edges: [] };
	}

	// Query entity cooccurrences (edges)
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

	// Build nodes
	const nodes = (entityRows.rows || []).map((r: any) => {
		let meta: any = {};
		try {
			meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata || {});
		} catch { /* ignore */ }
		return {
			id: String(r.id),
			label: String(r.canonical_name || ""),
			type: "entity",
			strategy: null,
			entityType: meta.ontology_type || null,
			edgeCount: Number(r.mention_count) || 0,
		};
	});

	// Build edges
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
