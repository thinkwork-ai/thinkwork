import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  prepareLocalPiRuntimeSession: vi.fn(),
}));

vi.mock("../lib/cognito-auth.js", () => ({
  authenticate: mocks.authenticate,
}));

vi.mock("../lib/desktop-runtime/prepare-local-turn.js", () => {
  class DesktopRuntimeSessionError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
      public readonly code: string,
    ) {
      super(message);
      this.name = "DesktopRuntimeSessionError";
    }
  }
  return {
    DesktopRuntimeSessionError,
    prepareLocalPiRuntimeSession: mocks.prepareLocalPiRuntimeSession,
  };
});

import { handler } from "./desktop-runtime-session.js";

const AGENT_ID = "33333333-3333-3333-3333-333333333333";
const THREAD_ID = "44444444-4444-4444-4444-444444444444";

function event(
  overrides: Record<string, unknown> = {},
): Parameters<typeof handler>[0] {
  return {
    requestContext: {
      http: {
        method:
          typeof overrides.method === "string" ? overrides.method : "POST",
        path: "/api/desktop/runtime-session",
      },
    },
    headers: { authorization: "Bearer token" },
    body:
      overrides.body === undefined
        ? JSON.stringify({
            agentId: AGENT_ID,
            threadId: THREAD_ID,
            userMessage: "Help",
          })
        : (overrides.body as string),
  } as unknown as Parameters<typeof handler>[0];
}

describe("desktop-runtime-session handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({
      authType: "cognito",
      email: "user@example.com",
      principalId: "cognito-sub",
      tenantId: null,
      agentId: null,
    });
    mocks.prepareLocalPiRuntimeSession.mockResolvedValue({
      threadTurnId: "turn-1",
      expiresAt: "2026-05-28T13:00:00.000Z",
      finalizeCallbackUrl: `https://api.example.com/api/threads/${THREAD_ID}/finalize`,
      finalizeCallbackSecret: "dps_token",
      sidecarCredentials: {
        mode: "desktop-sidecar-session",
        expiresAt: "2026-05-28T13:00:00.000Z",
      },
      invocation: {
        pi_sdk: {
          packageName: "@earendil-works/pi-coding-agent",
          sessionFactory: "createAgentSession",
        },
        thread_turn_id: "turn-1",
        finalize_callback_secret: "dps_token",
      },
    });
  });

  it("requires a Cognito user caller", async () => {
    mocks.authenticate.mockResolvedValue({
      authType: "service",
      email: null,
      principalId: null,
      tenantId: null,
      agentId: null,
    });

    const res = await handler(event());
    expect(res.statusCode).toBe(401);
    expect(mocks.prepareLocalPiRuntimeSession).not.toHaveBeenCalled();
  });

  it("returns a prepared local runtime session envelope", async () => {
    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.ok).toBe(true);
    expect(body.session.threadTurnId).toBe("turn-1");
    expect(body.session.finalizeCallbackSecret).toMatch(/^dps_/);
    expect(body.session.invocation.pi_sdk.packageName).toBe(
      "@earendil-works/pi-coding-agent",
    );
    expect(mocks.prepareLocalPiRuntimeSession).toHaveBeenCalledWith({
      auth: expect.objectContaining({ authType: "cognito" }),
      agentId: AGENT_ID,
      threadId: THREAD_ID,
      messageId: undefined,
      userMessage: "Help",
      messageAttachments: undefined,
    });
  });

  it("rejects invalid JSON before preparing a turn", async () => {
    const res = await handler(event({ body: "{ nope" }));
    expect(res.statusCode).toBe(400);
    expect(mocks.prepareLocalPiRuntimeSession).not.toHaveBeenCalled();
  });
});
