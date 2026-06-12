/**
 * eval-runs-reconciler pinned-scope tests (Evaluations Trust Core U6).
 *
 * The pre-U6 reconciler reconstructed a run's expected case set from the
 * live eval_test_cases table with enabled=true and skipped on a count
 * mismatch — so a case tombstoned (enabled=false) mid-run wedged the run
 * at "running" forever. Pinned runs reconstruct from the launch-time
 * pinned_case_ids list instead: tombstoned cases still resolve (no
 * enabled filter), and even a hard-deleted index row synthesizes a
 * terminating error row.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_EVAL_SCORING_VERSION } from "@thinkwork/evals-core";
import {
  evalResults,
  evalRuns,
  evalTestCases,
} from "@thinkwork/database-pg/schema";

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  const lazyDb = new Proxy(
    {},
    {
      get(_target, prop) {
        return (fakeDb as Record<PropertyKey, unknown>)[prop];
      },
    },
  );
  return { ...actual, getDb: () => lazyDb };
});

vi.mock("../lib/eval-notify.js", () => ({
  notifyEvalRunUpdate: vi.fn(async () => {}),
}));

import { handler } from "./eval-runs-reconciler.js";
import { notifyEvalRunUpdate } from "../lib/eval-notify.js";

// ---------------------------------------------------------------------------
// Fake db — dispatches on schema table identity. eval_results rows carry
// every property the reconciler's differently-shaped selects read
// (testCaseId / status / evaluator_results).
// ---------------------------------------------------------------------------

interface FakeDbState {
  /** Raw candidate record returned by the candidates SQL (snake_case). */
  candidates: Array<Record<string, unknown>>;
  run: Record<string, unknown>;
  /** Rows the evalRuns selects return, in call order after the candidates
   *  query: [transaction freshRun, resummarize-divergent select]. */
  runSelectQueue: Array<Array<Record<string, unknown>>>;
  caseRows: Array<Record<string, unknown>>;
  resultRows: Array<Record<string, any>>;
  insertedResults: Array<Record<string, any>>;
  runUpdates: Array<Record<string, any>>;
}

let state: FakeDbState;
let fakeDb: any;

function createFakeDb(dbState: FakeDbState) {
  const select = () => ({
    from: (table: unknown) => {
      const chain: any = {
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        then: (
          resolve: (rows: unknown[]) => unknown,
          reject: (err: unknown) => unknown,
        ) => {
          let rows: unknown[] = [];
          if (table === evalRuns) {
            rows = dbState.runSelectQueue.shift() ?? [];
          } else if (table === evalTestCases) {
            rows = dbState.caseRows;
          } else if (table === evalResults) {
            rows = dbState.resultRows;
          }
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return chain;
    },
  });
  const insert = (table: unknown) => ({
    values: (rows: Record<string, any> | Array<Record<string, any>>) => {
      const list = Array.isArray(rows) ? rows : [rows];
      if (table === evalResults) {
        for (const row of list) {
          dbState.insertedResults.push(row);
          dbState.resultRows.push({ ...row, testCaseId: row.test_case_id });
        }
        return Object.assign(Promise.resolve(), {
          onConflictDoNothing: async () => {},
        });
      }
      return Object.assign(Promise.resolve(), {
        onConflictDoNothing: async () => {},
      });
    },
  });
  const update = () => ({
    set: (set: Record<string, any>) => {
      dbState.runUpdates.push(set);
      return {
        where: () => ({
          returning: async () => [{ id: dbState.run.id }],
        }),
      };
    },
  });
  return {
    select,
    insert,
    update,
    execute: async () => ({ rows: dbState.candidates }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ execute: async () => ({}), select, insert, update }),
  };
}

const OLD = new Date(Date.now() - 60 * 60_000); // 1h ago — stale

function pinnedCandidate(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "run-1",
    tenant_id: "tenant-1",
    agent_id: "agent-1",
    status: "running",
    categories: [],
    selected_test_case_ids: ["uuid-a", "uuid-b"],
    dataset_id: "ds-1",
    pinned_case_ids: ["case-a", "case-b"],
    total_tests: 2,
    scoring_version: CURRENT_EVAL_SCORING_VERSION,
    started_at: OLD,
    last_result_at: OLD,
    result_count: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    candidates: [pinnedCandidate()],
    run: { id: "run-1" },
    runSelectQueue: [
      [{ status: "running", total_tests: 2 }], // tx freshRun
      [], // resummarizeDivergentRuns
    ],
    caseRows: [
      {
        id: "uuid-a",
        query: "query a",
        assertions: [],
        dataset_case_id: "case-a",
      },
      // case-b was tombstoned mid-run: enabled=false — but the pinned
      // join has NO enabled filter, so the row still resolves.
      {
        id: "uuid-b",
        query: "query b",
        assertions: [],
        dataset_case_id: "case-b",
      },
    ],
    resultRows: [
      { testCaseId: "uuid-a", status: "pass", evaluator_results: [] },
    ],
    insertedResults: [],
    runUpdates: [],
  };
  fakeDb = createFakeDb(state);
});

