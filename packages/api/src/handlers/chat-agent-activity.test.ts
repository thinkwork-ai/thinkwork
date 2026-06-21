/**
 * chat-agent-activity handler — auth, validation, append+publish, and
 * failure-isolation tests. The durable append (thread_turn_events) is the
 * source of truth; the AppSync notify is best-effort and must never fail the
 * request. Plan 2026-06-03-001 U3.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskReviewGenUIFixture } from "@thinkwork/genui";

const mocks = vi.hoisted(() => ({
  selectResult: [] as Array<{
    id: string;
    tenant_id: string;
    thread_id: string | null;
    agent_id: string | null;
  }>,
  appendThreadTurnEvent: vi.fn(),
  notifyThreadTurnStep: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.selectResult,
        }),
      }),
    }),
  }),
  // thread-turn-events.ts (imported via importActual below) destructures these.
  schema: {
    threadTurns: { id: {}, tenant_id: {}, run_id: {} },
    threadTurnEvents: { seq: {}, tenant_id: {}, run_id: {} },
  },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  threadTurns: {
    id: { name: "id" },
    tenant_id: { name: "tenant_id" },
    thread_id: { name: "thread_id" },
    agent_id: { name: "agent_id" },
    status: { name: "status" },
  },
  // Imported by ../lib/user-questions/intake.js (the /questions route
  // sibling this handler dispatches to); never queried by the activity
  // tests in this file.
  threads: {
    id: { name: "id" },
    tenant_id: { name: "tenant_id" },
    status: { name: "status" },
    title: { name: "title" },
  },
  messages: { id: { name: "id" } },
  pendingUserQuestions: { id: { name: "id" } },
}));

vi.mock("../lib/thread-turn-events.js", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/thread-turn-events.js")
  >("../lib/thread-turn-events.js");
  return {
    ...actual,
    appendThreadTurnEvent: mocks.appendThreadTurnEvent,
    drizzleThreadTurnEventStore: () => ({}),
  };
});

vi.mock("../graphql/notify.js", () => ({
  notifyThreadTurnStep: mocks.notifyThreadTurnStep,
  // Imported by ../lib/user-questions/intake.js; not exercised here.
  notifyNewMessage: vi.fn(),
  notifyThreadUpdate: vi.fn(),
}));

import { handler } from "./chat-agent-activity.js";
import { ThreadTurnEventError } from "../lib/thread-turn-events.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const TURN_ID = "44444444-4444-4444-4444-444444444444";
const VALID_SECRET = "test-api-secret-xyz";

let seqCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.API_AUTH_SECRET = VALID_SECRET;
  seqCounter = 0;
  mocks.selectResult = [
    {
      id: TURN_ID,
      tenant_id: TENANT_ID,
      thread_id: THREAD_ID,
      agent_id: AGENT_ID,
    },
  ];
  mocks.appendThreadTurnEvent.mockImplementation(async () => ({
    id: seqCounter,
    seq: seqCounter++,
  }));
  mocks.notifyThreadTurnStep.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.API_AUTH_SECRET;
});

interface Overrides {
  authorization?: string;
  noAuth?: boolean;
  method?: string;
  threadIdPath?: string;
  path?: string;
  body?: unknown;
}

function mockEvent(overrides: Overrides = {}): Parameters<typeof handler>[0] {
  const auth = overrides.noAuth
    ? null
    : (overrides.authorization ?? `Bearer ${VALID_SECRET}`);
  const body =
    overrides.body !== undefined
      ? typeof overrides.body === "string"
        ? overrides.body
        : JSON.stringify(overrides.body)
      : JSON.stringify({
          thread_turn_id: TURN_ID,
          tenant_id: TENANT_ID,
          thread_id: THREAD_ID,
          agent_id: AGENT_ID,
          events: [
            {
              event_type: "tool_invocation_started",
              stream: "step",
              message: "Using browser automation",
              payload: { tool: "browser" },
            },
          ],
        });
  return {
    requestContext: {
      http: {
        method: overrides.method ?? "POST",
        path: overrides.path ?? "/x",
      },
    },
    headers: auth ? { authorization: auth } : {},
    pathParameters: { threadId: overrides.threadIdPath ?? THREAD_ID },
    body,
  } as unknown as Parameters<typeof handler>[0];
}

describe("chat-agent-activity — auth", () => {
  it("401 when Authorization is missing; no append, no notify", async () => {
    const res = await handler(mockEvent({ noAuth: true }));
    expect(res.statusCode).toBe(401);
    expect(mocks.appendThreadTurnEvent).not.toHaveBeenCalled();
    expect(mocks.notifyThreadTurnStep).not.toHaveBeenCalled();
  });

  it("401 when bearer doesn't match API_AUTH_SECRET", async () => {
    const res = await handler(mockEvent({ authorization: "Bearer nope" }));
    expect(res.statusCode).toBe(401);
  });
});

describe("chat-agent-activity — validation", () => {
  it("400 on non-UUID threadId path param", async () => {
    const res = await handler(mockEvent({ threadIdPath: "not-a-uuid" }));
    expect(res.statusCode).toBe(400);
  });

  it("400 when body thread_id != path threadId", async () => {
    const res = await handler(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          tenant_id: TENANT_ID,
          thread_id: "55555555-5555-5555-5555-555555555555",
          events: [{ event_type: "x" }],
        },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("400 on empty events array", async () => {
    const res = await handler(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          tenant_id: TENANT_ID,
          thread_id: THREAD_ID,
          events: [],
        },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("404 when the turn is not found", async () => {
    mocks.selectResult = [];
    const res = await handler(mockEvent());
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body as string).code).toBe("TURN_NOT_FOUND");
  });

  it("400 when the turn belongs to a different tenant (forged callback)", async () => {
    mocks.selectResult = [
      {
        id: TURN_ID,
        tenant_id: "99999999-9999-9999-9999-999999999999",
        thread_id: THREAD_ID,
        agent_id: AGENT_ID,
      },
    ];
    const res = await handler(mockEvent());
    expect(res.statusCode).toBe(400);
  });
});

describe("chat-agent-activity — append + publish", () => {
  it("appends a step row and publishes with the SERVER-assigned seq", async () => {
    const res = await handler(mockEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toMatchObject({
      ok: true,
      appended: 1,
    });
    expect(mocks.appendThreadTurnEvent).toHaveBeenCalledTimes(1);
    const appendArg = mocks.appendThreadTurnEvent.mock.calls[0][1];
    expect(appendArg).toMatchObject({
      tenantId: TENANT_ID,
      runId: TURN_ID,
      eventType: "tool_invocation_started",
      stream: "step",
    });
    // Integration: notify receives the same seq the append returned (0).
    expect(mocks.notifyThreadTurnStep).toHaveBeenCalledTimes(1);
    expect(mocks.notifyThreadTurnStep.mock.calls[0][0]).toMatchObject({
      runId: TURN_ID,
      threadId: THREAD_ID,
      seq: 0,
      eventType: "tool_invocation_started",
    });
  });

  it("defaults stream to 'step' when omitted", async () => {
    await handler(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          tenant_id: TENANT_ID,
          thread_id: THREAD_ID,
          events: [{ event_type: "phase" }],
        },
      }),
    );
    expect(mocks.appendThreadTurnEvent.mock.calls[0][1].stream).toBe("step");
  });

  it("preserves data-genui UIMessage chunk events for live Thread rendering", async () => {
    const part = createTaskReviewGenUIFixture();

    const res = await handler(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          tenant_id: TENANT_ID,
          thread_id: THREAD_ID,
          agent_id: AGENT_ID,
          events: [
            {
              event_type: "ui_message_chunk",
              stream: "ui",
              message: "Review onboarding task",
              payload: {
                kind: "thread_genui.ui_message_chunk",
                chunk: part,
              },
            },
          ],
        },
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(mocks.appendThreadTurnEvent.mock.calls[0][1]).toMatchObject({
      eventType: "ui_message_chunk",
      stream: "ui",
      payload: {
        kind: "thread_genui.ui_message_chunk",
        chunk: part,
      },
    });
    expect(mocks.notifyThreadTurnStep.mock.calls[0][0]).toMatchObject({
      eventType: "ui_message_chunk",
      payload: {
        kind: "thread_genui.ui_message_chunk",
        chunk: part,
      },
      seq: 0,
    });
  });

  it("appends a batch in order with monotonic seq", async () => {
    const res = await handler(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          tenant_id: TENANT_ID,
          thread_id: THREAD_ID,
          events: [
            { event_type: "a" },
            { event_type: "b" },
            { event_type: "c" },
          ],
        },
      }),
    );
    expect(JSON.parse(res.body as string).appended).toBe(3);
    const seqs = mocks.notifyThreadTurnStep.mock.calls.map((c) => c[0].seq);
    expect(seqs).toEqual([0, 1, 2]);
  });
});

describe("chat-agent-activity — /questions route dispatch", () => {
  it("dispatches a .../questions path to the question intake, not the activity append", async () => {
    // The default (activity-shaped) body has no `questions` array, so the
    // intake rejects it with 400 — proving the request was routed away
    // from the activity append path.
    const res = await handler(
      mockEvent({ path: `/api/threads/${THREAD_ID}/questions` }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body as string).error).toContain("questions");
    expect(mocks.appendThreadTurnEvent).not.toHaveBeenCalled();
    expect(mocks.notifyThreadTurnStep).not.toHaveBeenCalled();
  });
});

describe("chat-agent-activity — failure isolation (G4)", () => {
  it("still returns 200 when the AppSync notify rejects (best-effort)", async () => {
    mocks.notifyThreadTurnStep.mockRejectedValueOnce(new Error("appsync down"));
    const res = await handler(mockEvent());
    // notify failure must not fail the request — the durable append succeeded.
    expect(res.statusCode).toBe(200);
  });

  it("skips an oversized-payload event without 500 (no silent finalized truncation)", async () => {
    mocks.appendThreadTurnEvent.mockRejectedValueOnce(
      new ThreadTurnEventError("payload too large", "PAYLOAD_TOO_LARGE"),
    );
    const res = await handler(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          tenant_id: TENANT_ID,
          thread_id: THREAD_ID,
          events: [{ event_type: "big" }, { event_type: "ok" }],
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.appended).toBe(1);
    expect(body.skipped).toEqual([{ index: 0, reason: "PAYLOAD_TOO_LARGE" }]);
  });
});
