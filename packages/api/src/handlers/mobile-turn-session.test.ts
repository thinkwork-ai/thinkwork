import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const {
  mockAuthenticate,
  mockStartMobileTurn,
  mockHeartbeatMobileTurn,
  mockCheckpointMobileTurn,
  mockFinalizeLocalMobileTurn,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockStartMobileTurn: vi.fn(),
  mockHeartbeatMobileTurn: vi.fn(),
  mockCheckpointMobileTurn: vi.fn(),
  mockFinalizeLocalMobileTurn: vi.fn(),
}));

vi.mock("../lib/cognito-auth.js", () => ({ authenticate: mockAuthenticate }));
vi.mock("../lib/mobile-turns/lifecycle.js", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/mobile-turns/lifecycle.js")
  >("../lib/mobile-turns/lifecycle.js");
  return {
    ...actual,
    startMobileTurn: mockStartMobileTurn,
    heartbeatMobileTurn: mockHeartbeatMobileTurn,
    checkpointMobileTurn: mockCheckpointMobileTurn,
    finalizeLocalMobileTurn: mockFinalizeLocalMobileTurn,
  };
});

import { handler } from "./mobile-turn-session";

function event(body: unknown, method = "POST"): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method, path: "/api/mobile/turn-session" } },
    headers: { authorization: "Bearer tok" },
    body: JSON.stringify(body),
    rawPath: "/api/mobile/turn-session",
  } as unknown as APIGatewayProxyEventV2;
}

function parse(res: { body?: unknown }) {
  return JSON.parse(res.body as string);
}

beforeEach(() => {
  mockAuthenticate.mockReset();
  mockStartMobileTurn.mockReset();
  mockHeartbeatMobileTurn.mockReset();
  mockCheckpointMobileTurn.mockReset();
  mockFinalizeLocalMobileTurn.mockReset();
  mockAuthenticate.mockResolvedValue({
    principalId: "p1",
    tenantId: "tenant-1",
    email: "eric@example.com",
    authType: "cognito",
    agentId: null,
  });
});

describe("mobile-turn-session handler", () => {
  it("starts a durable mobile turn", async () => {
    mockStartMobileTurn.mockResolvedValue({
      threadTurnId: "turn-1",
      threadId: "thread-1",
      userMessageId: "msg-user-1",
      status: "running",
      checkpointSeq: 0,
      idempotent: false,
    });

    const res = await handler(
      event({
        action: "start",
        clientTurnId: "client-turn-1",
        threadId: "thread-1",
        userText: "hello",
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(parse(res)).toMatchObject({ threadTurnId: "turn-1" });
    expect(mockStartMobileTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { email: "eric@example.com", tenantId: "tenant-1" },
        clientTurnId: "client-turn-1",
        threadId: "thread-1",
        userText: "hello",
      }),
    );
  });

  it("records heartbeat through the lifecycle service", async () => {
    mockHeartbeatMobileTurn.mockResolvedValue({ ok: true });

    const res = await handler(
      event({
        action: "heartbeat",
        threadTurnId: "turn-1",
        latestCheckpointSeq: 3,
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(mockHeartbeatMobileTurn).toHaveBeenCalledWith({
      auth: { email: "eric@example.com", tenantId: "tenant-1" },
      threadTurnId: "turn-1",
      latestCheckpointSeq: 3,
    });
  });

  it("records checkpoints through the lifecycle service", async () => {
    mockCheckpointMobileTurn.mockResolvedValue({ seq: 2 });

    const res = await handler(
      event({
        action: "checkpoint",
        threadTurnId: "turn-1",
        checkpoint: { text: "partial" },
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual({ seq: 2 });
    expect(mockCheckpointMobileTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadTurnId: "turn-1",
        checkpoint: { text: "partial" },
      }),
    );
  });

  it("finalizes local completion through the one-winner lifecycle service", async () => {
    mockFinalizeLocalMobileTurn.mockResolvedValue({
      finalized: true,
      assistantMessageId: "msg-assistant-1",
    });

    const res = await handler(
      event({
        action: "finalize",
        threadTurnId: "turn-1",
        assistantText: "done",
        changedFiles: [{ path: "note.md", op: "create", content: "hello" }],
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual({
      finalized: true,
      assistantMessageId: "msg-assistant-1",
    });
    expect(mockFinalizeLocalMobileTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadTurnId: "turn-1",
        changedFiles: [{ path: "note.md", op: "create", content: "hello" }],
      }),
    );
  });

  it("rejects invalid finalize changed files before lifecycle finalization", async () => {
    const res = await handler(
      event({
        action: "finalize",
        threadTurnId: "turn-1",
        assistantText: "done",
        changedFiles: [{ path: "../secret.md", op: "create", content: "no" }],
      }),
    );

    expect(res.statusCode).toBe(400);
    expect(parse(res)).toEqual({ error: "Invalid changed_files" });
    expect(mockFinalizeLocalMobileTurn).not.toHaveBeenCalled();
  });

  it("requires Cognito auth", async () => {
    mockAuthenticate.mockResolvedValue(null);

    const res = await handler(
      event({ action: "heartbeat", threadTurnId: "turn-1" }),
    );

    expect(res.statusCode).toBe(401);
    expect(mockHeartbeatMobileTurn).not.toHaveBeenCalled();
  });

  it("short-circuits OPTIONS before auth", async () => {
    const res = await handler(event({}, "OPTIONS"));
    expect(res.statusCode).toBe(204);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});
