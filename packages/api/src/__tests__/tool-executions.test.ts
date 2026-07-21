/**
 * tool-executions handler tests (THINK-324 Wave-3 C17).
 *
 * Covers the runtime→API ledger write surface: auth shape, UUID validation,
 * event-shape validation (started vs terminal fields), idempotent replays,
 * terminal-without-start skip, tenant isolation, 405/404 route hygiene.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTenantRow, mockInsertResult, insertedValues } = vi.hoisted(() => ({
  mockTenantRow: vi.fn(),
  mockInsertResult: vi.fn(),
  insertedValues: [] as Record<string, unknown>[],
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            const row = mockTenantRow();
            return Promise.resolve(row ? [row] : []);
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            insertedValues.push(values);
            const result = mockInsertResult(values);
            if (result instanceof Error) return Promise.reject(result);
            return Promise.resolve(result);
          },
        }),
      }),
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  toolExecutionEvents: { id: "tee.id" },
  tenants: { id: "tenants.id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (..._args: unknown[]) => ({ _eq: _args }),
}));

const { mockVerdict } = vi.hoisted(() => ({ mockVerdict: vi.fn() }));
vi.mock("../lib/turn-assertion.js", () => ({
  TURN_ASSERTION_HEADER: "x-thinkwork-turn-assertion",
  verifyTurnAssertion: (token: string) => Promise.resolve(mockVerdict(token)),
}));

// eslint-disable-next-line import/first
import { handler } from "../handlers/tool-executions.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const THREAD_A = "55555555-5555-5555-5555-555555555555";
const TURN_A = "66666666-6666-6666-6666-666666666666";

function startedEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_type: "started",
    tool_use_id: "toolu_1",
    operation: "web_search",
    idempotency_key: `pi:${TURN_A}:toolu_1`,
    input_preview: { preview: '{"query":"x"}' },
    ...overrides,
  };
}

function terminalEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_type: "completed",
    tool_use_id: "toolu_1",
    operation: "web_search",
    idempotency_key: `pi:${TURN_A}:toolu_1`,
    output_preview: { preview: "ok" },
    duration_ms: 1234,
    ...overrides,
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: TENANT_A,
    thread_id: THREAD_A,
    turn_id: TURN_A,
    principal_type: "user",
    principal_id: "user-1",
    events: [startedEvent()],
    ...overrides,
  };
}

function ev(
  payload: unknown,
  overrides: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
  } = {},
): APIGatewayProxyEventV2 {
  return {
    rawPath: overrides.path ?? "/api/runtime/tool-executions",
    requestContext: {
      http: { method: overrides.method ?? "POST" },
    },
    headers: overrides.headers ?? { authorization: "Bearer secret" },
    body:
      typeof payload === "string"
        ? payload
        : payload === undefined
          ? null
          : JSON.stringify(payload),
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  vi.clearAllMocks();
  insertedValues.length = 0;
  process.env.API_AUTH_SECRET = "secret";
  mockTenantRow.mockReturnValue({ id: TENANT_A });
  mockInsertResult.mockReturnValue([{ id: 1 }]);
});

describe("POST /api/runtime/tool-executions", () => {
  it("happy path: appends a started event", async () => {
    const res = await handler(ev(body()));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? "")).toEqual({
      ok: true,
      appended: 1,
      skipped: 0,
    });
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      tenant_id: TENANT_A,
      thread_id: THREAD_A,
      turn_id: TURN_A,
      event_type: "started",
      operation: "web_search",
      input_preview: { preview: '{"query":"x"}' },
      output_preview: null,
      duration_ms: null,
    });
  });

  it("terminal event carries output/duration/cost and no input_preview", async () => {
    const res = await handler(
      ev(body({ events: [terminalEvent({ provider_cost_usd: 0.0123 })] })),
    );
    expect(res.statusCode).toBe(200);
    expect(insertedValues[0]).toMatchObject({
      event_type: "completed",
      input_preview: null,
      output_preview: { preview: "ok" },
      duration_ms: 1234,
      provider_cost_usd: "0.0123",
    });
  });

  it("idempotent replay counts as skipped, not error", async () => {
    mockInsertResult.mockReturnValue([]);
    const res = await handler(ev(body()));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? "")).toEqual({
      ok: true,
      appended: 0,
      skipped: 1,
    });
  });

  it("terminal without matching start is skipped (dropped-start tolerance)", async () => {
    mockInsertResult.mockReturnValue(
      new Error(
        'insert failed: tool_execution_terminal_without_matching_start',
      ),
    );
    const res = await handler(ev(body({ events: [terminalEvent()] })));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? "")).toEqual({
      ok: true,
      appended: 0,
      skipped: 1,
    });
  });

  it("started event with terminal fields is rejected", async () => {
    const res = await handler(
      ev(body({ events: [startedEvent({ duration_ms: 5 })] })),
    );
    expect(res.statusCode).toBe(400);
  });

  it("terminal event with input_preview is rejected", async () => {
    const res = await handler(
      ev(body({ events: [terminalEvent({ input_preview: { a: 1 } })] })),
    );
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid event_type / principal_type / UUIDs", async () => {
    expect(
      (
        await handler(
          ev(body({ events: [startedEvent({ event_type: "nope" })] })),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await handler(ev(body({ principal_type: "robot" })))).statusCode,
    ).toBe(400);
    expect((await handler(ev(body({ turn_id: "not-a-uuid" })))).statusCode).toBe(
      400,
    );
  });

  it("401 without the bearer secret", async () => {
    const res = await handler(ev(body(), { headers: {} }));
    expect(res.statusCode).toBe(401);
  });

  it("404 for a foreign tenant", async () => {
    mockTenantRow.mockReturnValue(null);
    const res = await handler(ev(body()));
    expect(res.statusCode).toBe(404);
  });

  it("accepts a valid matching turn assertion", async () => {
    mockVerdict.mockReturnValue({
      status: "valid",
      binding: { tenant_id: TENANT_A, thread_id: THREAD_A, turn_id: TURN_A },
    });
    const res = await handler(
      ev(body(), {
        headers: {
          authorization: "Bearer secret",
          "x-thinkwork-turn-assertion": "twta1.x.y",
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(mockVerdict).toHaveBeenCalledWith("twta1.x.y");
  });

  it("rejects an invalid assertion and a binding mismatch", async () => {
    mockVerdict.mockReturnValue({ status: "invalid", reason: "bad signature" });
    const invalid = await handler(
      ev(body(), {
        headers: {
          authorization: "Bearer secret",
          "x-thinkwork-turn-assertion": "twta1.x.y",
        },
      }),
    );
    expect(invalid.statusCode).toBe(401);

    mockVerdict.mockReturnValue({
      status: "valid",
      binding: {
        tenant_id: TENANT_A,
        thread_id: THREAD_A,
        turn_id: "99999999-9999-9999-9999-999999999999",
      },
    });
    const mismatch = await handler(
      ev(body(), {
        headers: {
          authorization: "Bearer secret",
          "x-thinkwork-turn-assertion": "twta1.x.y",
        },
      }),
    );
    expect(mismatch.statusCode).toBe(401);
  });

  it("tolerates verifier unavailability and assertion absence", async () => {
    mockVerdict.mockReturnValue({ status: "unavailable", reason: "no key" });
    const unavailable = await handler(
      ev(body(), {
        headers: {
          authorization: "Bearer secret",
          "x-thinkwork-turn-assertion": "twta1.x.y",
        },
      }),
    );
    expect(unavailable.statusCode).toBe(200);

    mockVerdict.mockClear();
    const absent = await handler(ev(body()));
    expect(absent.statusCode).toBe(200);
    expect(mockVerdict).not.toHaveBeenCalled();
  });

  it("405 / 404 route hygiene", async () => {
    expect((await handler(ev(body(), { method: "GET" }))).statusCode).toBe(405);
    expect(
      (await handler(ev(body(), { path: "/api/runtime/other" }))).statusCode,
    ).toBe(404);
  });
});
