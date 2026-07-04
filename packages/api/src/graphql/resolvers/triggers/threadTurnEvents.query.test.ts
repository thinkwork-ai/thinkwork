import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const USER_ID = "55555555-5555-5555-5555-555555555555";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as Array<Array<Record<string, unknown>>>,
  requireTenantMember: vi.fn(),
  resolveCallerFromAuth: vi.fn(),
  visiblePredicate: vi.fn(() => ({ visible: true })),
}));

function makeResult(rows: Array<Record<string, unknown>>) {
  const p: any = Promise.resolve(rows);
  p.orderBy = () => ({ limit: () => Promise.resolve(rows) });
  return p;
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => makeResult(mocks.selectQueue.shift() ?? []),
      }),
    }),
  },
  eq: vi.fn((column, value) => ({ column, value })),
  gt: vi.fn((column, value) => ({ column, value })),
  and: vi.fn((...conditions) => ({ conditions })),
  threadTurns: {
    id: "thread_turns.id",
    tenant_id: "thread_turns.tenant_id",
    thread_id: "thread_turns.thread_id",
  },
  threadTurnEvents: {
    run_id: "thread_turn_events.run_id",
    seq: "thread_turn_events.seq",
  },
  threads: { id: "threads.id", tenant_id: "threads.tenant_id" },
  snakeToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    runId: row.run_id,
    eventType: row.event_type,
    payload: row.payload,
  }),
}));

vi.mock("../core/authz.js", () => ({
  hasServiceSecret: (ctx: any) =>
    ctx?.auth?.authType === "apikey" || ctx?.auth?.authType === "service",
  requireTenantMember: mocks.requireTenantMember,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mocks.resolveCallerFromAuth,
}));

vi.mock("../threads/access.js", () => ({
  callerVisibleThreadPredicate: mocks.visiblePredicate,
}));

import { threadTurnEvents_ } from "./threadTurnEvents.query";

const serviceCtx = { auth: { authType: "service" } } as never;
const cognitoCtx = { auth: { authType: "cognito" } } as never;

const EVENT = {
  id: 1,
  run_id: "turn-1",
  event_type: "model_routed_tool_call",
  payload: { tool_call_id: "tool-1", status: "completed" },
};
const EXPECTED_EVENT = {
  id: 1,
  runId: "turn-1",
  eventType: "model_routed_tool_call",
  payload: { tool_call_id: "tool-1", status: "completed" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectQueue = [];
  mocks.requireTenantMember.mockResolvedValue("member");
  mocks.resolveCallerFromAuth.mockResolvedValue({
    userId: USER_ID,
    tenantId: TENANT_ID,
  });
});

describe("threadTurnEvents access gate", () => {
  it("service-secret callers bypass and get payloads unchanged", async () => {
    mocks.selectQueue.push([{ tenant_id: TENANT_ID, thread_id: THREAD_ID }]);
    mocks.selectQueue.push([EVENT]);

    await expect(
      threadTurnEvents_(
        null,
        { runId: "turn-1", afterSeq: 0, limit: 50 },
        serviceCtx,
      ),
    ).resolves.toEqual([EXPECTED_EVENT]);
    expect(mocks.requireTenantMember).not.toHaveBeenCalled();
  });

  it("returns empty for an unknown run without leaking existence", async () => {
    mocks.selectQueue.push([]); // turn lookup empty

    await expect(
      threadTurnEvents_(null, { runId: "missing" }, cognitoCtx),
    ).resolves.toEqual([]);
  });

  it("serves a tenant member who can see the originating thread", async () => {
    mocks.selectQueue.push([{ tenant_id: TENANT_ID, thread_id: THREAD_ID }]);
    mocks.selectQueue.push([{ id: THREAD_ID }]); // thread visible
    mocks.selectQueue.push([EVENT]);

    await expect(
      threadTurnEvents_(null, { runId: "turn-1" }, cognitoCtx),
    ).resolves.toEqual([EXPECTED_EVENT]);
  });

  it("rejects a member who cannot see the originating thread", async () => {
    mocks.selectQueue.push([{ tenant_id: TENANT_ID, thread_id: THREAD_ID }]);
    mocks.selectQueue.push([]); // thread NOT visible

    await expect(
      threadTurnEvents_(null, { runId: "turn-1" }, cognitoCtx),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("lets a tenant admin/owner bypass thread visibility (operator activity trace)", async () => {
    mocks.requireTenantMember.mockResolvedValue("admin");
    mocks.selectQueue.push([{ tenant_id: TENANT_ID, thread_id: THREAD_ID }]);
    mocks.selectQueue.push([EVENT]); // no thread lookup for admins

    await expect(
      threadTurnEvents_(null, { runId: "turn-1" }, cognitoCtx),
    ).resolves.toEqual([EXPECTED_EVENT]);
    expect(mocks.visiblePredicate).not.toHaveBeenCalled();
  });

  it("serves a thread-less background run to any tenant member", async () => {
    mocks.selectQueue.push([{ tenant_id: TENANT_ID, thread_id: null }]);
    mocks.selectQueue.push([EVENT]); // no thread lookup

    await expect(
      threadTurnEvents_(null, { runId: "turn-1" }, cognitoCtx),
    ).resolves.toEqual([EXPECTED_EVENT]);
    expect(mocks.visiblePredicate).not.toHaveBeenCalled();
  });

  it("propagates a non-member tenant rejection from requireTenantMember", async () => {
    mocks.requireTenantMember.mockRejectedValue(
      Object.assign(new Error("Tenant membership required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );
    mocks.selectQueue.push([{ tenant_id: TENANT_ID, thread_id: THREAD_ID }]);

    await expect(
      threadTurnEvents_(null, { runId: "turn-1" }, cognitoCtx),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
});
