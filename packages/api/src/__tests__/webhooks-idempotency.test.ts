/**
 * THINK-644 — webhook idempotency across both backing stores.
 *
 * The migration's contract is that a duplicate delivery is answered identically
 * whichever store is in force, so almost every case here runs twice: once with
 * `AUTH_STATE_STORE` unset (Postgres, the shipped default) and once with it
 * flipped to "dynamo". The Postgres assertions double as the regression guard
 * that the refactor left the SQL path untouched — it must still issue exactly
 * the same SELECT on `webhook_idempotency` and exactly the same INSERT, and
 * must never reach the DynamoDB client.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { getTableName } from "drizzle-orm";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { onSelect, onInsert, onUpdate, mockThreadStart } = vi.hoisted(() => ({
  onSelect: vi.fn(),
  onInsert: vi.fn(),
  onUpdate: vi.fn(),
  mockThreadStart: vi.fn(),
}));

vi.mock("../lib/db.js", () => {
  const thenable = (produce: () => unknown) => ({
    then: (resolve: (value: unknown) => unknown) => resolve(produce()),
  });
  const db = {
    select: () => {
      let table: unknown;
      const builder: Record<string, unknown> = {
        from: (t: unknown) => {
          table = t;
          return builder;
        },
        where: () => builder,
        then: (resolve: (rows: unknown) => unknown) =>
          resolve(onSelect(table) ?? []),
      };
      return builder;
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        ...thenable(() => onInsert(table, values)),
        returning: async () => onInsert(table, values) ?? [],
      }),
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => thenable(() => onUpdate(table, values)),
      }),
    }),
  };
  return { db };
});

vi.mock("../lib/spaces/space-webhook-thread-start.js", () => ({
  startSpaceWebhookThread: mockThreadStart,
}));

import {
  agentWakeupRequests,
  threadTurns,
  webhookDeliveries,
  webhookIdempotency,
  webhooks as webhooksTable,
} from "@thinkwork/database-pg/schema";

import { handler } from "../handlers/webhooks.js";

const ddb = mockClient(DynamoDBClient);

const WEBHOOK_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const AGENT_ID = "33333333-3333-3333-3333-333333333333";
const ROUTINE_ID = "44444444-4444-4444-4444-444444444444";
const WAKEUP_ID = "55555555-5555-5555-5555-555555555555";
const TURN_ID = "66666666-6666-6666-6666-666666666666";
const PRIOR_TURN_ID = "77777777-7777-7777-7777-777777777777";
const IDEMPOTENCY_KEY = "delivery-abc";

/** The webhook row the token lookup resolves to, agent-targeted by default. */
function webhookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WEBHOOK_ID,
    tenant_id: TENANT_ID,
    name: "Test hook",
    token: "tok",
    target_type: "agent",
    agent_id: AGENT_ID,
    routine_id: null,
    space_id: null,
    agent_loop_id: null,
    workflow_id: null,
    enabled: true,
    rate_limit: 6000,
    prompt: null,
    invocation_count: 0,
    created_by_type: null,
    created_by_id: null,
    ...overrides,
  };
}

function event(headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    rawPath: "/webhooks/tok",
    rawQueryString: "",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ hello: "world" }),
    requestContext: { http: { method: "POST", sourceIp: "203.0.113.1" } },
  } as unknown as APIGatewayProxyEventV2;
}

/** Rows the mocked `db.select()` hands back, keyed by table. */
let selectRows: Record<string, unknown[]>;

beforeEach(() => {
  vi.clearAllMocks();
  ddb.reset();
  process.env.AUTH_STATE_TABLE = "thinkwork-test-auth-state";
  selectRows = { webhooks: [webhookRow()], webhook_idempotency: [] };

  onSelect.mockImplementation(
    (table: unknown) => selectRows[getTableName(table as never)] ?? [],
  );
  onInsert.mockImplementation((table: unknown) => {
    const name = getTableName(table as never);
    if (name === "agent_wakeup_requests") return [{ id: WAKEUP_ID }];
    if (name === "thread_turns") return [{ id: TURN_ID }];
    return [];
  });
  onUpdate.mockReturnValue([]);
  mockThreadStart.mockResolvedValue({
    threadId: "thread-1",
    identifier: "T-1",
    number: 1,
    openingMessageContent: "hi",
    workflow: null,
    agentContext: {},
    warnings: [],
  });
});

