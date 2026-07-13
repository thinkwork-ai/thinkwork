/**
 * Shared test doubles for the capability-broker suites (THINK-280 U3).
 *
 * An in-memory {@link DynamoPort} that evaluates the structured
 * {@link DynamoCondition} predicates the session store emits — enough to
 * exercise the conditional writes (sequence consume, nonce uniqueness,
 * session creation) with real atomicity semantics under Promise.all, with no
 * AWS dependency. Also a capturing evidence store for the handler tests.
 */

import type {
  DynamoCondition,
  DynamoPort,
  DynamoPutInput,
  DynamoUpdateInput,
  DynamoWriteResult,
} from "../lib/capability-broker/sessions.js";
import type {
  BrokerCallEvidenceRow,
  BrokerCallFinalizePatch,
  EvidenceStore,
  StoredBrokerCall,
} from "../lib/capability-broker/evidence.js";

function keyOf(pk: string, sk: string): string {
  return pk + "" + sk;
}

function evalCondition(
  cond: DynamoCondition | undefined,
  item: Record<string, unknown> | undefined,
): boolean {
  if (!cond) return true;
  switch (cond.kind) {
    case "attribute_not_exists":
      return item === undefined || item[cond.attribute] === undefined;
    case "attribute_exists":
      return item !== undefined && item[cond.attribute] !== undefined;
    case "equals":
      return item !== undefined && item[cond.attribute] === cond.value;
    case "greater_than":
      return (
        item !== undefined &&
        typeof item[cond.attribute] === "number" &&
        (item[cond.attribute] as number) > cond.value
      );
    case "and":
      return cond.conditions.every((c) => evalCondition(c, item));
  }
}

export interface FakeDynamo extends DynamoPort {
  readonly store: Map<string, Record<string, unknown>>;
  putCount: number;
  updateCount: number;
  /** Read a raw stored item by its logical key (decoupled from the encoding). */
  raw(pk: string, sk: string): Record<string, unknown> | undefined;
}

/**
 * The map is mutated synchronously inside each async method body before any
 * await, so `Promise.all` over concurrent conditional updates still resolves
 * to exactly one winner — mirroring a DynamoDB conditional write.
 */
export function createFakeDynamo(): FakeDynamo {
  const store = new Map<string, Record<string, unknown>>();
  return {
    store,
    putCount: 0,
    updateCount: 0,
    raw(pk: string, sk: string) {
      return store.get(keyOf(pk, sk));
    },
    async put(input: DynamoPutInput): Promise<DynamoWriteResult> {
      this.putCount++;
      const pk = String(input.item.pk);
      const sk = String(input.item.sk);
      const k = keyOf(pk, sk);
      const existing = store.get(k);
      if (!evalCondition(input.condition, existing)) {
        return { ok: false, conditionFailed: true };
      }
      const item = { ...input.item };
      store.set(k, item);
      return { ok: true, item };
    },
    async get(key: { pk: string; sk: string }) {
      const item = store.get(keyOf(key.pk, key.sk));
      return item ? { ...item } : null;
    },
    async update(input: DynamoUpdateInput): Promise<DynamoWriteResult> {
      this.updateCount++;
      const k = keyOf(input.key.pk, input.key.sk);
      const existing = store.get(k);
      if (!evalCondition(input.condition, existing)) {
        return { ok: false, conditionFailed: true };
      }
      const item = {
        ...(existing ?? { pk: input.key.pk, sk: input.key.sk }),
        ...input.set,
      };
      store.set(k, item);
      return { ok: true, item: input.returnUpdated ? { ...item } : undefined };
    },
    async delete(key: { pk: string; sk: string }) {
      store.delete(keyOf(key.pk, key.sk));
    },
  };
}

// ---------------------------------------------------------------------------
// Capturing evidence store
// ---------------------------------------------------------------------------

export interface FakeEvidenceStore extends EvidenceStore {
  readonly rows: Map<string, StoredBrokerCall>;
  readonly inserted: StoredBrokerCall[];
  finalizeShouldThrow: boolean;
}

export function createFakeEvidenceStore(): FakeEvidenceStore {
  const rows = new Map<string, StoredBrokerCall>();
  const inserted: StoredBrokerCall[] = [];
  let counter = 0;
  return {
    rows,
    inserted,
    finalizeShouldThrow: false,
    async insert(row: BrokerCallEvidenceRow): Promise<{ id: string }> {
      const id = `call-${++counter}`;
      const stored: StoredBrokerCall = { ...row, id };
      rows.set(id, stored);
      inserted.push(stored);
      return { id };
    },
    async finalize(id: string, patch: BrokerCallFinalizePatch): Promise<void> {
      if (this.finalizeShouldThrow) {
        throw new Error("simulated terminal ledger failure");
      }
      const existing = rows.get(id);
      if (existing) rows.set(id, { ...existing, ...patch });
    },
    async findByClientRequestId(
      brokerSessionId: string,
      clientRequestId: string,
    ): Promise<StoredBrokerCall | null> {
      for (const row of rows.values()) {
        if (
          row.broker_session_id === brokerSessionId &&
          row.client_request_id === clientRequestId
        ) {
          return row;
        }
      }
      return null;
    },
  };
}
