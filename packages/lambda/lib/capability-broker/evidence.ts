/**
 * Capability broker evidence (THINK-280 U3).
 *
 * Append-only `capability_broker_calls` rows for BOTH rejected and accepted
 * attempts. The durable row is created in `authorized` state BEFORE any
 * credential resolution or adapter dispatch and finalized AFTER the normalized
 * result, so a lost HTTP response can be reconstructed from the row (the
 * signed status path) without ever re-dispatching. A finalize failure after a
 * provider effect leaves the row `indeterminate` for operator reconciliation.
 *
 * Digests are safe by construction: the RFC 8785 SHA-256 of the request input
 * / result payload — never secret material, never an unbounded provider body.
 *
 * The store is injected so tests use a capturing fake; the Lambda binds the
 * Drizzle-backed implementation (createDrizzleEvidenceStore).
 */

import {
  canonicalSha256Hex,
  type CanonicalJson,
} from "@thinkwork/capability-contracts";

export type BrokerCallStatus =
  | "rejected"
  | "authorized"
  | "completed"
  | "accepted"
  | "failed"
  | "indeterminate";

/** The persisted evidence row (mirrors capability_broker_calls columns). */
export interface BrokerCallEvidenceRow {
  tenant_id: string;
  broker_session_id: string;
  client_request_id: string;
  sequence: number | null;
  operation_ref: string | null;
  contract_hash: string | null;
  definition_version_id: string | null;
  binding_id: string | null;
  status: BrokerCallStatus;
  policy_decisions_json: Record<string, unknown>;
  request_digest: string | null;
  result_digest: string | null;
  error_category: string | null;
  effect: string | null;
  budget_delta_json: Record<string, unknown>;
  adapter_kind: string | null;
  duration_ms: number | null;
  durable_ref_json: Record<string, unknown> | null;
  routine_execution_id: string | null;
  thread_turn_id: string | null;
  compliance_event_id: string | null;
  authorized_at: Date | null;
  finalized_at: Date | null;
}

/** A finalize patch — only the terminal-outcome columns are mutable. */
export interface BrokerCallFinalizePatch {
  status: BrokerCallStatus;
  result_digest?: string | null;
  error_category?: string | null;
  duration_ms?: number | null;
  durable_ref_json?: Record<string, unknown> | null;
  finalized_at?: Date | null;
}

export interface StoredBrokerCall extends BrokerCallEvidenceRow {
  id: string;
}

export interface EvidenceStore {
  insert(row: BrokerCallEvidenceRow): Promise<{ id: string }>;
  finalize(id: string, patch: BrokerCallFinalizePatch): Promise<void>;
  findByClientRequestId(
    brokerSessionId: string,
    clientRequestId: string,
  ): Promise<StoredBrokerCall | null>;
}

// ---------------------------------------------------------------------------
// Safe digests
// ---------------------------------------------------------------------------

/** RFC 8785 SHA-256 hex of the request input — never the raw payload. */
export function digestRequestInput(input: CanonicalJson): string {
  return canonicalSha256Hex(input);
}

/** RFC 8785 SHA-256 hex of an arbitrary result value — safe to store. */
export function digestResult(value: CanonicalJson): string {
  return canonicalSha256Hex(value);
}

// ---------------------------------------------------------------------------
// Drizzle-backed store
// ---------------------------------------------------------------------------

/**
 * Minimal Drizzle surface the store needs. Kept structural so packages/lambda
 * does not have to import the concrete Drizzle db type here — the handler
 * passes `getDb()` and the `capabilityBrokerCalls` table.
 */
export interface EvidenceDbHandle {
  insert(table: unknown): {
    values(row: Record<string, unknown>): {
      returning(cols: Record<string, unknown>): Promise<Array<{ id: string }>>;
    };
  };
  update(table: unknown): {
    set(patch: Record<string, unknown>): {
      where(predicate: unknown): Promise<unknown>;
    };
  };
  select(cols: Record<string, unknown>): {
    from(table: unknown): {
      where(predicate: unknown): {
        limit(n: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
}

export interface DrizzleEvidenceDeps {
  db: EvidenceDbHandle;
  table: unknown;
  columns: {
    id: unknown;
    broker_session_id: unknown;
    client_request_id: unknown;
  };
  /** drizzle-orm `eq` / `and` — injected to avoid a hard import here. */
  eq: (a: unknown, b: unknown) => unknown;
  and: (...preds: unknown[]) => unknown;
}

export function createDrizzleEvidenceStore(
  deps: DrizzleEvidenceDeps,
): EvidenceStore {
  const { db, table, columns, eq, and } = deps;
  return {
    async insert(row: BrokerCallEvidenceRow): Promise<{ id: string }> {
      const inserted = await db
        .insert(table)
        .values(row as unknown as Record<string, unknown>)
        .returning({ id: columns.id });
      const id = inserted[0]?.id;
      if (!id) {
        throw new Error("capability-broker: evidence insert returned no id");
      }
      return { id };
    },
    async finalize(id: string, patch: BrokerCallFinalizePatch): Promise<void> {
      await db
        .update(table)
        .set(patch as unknown as Record<string, unknown>)
        .where(eq(columns.id, id));
    },
    async findByClientRequestId(
      brokerSessionId: string,
      clientRequestId: string,
    ): Promise<StoredBrokerCall | null> {
      const rows = await db
        .select({})
        .from(table)
        .where(
          and(
            eq(columns.broker_session_id, brokerSessionId),
            eq(columns.client_request_id, clientRequestId),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row ? (row as unknown as StoredBrokerCall) : null;
    },
  };
}
