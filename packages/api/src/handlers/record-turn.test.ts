import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const {
  mockAuthenticate,
  mockSelectLimit,
  mockReturning,
  mockUpdateSet,
  mockUpdateWhere,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockReturning: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
}));

vi.mock("../lib/cognito-auth.js", () => ({ authenticate: mockAuthenticate }));

vi.mock("../lib/db.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockSelectLimit() as unknown[]),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockReturning() as unknown[]),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values);
        return {
          where: (condition: unknown) => {
            mockUpdateWhere(condition);
            return Promise.resolve([]);
          },
        };
      },
    }),
  },
}));

vi.mock("@thinkwork/database-pg", () => ({
  schema: {
    users: { email: "users.email" },
    threads: {
      id: "threads.id",
      tenant_id: "threads.tenant_id",
      last_turn_completed_at: "threads.last_turn_completed_at",
      last_response_preview: "threads.last_response_preview",
      updated_at: "threads.updated_at",
    },
    messages: { id: "messages.id" },
  },
}));

import { handler } from "./record-turn";

function event(body: unknown, method = "POST"): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method } },
    headers: { authorization: "Bearer tok" },
    body: JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2;
}

const VALID = {
  threadId: "thr_1",
  userText: "hello",
  assistantText: "hi there",
  usage: { inputTokens: 5, outputTokens: 3 },
};

beforeEach(() => {
  mockAuthenticate.mockReset();
  mockSelectLimit.mockReset();
  mockReturning.mockReset();
  mockUpdateSet.mockReset();
  mockUpdateWhere.mockReset();
  mockAuthenticate.mockResolvedValue({
    principalId: "p1",
    tenantId: null,
    email: "eric@example.com",
    authType: "cognito",
    agentId: null,
  });
  // 1st select → user row; 2nd select → thread row
  mockSelectLimit
    .mockReturnValueOnce([{ id: "u1", tenant_id: "t1" }])
    .mockReturnValueOnce([{ id: "thr_1" }]);
  // 1st insert → user message id; 2nd insert → assistant message id
  mockReturning
    .mockReturnValueOnce([{ id: "um_1" }])
    .mockReturnValueOnce([{ id: "am_1" }]);
});

afterEach(() => vi.clearAllMocks());

describe("record-turn handler", () => {
  it("appends the user + assistant messages and returns their ids", async () => {
    const res = await handler(event(VALID));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({
      threadId: "thr_1",
      userMessageId: "um_1",
      assistantMessageId: "am_1",
    });
    expect(mockUpdateSet).toHaveBeenCalledWith({
      last_turn_completed_at: expect.any(Date),
      last_response_preview: "hi there",
      updated_at: expect.any(Date),
    });
  });

  it("404s when the thread is not found for the caller's tenant", async () => {
    mockSelectLimit.mockReset();
    mockSelectLimit
      .mockReturnValueOnce([{ id: "u1", tenant_id: "t1" }])
      .mockReturnValueOnce([]); // no thread
    const res = await handler(event(VALID));
    expect(res.statusCode).toBe(404);
  });

  it("403s when the caller has no resolved tenant", async () => {
    mockSelectLimit.mockReset();
    mockSelectLimit.mockReturnValueOnce([]); // no user row
    const res = await handler(event(VALID));
    expect(res.statusCode).toBe(403);
  });

  it("401s when unauthenticated", async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await handler(event(VALID));
    expect(res.statusCode).toBe(401);
  });

  it("400s on missing threadId", async () => {
    const res = await handler(event({ userText: "a", assistantText: "b" }));
    expect(res.statusCode).toBe(400);
  });

  it("400s on missing assistantText", async () => {
    const res = await handler(event({ threadId: "thr_1", userText: "a" }));
    expect(res.statusCode).toBe(400);
  });

  it("short-circuits OPTIONS with 204 before auth", async () => {
    const res = await handler(event(VALID, "OPTIONS"));
    expect(res.statusCode).toBe(204);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});
