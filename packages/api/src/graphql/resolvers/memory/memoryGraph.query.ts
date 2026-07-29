/**
 * memoryGraph — Fetch the memory graph from the active memory engine.
 *
 * Capability-gated: engines without graph inspection (AgentCore) return
 * an empty graph. Hindsight's entity / cooccurrence tables live directly
 * in the shared Aurora instance so the SQL path stays inline here,
 * gated on the adapter's `inspectGraph` capability.
 */

import { hindsightSql, resolveHindsightDb } from "@thinkwork/database-pg";
import type { GraphQLContext } from "../../context.js";
import { db, sql } from "../../utils.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

/**
 * Enumerate every Hindsight bank in a tenant, tenant-safely. Mirrors the
 * `inspectTenant` adapter path (THINK-220): bank identity is derived from the
 * thinkwork tables (tenant_members / spaces / agents) scoped by `tenant_id`,
 * NOT from the Hindsight `banks` table (which carries no tenant_id — a naive
 * scan there would leak entities across tenants). Returns bank_id → label.
 */
async function tenantBankLabels(
  tenantId: string,
): Promise<Map<string, string>> {
  const rows: any = await db.execute(sql`
    SELECT DISTINCT ('user_' || tm.principal_id::text) AS bank_id,
      COALESCE(u.name, u.email, tm.principal_id::text) AS name
    FROM tenant_members tm
    LEFT JOIN users u ON u.id = tm.principal_id
    WHERE tm.tenant_id = ${tenantId}
      AND lower(tm.principal_type) = 'user'
      AND tm.status = 'active'
    UNION
    SELECT DISTINCT ('space_' || s.id::text) AS bank_id,
      COALESCE(s.name, s.slug, s.id::text) AS name
    FROM spaces s
    WHERE s.tenant_id = ${tenantId}
    UNION
    SELECT DISTINCT a.id::text AS bank_id,
      COALESCE(a.name, a.slug, a.id::text) AS name
    FROM agents a
    WHERE a.tenant_id = ${tenantId}
    UNION
    SELECT ('tenant_' || t.id::text) AS bank_id,
      (t.name || ' (Company Brain)') AS name
    FROM tenants t
    WHERE t.id = ${tenantId}
  `);
  const map = new Map<string, string>();
  for (const r of (rows.rows ?? []) as Array<{
    bank_id: string;
    name: string;
  }>) {
    if (r.bank_id) map.set(r.bank_id, r.name || r.bank_id);
  }
  return map;
}

