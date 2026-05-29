import { describe, expect, it } from "vitest";
import { authenticateDesktopFinalizeToken } from "./finalize-auth.js";
import {
  createDesktopFinalizeToken,
  hashDesktopFinalizeToken,
} from "./sidecar-credentials.js";

function fakeDb(turnRow: Record<string, unknown> | undefined) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (turnRow ? [turnRow] : []),
        }),
      }),
    }),
  } as never;
}

const FUTURE = new Date(Date.now() + 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

function turn(
  token: string,
  overrides: Record<string, unknown> = {},
  session: Record<string, unknown> = {},
) {
  return {
    id: "turn-1",
    tenant_id: "tenant-1",
    thread_id: "thread-1",
    agent_id: "agent-1",
    context_snapshot: {
      desktop_runtime_session: {
        finalize_token_sha256: hashDesktopFinalizeToken(token),
        expires_at: FUTURE,
        caller_user_id: "user-1",
        caller_email: "eric@thinkwork.ai",
        ...session,
      },
    },
    ...overrides,
  };
}

describe("authenticateDesktopFinalizeToken", () => {
  it("returns scoped identity from the turn for a valid token", async () => {
    const token = createDesktopFinalizeToken();
    const identity = await authenticateDesktopFinalizeToken({
      token,
      threadTurnId: "turn-1",
      db: fakeDb(turn(token)),
    });
    expect(identity).toEqual({
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      userId: "user-1",
      email: "eric@thinkwork.ai",
    });
  });

  it("rejects a non-desktop token without touching the db", async () => {
    expect(
      await authenticateDesktopFinalizeToken({
        token: "some-service-secret",
        threadTurnId: "turn-1",
        db: fakeDb(undefined),
      }),
    ).toBeNull();
  });

  it("rejects when no threadTurnId is provided", async () => {
    const token = createDesktopFinalizeToken();
    expect(
      await authenticateDesktopFinalizeToken({
        token,
        threadTurnId: "",
        db: fakeDb(turn(token)),
      }),
    ).toBeNull();
  });

  it("rejects when the turn is not found", async () => {
    const token = createDesktopFinalizeToken();
    expect(
      await authenticateDesktopFinalizeToken({
        token,
        threadTurnId: "missing",
        db: fakeDb(undefined),
      }),
    ).toBeNull();
  });

  it("rejects an expired session", async () => {
    const token = createDesktopFinalizeToken();
    expect(
      await authenticateDesktopFinalizeToken({
        token,
        threadTurnId: "turn-1",
        db: fakeDb(turn(token, {}, { expires_at: PAST })),
      }),
    ).toBeNull();
  });

  it("rejects a token whose hash does not match the session", async () => {
    const minted = createDesktopFinalizeToken();
    const other = createDesktopFinalizeToken();
    expect(
      await authenticateDesktopFinalizeToken({
        token: other,
        threadTurnId: "turn-1",
        db: fakeDb(turn(minted)),
      }),
    ).toBeNull();
  });

  it("rejects when the session has no caller_user_id", async () => {
    const token = createDesktopFinalizeToken();
    expect(
      await authenticateDesktopFinalizeToken({
        token,
        threadTurnId: "turn-1",
        db: fakeDb(turn(token, {}, { caller_user_id: undefined })),
      }),
    ).toBeNull();
  });
});
