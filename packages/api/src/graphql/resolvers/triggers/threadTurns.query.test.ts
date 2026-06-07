import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Array<Record<string, unknown>>>,
}));

function queryChain() {
  const resolveRows = () => Promise.resolve(mocks.rows.shift() ?? []);
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    groupBy: () => chain,
    limit: () => resolveRows(),
    then: (
      resolve: (value: Array<Record<string, unknown>>) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => resolveRows().then(resolve, reject),
  };
  return chain;
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => queryChain(),
  },
  eq: vi.fn((column, value) => ({ type: "eq", column, value })),
  and: vi.fn((...conditions) => ({ type: "and", conditions })),
  desc: vi.fn((column) => ({ type: "desc", column })),
  inArray: vi.fn((column, values) => ({ type: "inArray", column, values })),
  sql: vi.fn(() => "sql"),
  scheduledJobs: {
    id: "scheduled_jobs.id",
    name: "scheduled_jobs.name",
  },
  threadTurns: {
    id: "thread_turns.id",
    tenant_id: "thread_turns.tenant_id",
    trigger_id: "thread_turns.trigger_id",
    agent_id: "thread_turns.agent_id",
    thread_id: "thread_turns.thread_id",
    runtime_type: "thread_turns.runtime_type",
    routine_id: "thread_turns.routine_id",
    invocation_source: "thread_turns.invocation_source",
    trigger_detail: "thread_turns.trigger_detail",
    wakeup_request_id: "thread_turns.wakeup_request_id",
    status: "thread_turns.status",
    started_at: "thread_turns.started_at",
    finished_at: "thread_turns.finished_at",
    error: "thread_turns.error",
    error_code: "thread_turns.error_code",
    system_prompt: "thread_turns.system_prompt",
    usage_json: "thread_turns.usage_json",
    result_json: "thread_turns.result_json",
    context_snapshot: "thread_turns.context_snapshot",
    session_id_before: "thread_turns.session_id_before",
    session_id_after: "thread_turns.session_id_after",
    external_run_id: "thread_turns.external_run_id",
    log_store: "thread_turns.log_store",
    log_ref: "thread_turns.log_ref",
    log_bytes: "thread_turns.log_bytes",
    log_sha256: "thread_turns.log_sha256",
    log_compressed: "thread_turns.log_compressed",
    stdout_excerpt: "thread_turns.stdout_excerpt",
    stderr_excerpt: "thread_turns.stderr_excerpt",
    created_at: "thread_turns.created_at",
  },
  costEvents: {
    request_id: "cost_events.request_id",
    tenant_id: "cost_events.tenant_id",
    metadata: "cost_events.metadata",
  },
  snakeToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    wakeupRequestId: row.wakeup_request_id,
    runtimeType: row.runtime_type,
    status: row.status,
  }),
}));

vi.mock("./threadTurnRuntime.js", () => ({
  withRuntimeType: (row: Record<string, unknown>) => row,
}));

import { threadTurns_ } from "./threadTurns.query";

beforeEach(() => {
  mocks.rows = [];
});

describe("threadTurns", () => {
  it("adds direct parent cost and routed child model cost without double-counting identical request ids", async () => {
    mocks.rows = [
      [
        {
          id: "turn-1",
          wakeup_request_id: "turn-1",
          runtime_type: "pi",
          status: "succeeded",
        },
      ],
      [{ request_id: "turn-1", total: "0.008799" }],
      [{ parent_request_id: "turn-1", total: "0.1125184" }],
    ];

    await expect(
      threadTurns_(null, { tenantId: "tenant-1", threadId: "thread-1" }, {} as never),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "turn-1",
        wakeupRequestId: "turn-1",
        totalCost: 0.1213174,
      }),
    ]);
  });

  it("returns null totalCost when no parent or child cost rows exist", async () => {
    mocks.rows = [
      [
        {
          id: "turn-1",
          wakeup_request_id: null,
          runtime_type: "pi",
          status: "succeeded",
        },
      ],
      [],
      [],
    ];

    await expect(
      threadTurns_(null, { tenantId: "tenant-1", threadId: "thread-1" }, {} as never),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "turn-1",
        totalCost: null,
      }),
    ]);
  });
});
