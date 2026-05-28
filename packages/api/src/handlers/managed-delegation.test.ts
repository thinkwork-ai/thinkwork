import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runManagedDelegation: vi.fn(),
}));

vi.mock("../lib/desktop-runtime/managed-delegation.js", () => {
  class ManagedDelegationError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
      public readonly code: string,
    ) {
      super(message);
      this.name = "ManagedDelegationError";
    }
  }
  return {
    ManagedDelegationError,
    runManagedDelegation: mocks.runManagedDelegation,
  };
});

import { handler } from "./managed-delegation.js";

const PARENT_TURN_ID = "66666666-6666-6666-6666-666666666666";

function event(
  overrides: Record<string, unknown> = {},
): Parameters<typeof handler>[0] {
  return {
    requestContext: {
      http: {
        method:
          typeof overrides.method === "string" ? overrides.method : "POST",
        path: "/api/desktop/managed-delegation",
      },
    },
    headers:
      overrides.headers === undefined
        ? { authorization: "Bearer dps_secret" }
        : (overrides.headers as Record<string, string>),
    body:
      overrides.body === undefined
        ? JSON.stringify({
            parentThreadTurnId: PARENT_TURN_ID,
            task: "Run hosted work",
            visibility: "hidden",
          })
        : (overrides.body as string),
  } as unknown as Parameters<typeof handler>[0];
}

describe("managed-delegation handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runManagedDelegation.mockResolvedValue({
      ok: true,
      delegationId: "delegation-1",
      parentThreadTurnId: PARENT_TURN_ID,
      childThreadTurnId: "77777777-7777-7777-7777-777777777777",
      requestedVisibility: "hidden",
      effectiveVisibility: "hidden",
      status: "accepted",
    });
  });

  it("requires sidecar bearer auth", async () => {
    const res = await handler(event({ headers: {} }));
    expect(res.statusCode).toBe(401);
    expect(mocks.runManagedDelegation).not.toHaveBeenCalled();
  });

  it("dispatches managed delegation with the sidecar token", async () => {
    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.ok).toBe(true);
    expect(body.status).toBe("accepted");
    expect(mocks.runManagedDelegation).toHaveBeenCalledWith({
      parentThreadTurnId: PARENT_TURN_ID,
      finalizeCallbackSecret: "dps_secret",
      task: "Run hosted work",
      requestedVisibility: "hidden",
      reason: undefined,
      timeoutMs: undefined,
    });
  });

  it("rejects invalid visibility before dispatch", async () => {
    const res = await handler(
      event({
        body: JSON.stringify({
          parentThreadTurnId: PARENT_TURN_ID,
          task: "Run hosted work",
          visibility: "sometimes",
        }),
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(mocks.runManagedDelegation).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON before dispatch", async () => {
    const res = await handler(event({ body: "{ nope" }));
    expect(res.statusCode).toBe(400);
    expect(mocks.runManagedDelegation).not.toHaveBeenCalled();
  });
});