export const memoryGraph = async (
  _parent: unknown,
  args: {
    tenantId?: string;
    userId?: string;
    assistantId?: string;
    allTenantBanks?: boolean;
  },
  ctx: GraphQLContext,
) => {
  // Tenant-wide mode is an operator surface: require tenant admin and span
  // every bank in the tenant. Otherwise stay scoped to the requester's bank.
  let bankLabels: Map<string, string> | null = null;
  if (args.allTenantBanks) {
    // ctx.auth.tenantId is null for Google-federated users; fall back to the
    // caller-resolved tenant (the documented OAuth pattern) so tenant-wide
    // graph queries work without the client threading tenantId.
    const tenantId =
      args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
    if (!tenantId) throw new Error("Tenant context required");
    await requireTenantAdmin(ctx, tenantId);
    bankLabels = await tenantBankLabels(tenantId);
  } else {
    const { userId } = await requireMemoryUserScope(ctx, {
      ...args,
      allowTenantAdmin: true,
    });
    bankLabels = new Map([[`user_${userId}`, "You"]]);
  }

  // The Bank facet builds from this authoritative, tenant-enumerated list —
  // never from which banks happened to land nodes in the capped graph — so
  // young space/tenant banks stay visible and selectable from day zero.
  const banks = [...bankLabels.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const { inspect: inspectService } = getMemoryServices();
  const capabilities = await inspectService.capabilities();
  if (!capabilities.inspectGraph) {
    return { nodes: [], edges: [], banks };
  }

  const bankIds = [...bankLabels.keys()];
  if (bankIds.length === 0) return { nodes: [], edges: [], banks };
  // Drizzle renders a bare JS-array param as a `($1, $2)` record, which
  // Postgres can't cast to an array — build ARRAY[...] explicitly.
  const bankIdArray = sql`ARRAY[${sql.join(
    bankIds.map((b) => sql`${b}`),
    sql`, `,
  )}]::text[]`;
  const uuidArray = (ids: string[]) =>
    sql`ARRAY[${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[]`;
  // Hindsight entity/cooccurrence tables — route to the Hindsight handle
  // (identical to `db` until the cutover env var is set).
  const hdb = resolveHindsightDb(db);

  // Per-bank ranking, not a global top-N: a global ORDER BY mention_count
  // starves young banks — 12k-unit user banks monopolize the cap while a
  // space or tenant bank's entire entity set (mention counts in the single
  // digits) never surfaces. Rank within each bank, take every bank's best
  // rows first, then fill by mention count up to the overall bound.
  let entityRows: any;
  try {
    entityRows = await hdb.execute(sql`
			SELECT id, canonical_name, mention_count, metadata, bank_id
			FROM (
				SELECT e.id, e.canonical_name, e.mention_count, e.metadata, e.bank_id,
					ROW_NUMBER() OVER (
						PARTITION BY e.bank_id
						ORDER BY e.mention_count DESC, e.id
					) AS bank_rank
				FROM ${hindsightSql()}entities e
				WHERE e.bank_id = ANY(${bankIdArray})
			) ranked
			WHERE bank_rank <= 25
			ORDER BY bank_rank ASC, mention_count DESC
			LIMIT 300
		`);
  } catch {
    return { nodes: [], edges: [], banks };
  }

  const entityIds: string[] = (entityRows.rows || []).map((r: any) =>
    String(r.id),
  );

  // Edges are restricted to the selected node set (both endpoints) so the
  // graph never references entities the per-bank selection dropped.
  let edgeRows: any = { rows: [] };
  if (entityIds.length > 0) {
    edgeRows = await hdb.execute(sql`
			SELECT
				ec.entity_id_1 AS source_id,
				ec.entity_id_2 AS target_id,
				ec.cooccurrence_count
			FROM ${hindsightSql()}entity_cooccurrences ec
			WHERE ec.entity_id_1 = ANY(${uuidArray(entityIds)})
				AND ec.entity_id_2 = ANY(${uuidArray(entityIds)})
			ORDER BY ec.cooccurrence_count DESC
			LIMIT 500
		`);
  }

  // For each entity, look up the most recent source memory_unit that carries
  // a thread_id in its metadata. Surfaces the originating thread in the
  // graph detail sheet. One query, bounded by the 200-entity cap.
  const threadByEntity = new Map<string, string>();
  if (entityIds.length > 0) {
    try {
      const threadRows = await hdb.execute(sql`
				SELECT DISTINCT ON (ue.entity_id)
					ue.entity_id::text AS entity_id,
					m.metadata->>'thread_id' AS thread_id
				FROM ${hindsightSql()}unit_entities ue
				JOIN ${hindsightSql()}memory_units m ON m.id = ue.unit_id
				WHERE ue.entity_id = ANY(${uuidArray(entityIds)})
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
      meta =
        typeof r.metadata === "string"
          ? JSON.parse(r.metadata)
          : r.metadata || {};
    } catch {
      /* ignore */
    }
    const id = String(r.id);
    const bankId = r.bank_id ? String(r.bank_id) : null;
    return {
      id,
      label: String(r.canonical_name || ""),
      type: "entity",
      strategy: null,
      entityType: meta.ontology_type || null,
      edgeCount: Number(r.mention_count) || 0,
      latestThreadId: threadByEntity.get(id) || null,
      bankId,
      bankName: bankId ? (bankLabels.get(bankId) ?? bankId) : null,
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

  return { nodes, edges, banks };
};
