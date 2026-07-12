/**
 * Minimal in-memory fake of the drizzle Database surface used by the
 * THINK-193 U2 claim-lifecycle code paths:
 *   - claims.ts    upsertClaimsForEvidence / deactivateOrphanedClaims
 *   - evidence.ts  recordAcquiredPage
 *
 * It works together with a per-test-file partial mock of "drizzle-orm" that
 * replaces ONLY the comparison builders with plain descriptor objects (see
 * drizzleConditionMocks below); everything else (pgTable, sql, …) stays the
 * real implementation so the schema module keeps loading. The fake
 * interprets ONLY the descriptors and chain methods the code under test
 * actually calls — it is deliberately not a general SQL engine.
 *
 * Usage in a test file:
 *
 *   vi.mock("drizzle-orm", async (importOriginal) => ({
 *     ...(await importOriginal<typeof import("drizzle-orm")>()),
 *     ...(await import("./test-support/drizzle-condition-mocks.js"))
 *       .drizzleConditionMocks,
 *   }));
 *
 * The factory must import drizzle-condition-mocks.js (import-less), NEVER
 * this file — this file imports the schema, which imports drizzle-orm,
 * which re-enters the factory and deadlocks module resolution.
 */

import type { Database } from "@thinkwork/database-pg";
import {
  memoryClaimEvidence,
  memoryClaims,
  memoryEvidenceItems,
  memoryRunItems,
  memorySourceCheckpoints,
  memorySourceConfigs,
} from "@thinkwork/database-pg/schema";

export type Row = Record<string, unknown>;

interface Col {
  name: string;
}

export type FakeCond =
  | { op: "and"; conditions: FakeCond[] }
  | { op: "eq"; col: Col; val: unknown }
  | { op: "ne"; col: Col; val: unknown }
  | { op: "isNull"; col: Col }
  | { op: "inArray"; col: Col; val: unknown[] }
  | { op: "notInArray"; col: Col; val: unknown[] };

// Descriptor builders live in the import-less module
// drizzle-condition-mocks.ts (vi.mock factories must not pull this file's
// schema imports into the drizzle-orm resolution cycle); re-exported here
// for tests that already have the mock established.
export { drizzleConditionMocks } from "./drizzle-condition-mocks.js";

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function valEq(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a != null && b != null && comparable(a) === comparable(b);
  }
  return a === b;
}

export function matches(row: Row, cond: FakeCond | undefined): boolean {
  if (!cond) return true;
  switch (cond.op) {
    case "and":
      return cond.conditions.every((c) => matches(row, c));
    case "eq":
      return valEq(row[cond.col.name], cond.val);
    case "ne":
      return !valEq(row[cond.col.name], cond.val);
    case "isNull":
      return row[cond.col.name] == null;
    case "inArray":
      return cond.val.some((v) => valEq(row[cond.col.name], v));
    case "notInArray":
      return !cond.val.some((v) => valEq(row[cond.col.name], v));
    default:
      throw new Error(
        `fake-claims-db: unsupported condition ${JSON.stringify(cond)}`,
      );
  }
}

export interface FakeMemoryStore {
  claims: Row[];
  claimEdges: Row[];
  evidenceItems: Row[];
  runItems: Row[];
  checkpoints: Row[];
  /** memory_source_configs rows — the erase write-fence reads these. */
  sourceConfigs: Row[];
}

/**
 * Test helper that force-retracts an edition's ACTIVE support edges.
 * NOTE (round-4 P1-A): production no longer does this at acquire time —
 * superseded-edition edges stay active until upsertClaimsForEvidence's
 * transaction retires them. Tests use this only to fabricate historical
 * states (e.g. pre-fix rows).
 */
export function retractSupportEdges(
  store: FakeMemoryStore,
  evidenceItemId: string,
): void {
  for (const edge of store.claimEdges) {
    if (edge.evidence_item_id === evidenceItemId && edge.status === "active") {
      edge.status = "retracted";
      edge.retracted_at = new Date();
    }
  }
}

function project(rows: Row[], proj?: Record<string, Col>): Row[] {
  if (!proj) return rows.map((row) => ({ ...row }));
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(proj).map(([alias, col]) => [alias, row[col.name]]),
    ),
  );
}

interface TableSpec {
  rows: Row[];
  defaults: () => Row;
  /** Hard unique constraint (throws), for inserts WITHOUT onConflict. */
  enforce?: (row: Row, rows: Row[]) => void;
}

