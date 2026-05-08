/**
 * Compliance audit-event read resolvers (Phase 3 U10).
 *
 * Three queries:
 *   - complianceEvents(filter, after, first): cursor-paginated list
 *   - complianceEvent(eventId): single event by id
 *   - complianceEventByHash(eventHash): single event by hash (for the
 *     drawer's prev_hash chain-position click-through)
 *
 * All three resolvers run through `requireComplianceReader(ctx, ...)`
 * which enforces:
 *   - apikey hard-block (Cognito-only)
 *   - operator-vs-tenant scope via THINKWORK_PLATFORM_OPERATOR_EMAILS
 *   - null-tenant fail-closed for non-operator users
 *
 * SQL runs against the `compliance_reader` Aurora role via the lazy
 * pg client in `packages/api/src/lib/compliance/reader-db.ts`. The
 * existing `graphql_db_secret_arn` pool used by every other resolver
 * is untouched.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { getComplianceReaderClient } from "../../../lib/compliance/reader-db.js";
import { requireComplianceReader } from "../../../lib/compliance/resolver-auth.js";
import {
	dbEventTypeToGql,
	gqlEventTypeToDb,
} from "../../../lib/compliance/event-type-codec.js";
import {
	decodeCursor,
	encodeCursor,
	type ComplianceEventCursor,
} from "../../../lib/compliance/cursor.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

interface ComplianceEventFilterInput {
	tenantId?: string | null;
	actorType?: "USER" | "SYSTEM" | "AGENT" | null;
	eventType?: string | null;
	since?: string | null;
	until?: string | null;
}

interface ComplianceEventsArgs {
	filter?: ComplianceEventFilterInput | null;
	after?: string | null;
	first?: number | null;
}

interface AuditEventRow {
	event_id: string;
	tenant_id: string;
	occurred_at: string;
	recorded_at: string;
	actor: string;
	actor_type: string;
	source: string;
	event_type: string;
	event_hash: string;
	prev_hash: string | null;
	payload: unknown;
}

interface TenantAnchorStateRow {
	tenant_id: string;
	last_anchored_recorded_at: string | null;
	last_cadence_id: string | null;
}

const SELECT_AUDIT_EVENT_COLS = `
	event_id::text AS event_id,
	tenant_id::text AS tenant_id,
	occurred_at::text AS occurred_at,
	recorded_at::text AS recorded_at,
	actor,
	actor_type,
	source,
	event_type,
	event_hash,
	prev_hash,
	payload
`;

function rowToGql(row: AuditEventRow, anchor: TenantAnchorStateRow | null) {
	const anchorStatus = computeAnchorStatus(row, anchor);
	return {
		eventId: row.event_id,
		tenantId: row.tenant_id,
		occurredAt: row.occurred_at,
		recordedAt: row.recorded_at,
		actor: row.actor,
		actorType: row.actor_type.toUpperCase(),
		source: row.source,
		eventType: dbEventTypeToGql(row.event_type),
		eventHash: row.event_hash,
		prevHash: row.prev_hash,
		payload: row.payload,
		anchorStatus,
	};
}

function computeAnchorStatus(
	event: AuditEventRow,
	anchor: TenantAnchorStateRow | null,
): {
	state: "ANCHORED" | "PENDING";
	cadenceId: string | null;
	anchoredRecordedAt: string | null;
	nextCadenceWithinMinutes: number | null;
} {
	if (
		anchor &&
		anchor.last_anchored_recorded_at &&
		anchor.last_cadence_id &&
		event.occurred_at <= anchor.last_anchored_recorded_at
	) {
		return {
			state: "ANCHORED",
			cadenceId: anchor.last_cadence_id,
			anchoredRecordedAt: anchor.last_anchored_recorded_at,
			nextCadenceWithinMinutes: null,
		};
	}
	return {
		state: "PENDING",
		cadenceId: null,
		anchoredRecordedAt: null,
		// Anchor cadence runs every 15 minutes (rate(15 minutes) per U8a).
		nextCadenceWithinMinutes: 15,
	};
}

async function fetchAnchorState(
	client: { query: (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }> },
	tenantId: string,
): Promise<TenantAnchorStateRow | null> {
	const res = await client.query(
		`SELECT tenant_id::text AS tenant_id,
		        last_anchored_recorded_at::text AS last_anchored_recorded_at,
		        last_cadence_id::text AS last_cadence_id
		   FROM compliance.tenant_anchor_state
		  WHERE tenant_id = $1::uuid
		  LIMIT 1`,
		[tenantId],
	);
	const rows = res.rows as TenantAnchorStateRow[];
	return rows.length > 0 ? rows[0] : null;
}

// ---------------------------------------------------------------------------
// complianceEvents — paginated list
// ---------------------------------------------------------------------------

export async function complianceEvents(
	_parent: unknown,
	args: ComplianceEventsArgs,
	ctx: GraphQLContext,
): Promise<{
	edges: { node: ReturnType<typeof rowToGql>; cursor: string }[];
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
}> {
	const filter = args.filter ?? {};
	const auth = await requireComplianceReader(ctx, filter.tenantId ?? undefined);

	const limit = Math.min(
		Math.max(typeof args.first === "number" ? args.first : DEFAULT_PAGE_SIZE, 1),
		MAX_PAGE_SIZE,
	);

	let cursor: ComplianceEventCursor | undefined;
	if (args.after) {
		try {
			cursor = decodeCursor(args.after);
		} catch (err) {
			throw new GraphQLError(
				`Invalid cursor: ${err instanceof Error ? err.message : String(err)}`,
				{ extensions: { code: "BAD_USER_INPUT" } },
			);
		}
	}

	const wheres: string[] = [];
	const values: unknown[] = [];
	let n = 0;
	const next = () => `$${++n}`;

	if (auth.effectiveTenantId) {
		wheres.push(`tenant_id = ${next()}::uuid`);
		values.push(auth.effectiveTenantId);
	}
	if (filter.actorType) {
		wheres.push(`actor_type = ${next()}`);
		values.push(filter.actorType.toLowerCase());
	}
	if (filter.eventType) {
		wheres.push(`event_type = ${next()}`);
		values.push(gqlEventTypeToDb(filter.eventType));
	}
	if (filter.since) {
		wheres.push(`occurred_at >= ${next()}::timestamptz`);
		values.push(filter.since);
	}
	if (filter.until) {
		wheres.push(`occurred_at < ${next()}::timestamptz`);
		values.push(filter.until);
	}
	if (cursor) {
		// (occurred_at, event_id) < ($cursor_occurred_at, $cursor_event_id)
		// — half-open boundary so the cursor's row is NOT included on the
		// next page (it was the last edge of the previous page).
		wheres.push(
			`(occurred_at, event_id) < (${next()}::timestamptz, ${next()}::uuid)`,
		);
		values.push(cursor.occurredAt, cursor.eventId);
	}

	const whereClause = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";
	// Parameterize LIMIT for consistency with the rest of the query.
	// `limit` is sanitized by the Math.min/Math.max clamp above; pushing
	// it as a parameter just avoids hand-built SQL string interpolation
	// for a value that's reviewed-as-safe today but easy to extend
	// unsafely tomorrow.
	const limitPlaceholder = next();
	values.push(limit + 1);
	const sql = `SELECT ${SELECT_AUDIT_EVENT_COLS}
		   FROM compliance.audit_events
		   ${whereClause}
		   ORDER BY occurred_at DESC, event_id DESC
		   LIMIT ${limitPlaceholder}`;

	const client = await getComplianceReaderClient();
	const res = await client.query(sql, values);
	const rows = res.rows as AuditEventRow[];

	const hasNextPage = rows.length > limit;
	const pageRows = hasNextPage ? rows.slice(0, limit) : rows;

	// Resolve anchor state per-tenant in parallel. With limit=50 and most
	// pages spanning ≤4 distinct tenants, this is a handful of indexed
	// PK lookups — O(distinct tenants), not O(rows).
	const distinctTenants = Array.from(
		new Set(pageRows.map((r) => r.tenant_id)),
	);
	const anchorEntries = await Promise.all(
		distinctTenants.map(
			async (tid) =>
				[tid, await fetchAnchorState(client, tid)] as const,
		),
	);
	const anchorStateByTenant = new Map<string, TenantAnchorStateRow | null>(
		anchorEntries,
	);

	const edges = pageRows.map((row) => {
		const anchor = anchorStateByTenant.get(row.tenant_id) ?? null;
		const node = rowToGql(row, anchor);
		const cursor = encodeCursor({
			occurredAt: row.occurred_at,
			eventId: row.event_id,
		});
		return { node, cursor };
	});

	return {
		edges,
		pageInfo: {
			hasNextPage,
			endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
		},
	};
}

// ---------------------------------------------------------------------------
// complianceEvent — single event by id
// ---------------------------------------------------------------------------

interface ComplianceEventArgs {
	eventId: string;
}

export async function complianceEvent(
	_parent: unknown,
	args: ComplianceEventArgs,
	ctx: GraphQLContext,
): Promise<ReturnType<typeof rowToGql> | null> {
	const auth = await requireComplianceReader(ctx, undefined);

	const client = await getComplianceReaderClient();
	// Tenant filter in WHERE clause for non-operators — collapses
	// "exists but forbidden" and "doesn't exist" to the same DB code
	// path. Closes the timing-side-channel existence oracle.
	const wheres = [`event_id = $1::uuid`];
	const values: unknown[] = [args.eventId];
	if (!auth.isOperator && auth.effectiveTenantId) {
		wheres.push(`tenant_id = $2::uuid`);
		values.push(auth.effectiveTenantId);
	}

	const res = await client.query(
		`SELECT ${SELECT_AUDIT_EVENT_COLS}
		   FROM compliance.audit_events
		  WHERE ${wheres.join(" AND ")}
		  LIMIT 1`,
		values,
	);
	const rows = res.rows as AuditEventRow[];
	if (rows.length === 0) return null;
	const row = rows[0];

	const anchor = await fetchAnchorState(client, row.tenant_id);
	return rowToGql(row, anchor);
}

// ---------------------------------------------------------------------------
// complianceEventByHash — single event by hash (chain-position drawer)
// ---------------------------------------------------------------------------

interface ComplianceEventByHashArgs {
	eventHash: string;
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

export async function complianceEventByHash(
	_parent: unknown,
	args: ComplianceEventByHashArgs,
	ctx: GraphQLContext,
): Promise<ReturnType<typeof rowToGql> | null> {
	const auth = await requireComplianceReader(ctx, undefined);

	// Format guard (SEC-004 finding): event_hash MUST be exactly 64 hex
	// chars (SHA-256 hex output length). Reject malformed input BEFORE
	// hitting the DB — closes the chain-walk amplification path where a
	// caller could fire the resolver with an oversized string at high
	// frequency. Returns null (consistent with "not found" semantics)
	// rather than throwing so the chain-walk UI degrades gracefully.
	if (!SHA256_HEX_RE.test(args.eventHash)) {
		return null;
	}

	const client = await getComplianceReaderClient();
	const wheres = [`event_hash = $1`];
	const values: unknown[] = [args.eventHash.toLowerCase()];
	if (!auth.isOperator && auth.effectiveTenantId) {
		wheres.push(`tenant_id = $2::uuid`);
		values.push(auth.effectiveTenantId);
	}

	const res = await client.query(
		`SELECT ${SELECT_AUDIT_EVENT_COLS}
		   FROM compliance.audit_events
		  WHERE ${wheres.join(" AND ")}
		  LIMIT 1`,
		values,
	);
	const rows = res.rows as AuditEventRow[];
	if (rows.length === 0) return null;
	const row = rows[0];

	const anchor = await fetchAnchorState(client, row.tenant_id);
	return rowToGql(row, anchor);
}

// ---------------------------------------------------------------------------
// complianceTenants — distinct tenant_ids visible to caller
// ---------------------------------------------------------------------------

export async function complianceTenants(
	_parent: unknown,
	_args: unknown,
	ctx: GraphQLContext,
): Promise<string[]> {
	const auth = await requireComplianceReader(ctx, undefined);

	// Non-operator short-circuit: skip the DB roundtrip entirely; the
	// caller can only see their own tenant. Cross-validates the auth
	// pre-check (effectiveTenantId is non-null for non-operators
	// because requireComplianceReader fail-closes UNAUTHENTICATED if
	// it's null).
	if (!auth.isOperator) {
		return auth.effectiveTenantId ? [auth.effectiveTenantId] : [];
	}

	const client = await getComplianceReaderClient();
	const res = await client.query(
		`SELECT DISTINCT tenant_id::text AS tenant_id
		   FROM compliance.audit_events
		  ORDER BY tenant_id::text ASC`,
		[],
	);
	const rows = res.rows as { tenant_id: string }[];
	return rows.map((r) => r.tenant_id);
}

// ---------------------------------------------------------------------------
// complianceOperatorCheck — caller's operator status + dev-env signal
// ---------------------------------------------------------------------------

export interface ComplianceOperatorCheckResult {
	isOperator: boolean;
	allowlistConfigured: boolean;
}

export async function complianceOperatorCheck(
	_parent: unknown,
	_args: unknown,
	ctx: GraphQLContext,
): Promise<ComplianceOperatorCheckResult> {
	// Apikey hard-block: even the operator-check is Cognito-only —
	// internal tools holding API_AUTH_SECRET have no business asking
	// "am I an operator." Mirrors requireComplianceReader's gate.
	if (ctx.auth.authType !== "cognito") {
		// Return both false rather than throw — UI-friendlier; the apikey
		// caller is hard-blocked at the actual list/event resolvers anyway.
		return { isOperator: false, allowlistConfigured: false };
	}
	const allowlist = (process.env.THINKWORK_PLATFORM_OPERATOR_EMAILS ?? "")
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	const allowlistConfigured = allowlist.length > 0;
	const email =
		typeof ctx.auth.email === "string" ? ctx.auth.email.toLowerCase() : "";
	const isOperator =
		allowlistConfigured && email !== "" && allowlist.includes(email);
	return { isOperator, allowlistConfigured };
}
