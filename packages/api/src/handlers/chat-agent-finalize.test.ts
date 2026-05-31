/**
 * chat-agent-finalize handler — auth, validation, idempotency-claim tests.
 *
 * The DB-side full finalize chain (cost recording, message insert, AppSync
 * notify, etc.) is the existing behavior lifted from chat-agent-invoke
 * verbatim — those subsystems have their own tests. This file covers the
 * new wiring: bearer auth, path/body shape validation, the tenant+thread
 * pin, and the conditional-UPDATE idempotency claim on
 * thread_turns.finalized_at.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";

const mocks = vi.hoisted(() => ({
  selectResult: [] as Array<{
    id: string;
    tenant_id: string;
    thread_id: string | null;
    context_snapshot?: unknown;
  }>,
  updateClaim: [] as Array<{ id: string }>,
  processFinalize: vi.fn(),
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
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => mocks.updateClaim,
        }),
      }),
    }),
  }),
  schema: {},
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  threadTurns: {
    id: { name: "id" },
    tenant_id: { name: "tenant_id" },
    thread_id: { name: "thread_id" },
    context_snapshot: { name: "context_snapshot" },
    finalized_at: { name: "finalized_at" },
  },
}));

vi.mock("../lib/chat-finalize/process-finalize.js", () => ({
  processFinalize: mocks.processFinalize,
  toFinalizeResponse: (r: { finalized: boolean; messageId: string | null }) =>
    r.finalized
      ? { ok: true, idempotent: false, messageId: r.messageId }
      : { ok: true, idempotent: true },
}));

import { handler } from "./chat-agent-finalize.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const TURN_ID = "44444444-4444-4444-4444-444444444444";

const VALID_SECRET = "test-api-secret-xyz";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.API_AUTH_SECRET = VALID_SECRET;
  mocks.selectResult = [
    {
      id: TURN_ID,
      tenant_id: TENANT_ID,
      thread_id: THREAD_ID,
      context_snapshot: null,
    },
  ];
  mocks.updateClaim = [{ id: TURN_ID }];
  mocks.processFinalize.mockResolvedValue({
    finalized: true,
    messageId: "msg-1",
  });
});

afterEach(() => {
  delete process.env.API_AUTH_SECRET;
});

interface MockEventOverrides {
  authorization?: string;
  noAuth?: boolean;
  method?: string;
  threadIdPath?: string;
  body?: unknown;
}

function mockEvent(
  overrides: MockEventOverrides = {},
): Parameters<typeof handler>[0] {
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
          agent_id: AGENT_ID,
          thread_id: THREAD_ID,
          duration_ms: 12345,
          status: "completed",
          response: { content: "hi" },
        });
  return {
    requestContext: {
      http: {
        method: overrides.method ?? "POST",
        path: "/api/threads/x/finalize",
      },
    },
    headers: auth ? { authorization: auth } : {},
    pathParameters: { threadId: overrides.threadIdPath ?? THREAD_ID },
    body,
  } as unknown as Parameters<typeof handler>[0];
}

describe("chat-agent-finalize — auth", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await handler(mockEvent({ noAuth: true }));
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body as string);
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when bearer token doesn't match API_AUTH_SECRET", async () => {
    const res = await handler(mockEvent({ authorization: "Bearer wrong" }));
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when scheme is not Bearer", async () => {
    const res = await handler(
      mockEvent({ authorization: `Basic ${VALID_SECRET}` }),
    );
    expect(res.statusCode).toBe(401);
  });
});

describe("chat-agent-finalize — method gate", () => {
  it("returns 405 on GET", async () => {
    const res = await handler(mockEvent({ method: "GET" }));
    expect(res.statusCode).toBe(405);
  });
});

describe("chat-agent-finalize — validation", () => {
  it("rejects non-UUID threadId path parameter", async () => {
    const res = await handler(mockEvent({ threadIdPath: "not-a-uuid" }));
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid JSON body", async () => {
    const res = await handler(mockEvent({ body: "{ not json" }));
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing thread_turn_id", async () => {
    const res = await handler(
      mockEvent({
        body: {
          tenant_id: TENANT_ID,
          agent_id: AGENT_ID,
          thread_id: THREAD_ID,
          duration_ms: 1,
          status: "completed",
        },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("rejects path threadId not matching body thread_id", async () => {
    const res = await handler(
      mockEvent({
        threadIdPath: "55555555-5555-5555-5555-555555555555",
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid status value", async () => {
    const res = await handler(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          tenant_id: TENANT_ID,
          agent_id: AGENT_ID,
          thread_id: THREAD_ID,
          duration_ms: 1,
          status: "weird",
        },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("rejects malformed changed_files before processFinalize", async () => {
    const res = await handler(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          tenant_id: TENANT_ID,
          agent_id: AGENT_ID,
          thread_id: THREAD_ID,
          duration_ms: 1,
          status: "completed",
          changed_files: [
            { path: "../secrets.md", op: "modify", content: "secret" },
          ],
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body as string);
    expect(body.details).toEqual([
      expect.objectContaining({ code: "invalid_path" }),
    ]);
    expect(mocks.processFinalize).not.toHaveBeenCalled();
  });
});

describe("chat-agent-finalize — turn lookup", () => {
  it("returns 404 when thread_turn_id doesn't exist", async () => {
    mocks.selectResult = [];
    const res = await handler(mockEvent());
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body as string);
    expect(body.code).toBe("TURN_NOT_FOUND");
  });

  it("rejects when turn's tenant_id differs from body tenant_id", async () => {
    mocks.selectResult = [
      {
        id: TURN_ID,
        tenant_id: "99999999-9999-9999-9999-999999999999",
        thread_id: THREAD_ID,
        context_snapshot: null,
      },
    ];
    const res = await handler(mockEvent());
    expect(res.statusCode).toBe(400);
  });

  it("rejects when turn's thread_id differs from body thread_id", async () => {
    mocks.selectResult = [
      {
        id: TURN_ID,
        tenant_id: TENANT_ID,
        thread_id: "99999999-9999-9999-9999-999999999999",
        context_snapshot: null,
      },
    ];
    const res = await handler(mockEvent());
    expect(res.statusCode).toBe(400);
  });
});

describe("chat-agent-finalize — happy paths", () => {
  it("returns 200 with messageId when processFinalize finalizes", async () => {
    mocks.processFinalize.mockResolvedValue({
      finalized: true,
      messageId: "msg-1",
    });
    const res = await handler(mockEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ ok: true, idempotent: false, messageId: "msg-1" });
  });

  it("passes validated changed_files to processFinalize", async () => {
    const res = await handler(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          tenant_id: TENANT_ID,
          agent_id: AGENT_ID,
          thread_id: THREAD_ID,
          duration_ms: 1,
          status: "completed",
          changed_files: [
            {
              path: "memory/preferences.md",
              op: "modify",
              content: "# Prefs\n",
              base_etag: '"old"',
            },
          ],
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(mocks.processFinalize).toHaveBeenCalledWith(
      expect.objectContaining({
        changed_files: [
          {
            path: "memory/preferences.md",
            op: "modify",
            content: "# Prefs\n",
            base_etag: '"old"',
          },
        ],
      }),
    );
  });

  it("returns 200 idempotent when processFinalize signals already-finalized", async () => {
    mocks.processFinalize.mockResolvedValue({
      finalized: false,
      messageId: null,
    });
    const res = await handler(mockEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ ok: true, idempotent: true });
  });

  it("returns 500 when processFinalize throws", async () => {
    mocks.processFinalize.mockRejectedValue(new Error("boom"));
    const res = await handler(mockEvent());
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body as string);
    expect(body.code).toBe("INTERNAL");
  });

  it("accepts failed-turn payload (status: failed)", async () => {
    const res = await handler(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          tenant_id: TENANT_ID,
          agent_id: AGENT_ID,
          thread_id: THREAD_ID,
          duration_ms: 1,
          status: "failed",
          error_message: "container crashed",
        },
      }),
    );
    expect(res.statusCode).toBe(200);
  });

  it("accepts a short-lived desktop finalize token from turn context", async () => {
    const token = "dps_test-token";
    mocks.selectResult = [
      {
        id: TURN_ID,
        tenant_id: TENANT_ID,
        thread_id: THREAD_ID,
        context_snapshot: {
          desktop_runtime_session: {
            finalize_token_sha256: createHash("sha256")
              .update(token, "utf8")
              .digest("hex"),
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      },
    ];

    const res = await handler(mockEvent({ authorization: `Bearer ${token}` }));
    expect(res.statusCode).toBe(200);
  });
});