export function makeFakeMemoryDb(): {
  db: Database;
  store: FakeMemoryStore;
  txCount: () => number;
  /** Raw statements passed to tx.execute (the per-subject advisory lock). */
  executeCalls: () => unknown[];
} {
  let seq = 0;
  let transactions = 0;
  const executed: unknown[] = [];
  const store: FakeMemoryStore = {
    claims: [],
    claimEdges: [],
    evidenceItems: [],
    runItems: [],
    checkpoints: [],
    sourceConfigs: [],
  };

  const claimFingerprint = (row: Row): string =>
    [
      row.tenant_id,
      row.target_scope,
      row.target_id,
      row.subject_key,
      row.ontology_predicate,
      row.value_hash,
      row.effective_from instanceof Date
        ? row.effective_from.getTime()
        : "-infinity",
    ].join("|");

  const specs = new Map<unknown, TableSpec>([
    [
      memoryClaims,
      {
        rows: store.claims,
        defaults: () => {
          const n = ++seq;
          return {
            id: `gen-claim-${n}`,
            canonical_subject_id: null,
            effective_from: null,
            effective_to: null,
            status: "active",
            conflict_state: "none",
            created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
            updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
          };
        },
        enforce: (row, rows) => {
          if (rows.some((r) => claimFingerprint(r) === claimFingerprint(row))) {
            throw new Error(
              "fake-claims-db: memory_claims_fingerprint_uidx violation",
            );
          }
        },
      },
    ],
    [
      memoryClaimEvidence,
      {
        rows: store.claimEdges,
        defaults: () => ({
          id: ++seq,
          status: "active",
          created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)),
          retracted_at: null,
        }),
      },
    ],
    [
      memoryEvidenceItems,
      {
        rows: store.evidenceItems,
        defaults: () => {
          const n = ++seq;
          return {
            // "gen-" prefix: generated ids must never collide with
            // hand-seeded test rows (e.g. "ev-1") — a collision silently
            // breaks notInArray(id, changed) exclusions.
            id: `gen-ev-${n}`,
            created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
            updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
          };
        },
      },
    ],
    [memoryRunItems, { rows: store.runItems, defaults: () => ({ id: ++seq }) }],
    [
      memorySourceCheckpoints,
      { rows: store.checkpoints, defaults: () => ({ id: ++seq }) },
    ],
    [
      memorySourceConfigs,
      {
        rows: store.sourceConfigs,
        defaults: () => ({
          id: `gen-source-${++seq}`,
          enabled: true,
          erase_generation: 0,
        }),
      },
    ],
  ]);

  const spec = (table: unknown): TableSpec => {
    const found = specs.get(table);
    if (!found) throw new Error("fake-claims-db: unknown table");
    return found;
  };

  const makeSelect = (tableSpec: TableSpec, proj?: Record<string, Col>) => {
    let cond: FakeCond | undefined;
    let orderCols: Col[] = [];
    let lim: number | undefined;
    const exec = (): Row[] => {
      let rows = tableSpec.rows.filter((row) => matches(row, cond));
      if (orderCols.length > 0) {
        rows = [...rows].sort((a, b) => {
          for (const col of orderCols) {
            const av = comparable(a[col.name]) as number | string;
            const bv = comparable(b[col.name]) as number | string;
            if (av < bv) return -1;
            if (av > bv) return 1;
          }
          return 0;
        });
      }
      if (lim !== undefined) rows = rows.slice(0, lim);
      return project(rows, proj);
    };
    const chain = {
      where: (c: FakeCond) => {
        cond = c;
        return chain;
      },
      orderBy: (...cols: Col[]) => {
        orderCols = cols;
        return chain;
      },
      limit: (n: number) => {
        lim = n;
        return chain;
      },
      for: () => chain,
      then: (
        resolve: (rows: Row[]) => unknown,
        reject: (err: unknown) => unknown,
      ) => Promise.resolve().then(exec).then(resolve, reject),
    };
    return chain;
  };

  const makeInsert = (tableSpec: TableSpec) => {
    let vals: Row[] = [];
    let conflictCols: Col[] | null = null;
    const exec = (): Row[] => {
      const inserted: Row[] = [];
      for (const value of vals) {
        const row = { ...tableSpec.defaults(), ...value };
        if (conflictCols) {
          const key = (r: Row): string =>
            conflictCols!.map((c) => String(comparable(r[c.name]))).join("|");
          if (tableSpec.rows.some((r) => key(r) === key(row))) continue;
        } else {
          tableSpec.enforce?.(row, tableSpec.rows);
        }
        tableSpec.rows.push(row);
        inserted.push(row);
      }
      return inserted;
    };
    const chain = {
      values: (v: Row | Row[]) => {
        vals = Array.isArray(v) ? v : [v];
        return chain;
      },
      onConflictDoNothing: (opts?: { target?: Col[] }) => {
        conflictCols = opts?.target ?? null;
        return chain;
      },
      returning: (proj?: Record<string, Col>) =>
        Promise.resolve().then(() => project(exec(), proj)),
      then: (
        resolve: (rows: Row[]) => unknown,
        reject: (err: unknown) => unknown,
      ) => Promise.resolve().then(exec).then(resolve, reject),
    };
    return chain;
  };

  const makeUpdate = (tableSpec: TableSpec) => {
    let vals: Row = {};
    let cond: FakeCond | undefined;
    const exec = (): Row[] => {
      const updated: Row[] = [];
      for (const row of tableSpec.rows) {
        if (!matches(row, cond)) continue;
        Object.assign(row, vals);
        updated.push(row);
      }
      return updated;
    };
    const chain = {
      set: (v: Row) => {
        vals = v;
        return chain;
      },
      where: (c: FakeCond) => {
        cond = c;
        return chain;
      },
      returning: (proj?: Record<string, Col>) =>
        Promise.resolve().then(() => project(exec(), proj)),
      then: (
        resolve: (rows: Row[]) => unknown,
        reject: (err: unknown) => unknown,
      ) => Promise.resolve().then(exec).then(resolve, reject),
    };
    return chain;
  };

  const db = {
    select: (proj?: Record<string, Col>) => ({
      from: (table: unknown) => makeSelect(spec(table), proj),
    }),
    insert: (table: unknown) => makeInsert(spec(table)),
    update: (table: unknown) => makeUpdate(spec(table)),
    // Raw-SQL escape hatch: upsertClaimsForEvidence takes a per-subject
    // pg_advisory_xact_lock here. Single-threaded tests need no locking —
    // record the statement so tests can assert the lock was requested.
    execute: async (statement: unknown) => {
      executed.push(statement);
      return { rows: [] };
    },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      // No rollback semantics: the tests that need atomicity assert on the
      // number of transactions + observable end state instead.
      transactions += 1;
      return await cb(db);
    },
  };

  return {
    db: db as unknown as Database,
    store,
    txCount: () => transactions,
    executeCalls: () => executed,
  };
}