describe("eval-runs-reconciler pinned scope (U6)", () => {
  it("finalizes a pinned run whose case was tombstoned mid-run (worker died)", async () => {
    const result = await handler({} as never);

    expect(result.reconciled).toBe(1);
    // The missing pinned case got a synthetic error/reconciler row.
    expect(state.insertedResults).toHaveLength(1);
    const synthetic = state.insertedResults[0];
    expect(synthetic.test_case_id).toBe("uuid-b");
    expect(synthetic.status).toBe("error");
    expect(synthetic.error_cause).toBe("reconciler");
    expect(synthetic.input).toBe("query b");

    // The run finalized with the pinned denominator: 1 pass, 1 error.
    const finalize = state.runUpdates.at(-1)!;
    expect(finalize.status).toBe("completed");
    expect(finalize.passed).toBe(1);
    expect(finalize.failed).toBe(0);
    expect(finalize.errored).toBe(1);
    expect(finalize.pass_rate).toBe("1.0000");
    expect(vi.mocked(notifyEvalRunUpdate)).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", status: "completed" }),
    );
  });

  it("still finalizes when a pinned case's index row was hard-deleted (null FK synthetic)", async () => {
    state.caseRows = [
      {
        id: "uuid-a",
        query: "query a",
        assertions: [],
        dataset_case_id: "case-a",
      },
      // case-b has NO index row at all.
    ];

    const result = await handler({} as never);

    expect(result.reconciled).toBe(1);
    expect(state.insertedResults).toHaveLength(1);
    const synthetic = state.insertedResults[0];
    expect(synthetic.test_case_id).toBeNull();
    expect(synthetic.status).toBe("error");
    expect(synthetic.error_cause).toBe("reconciler");
    expect(synthetic.agent_session_id).toBe("reconciler:run-1:case-b");
    expect(state.runUpdates.at(-1)!.status).toBe("completed");
  });

  it("keeps the legacy count-mismatch skip for unpinned runs (regression)", async () => {
    state.candidates = [
      pinnedCandidate({
        dataset_id: null,
        pinned_case_ids: null,
        selected_test_case_ids: ["uuid-a", "uuid-b"],
      }),
    ];
    // The live enabled=true reconstruction comes up short (e.g. a case
    // was disabled mid-run) — legacy behavior: skip, do not guess.
    state.caseRows = [{ id: "uuid-a", query: "query a", assertions: [] }];
    // No transaction runs on a skip; the only evalRuns select left is
    // resummarizeDivergentRuns', which must find nothing.
    state.runSelectQueue = [[]];

    const result = await handler({} as never);

    expect(result.reconciled).toBe(0);
    expect(state.insertedResults).toHaveLength(0);
    expect(state.runUpdates).toHaveLength(0);
  });
});