afterEach(() => {
  delete process.env.AUTH_STATE_TABLE;
  delete process.env.AUTH_STATE_STORE;
});

/** Every insert this invocation made against `table`. */
function insertsInto(table: unknown): unknown[] {
  const name = getTableName(table as never);
  return onInsert.mock.calls
    .filter(([t]) => getTableName(t as never) === name)
    .map(([, values]) => values);
}

// ---------------------------------------------------------------------------
// Postgres path — must be untouched by the migration
// ---------------------------------------------------------------------------

describe("idempotency on Postgres (flag off)", () => {
  it("answers a duplicate delivery from webhook_idempotency", async () => {
    selectRows.webhook_idempotency = [{ turn_id: PRIOR_TURN_ID }];

    const response = await handler(
      event({ "x-idempotency-key": IDEMPOTENCY_KEY }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body as string)).toEqual({
      ok: true,
      turnId: PRIOR_TURN_ID,
      deduplicated: true,
    });
    // Deduplicated means not dispatched.
    expect(mockThreadStart).not.toHaveBeenCalled();
    expect(insertsInto(webhookDeliveries)[0]).toMatchObject({
      is_replay: true,
      resolution_status: "ok",
    });
  });

  it("records a turn-less prior row as a duplicate, not a fresh delivery", async () => {
    // turn_id is nullable; an existing row with a null turn is still a hit.
    selectRows.webhook_idempotency = [{ turn_id: null }];

    const response = await handler(
      event({ "x-idempotency-key": IDEMPOTENCY_KEY }),
    );

    expect(JSON.parse(response.body as string)).toEqual({
      ok: true,
      turnId: null,
      deduplicated: true,
    });
    expect(mockThreadStart).not.toHaveBeenCalled();
  });

  it("writes the receipt row after an agent dispatch", async () => {
    const response = await handler(
      event({ "x-idempotency-key": IDEMPOTENCY_KEY }),
    );

    expect(response.statusCode).toBe(201);
    expect(insertsInto(webhookIdempotency)).toEqual([
      {
        webhook_id: WEBHOOK_ID,
        idempotency_key: IDEMPOTENCY_KEY,
        turn_id: WAKEUP_ID,
      },
    ]);
    expect(ddb.calls()).toHaveLength(0);
  });

  it("writes the receipt row after a routine dispatch", async () => {
    selectRows.webhooks = [
      webhookRow({
        target_type: "routine",
        agent_id: null,
        routine_id: ROUTINE_ID,
      }),
    ];

    const response = await handler(
      event({ "x-idempotency-key": IDEMPOTENCY_KEY }),
    );

    expect(response.statusCode).toBe(201);
    expect(insertsInto(threadTurns)).toHaveLength(1);
    expect(insertsInto(webhookIdempotency)).toEqual([
      {
        webhook_id: WEBHOOK_ID,
        idempotency_key: IDEMPOTENCY_KEY,
        turn_id: TURN_ID,
      },
    ]);
    expect(ddb.calls()).toHaveLength(0);
  });

  it("skips the whole receipt path when no idempotency header is sent", async () => {
    const response = await handler(event());

    expect(response.statusCode).toBe(201);
    expect(insertsInto(webhookIdempotency)).toHaveLength(0);
    expect(insertsInto(agentWakeupRequests)).toHaveLength(1);
    expect(ddb.calls()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DynamoDB path
// ---------------------------------------------------------------------------

describe("idempotency on DynamoDB (flag on)", () => {
  beforeEach(() => {
    process.env.AUTH_STATE_STORE = "dynamo";
    // A live Postgres row must never be consulted on this path — if the
    // handler read it anyway, these tests would still pass for the wrong
    // reason, so the table is loaded with a decoy.
    selectRows.webhook_idempotency = [{ turn_id: "decoy-turn" }];
  });

  it("answers a duplicate delivery from the receipt, identically to Postgres", async () => {
    ddb.on(GetItemCommand).resolves({
      Item: {
        pk: { S: "receipt#webhook#..." },
        expires_at: { N: String(Math.floor(Date.now() / 1000) + 600) },
        value: { M: { turnId: { S: PRIOR_TURN_ID } } },
      },
    });

    const response = await handler(
      event({ "x-idempotency-key": IDEMPOTENCY_KEY }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body as string)).toEqual({
      ok: true,
      turnId: PRIOR_TURN_ID,
      deduplicated: true,
    });
    expect(mockThreadStart).not.toHaveBeenCalled();
    expect(insertsInto(webhookDeliveries)[0]).toMatchObject({
      is_replay: true,
      resolution_status: "ok",
    });
  });

  it("keys the receipt on webhook id + idempotency key", async () => {
    ddb.on(GetItemCommand).resolves({});
    ddb.on(PutItemCommand).resolves({});

    await handler(event({ "x-idempotency-key": IDEMPOTENCY_KEY }));

    const { createHash } = await import("node:crypto");
    const pk = `receipt#webhook#${createHash("sha256")
      .update(`${WEBHOOK_ID}:${IDEMPOTENCY_KEY}`)
      .digest("hex")}`;
    expect(ddb.commandCalls(GetItemCommand)[0].args[0].input.Key).toEqual({
      pk: { S: pk },
      sk: { S: "r" },
    });
    expect(ddb.commandCalls(PutItemCommand)[0].args[0].input.Item?.pk).toEqual({
      S: pk,
    });
  });

  it("dispatches on a miss and writes a 7-day receipt carrying the turn id", async () => {
    ddb.on(GetItemCommand).resolves({});
    ddb.on(PutItemCommand).resolves({});
    const before = Math.floor(Date.now() / 1000);

    const response = await handler(
      event({ "x-idempotency-key": IDEMPOTENCY_KEY }),
    );

    expect(response.statusCode).toBe(201);
    expect(mockThreadStart).toHaveBeenCalledTimes(1);
    // The Postgres receipt table is not written on this path.
    expect(insertsInto(webhookIdempotency)).toHaveLength(0);

    const item = ddb.commandCalls(PutItemCommand)[0].args[0].input.Item!;
    expect(item.value).toEqual({ M: { turnId: { S: WAKEUP_ID } } });
    expect(item.receipt_key).toEqual({
      S: `${WEBHOOK_ID}:${IDEMPOTENCY_KEY}`,
    });
    const ttl = Number(item.expires_at?.N);
    expect(ttl).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60);
    expect(ttl).toBeLessThanOrEqual(before + 7 * 24 * 60 * 60 + 5);
  });

  it("writes the routine turn id into the receipt", async () => {
    selectRows.webhooks = [
      webhookRow({
        target_type: "routine",
        agent_id: null,
        routine_id: ROUTINE_ID,
      }),
    ];
    ddb.on(GetItemCommand).resolves({});
    ddb.on(PutItemCommand).resolves({});

    const response = await handler(
      event({ "x-idempotency-key": IDEMPOTENCY_KEY }),
    );

    expect(response.statusCode).toBe(201);
    expect(
      ddb.commandCalls(PutItemCommand)[0].args[0].input.Item?.value,
    ).toEqual({ M: { turnId: { S: TURN_ID } } });
  });

  it("treats a lost claim race as a successful dispatch, not a 500", async () => {
    // Postgres would raise a unique violation here and 500 the delivery; the
    // conditional write simply reports the duplicate and the dispatch — which
    // has already happened — is still reported as it was.
    ddb.on(GetItemCommand).resolves({});
    ddb.on(PutItemCommand).rejects(
      new ConditionalCheckFailedException({
        message: "The conditional request failed",
        $metadata: {},
      }),
    );

    const response = await handler(
      event({ "x-idempotency-key": IDEMPOTENCY_KEY }),
    );

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body as string).wakeupRequestId).toBe(WAKEUP_ID);
  });

  it("skips DynamoDB entirely when no idempotency header is sent", async () => {
    const response = await handler(event());

    expect(response.statusCode).toBe(201);
    expect(ddb.calls()).toHaveLength(0);
  });
});
