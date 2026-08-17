/**
 * flagThreadToBrain resolver tests (THINK-781): required note, the
 * thread-visibility gate (member-level, NOT operator-gated), connector
 * resolution failure, payload assembly (conversation + thread_url +
 * flagged_by), and the 4xx/5xx error surface.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockGetSecret,
  mockCachedM2mToken,
  mockPostBrainFlag,
  mockGetConfig,
  resetState,
} = vi.hoisted(() => {
  const selectQueue: Array<unknown[] | Error> = [];
  return {
    selectQueue,
    mockResolveCallerTenantId: vi.fn(),
    mockResolveCallerUserId: vi.fn(),
    mockGetSecret: vi.fn(),
    mockCachedM2mToken: vi.fn(),
    mockPostBrainFlag: vi.fn(),
    mockGetConfig: vi.fn(),
    resetState: () => {
      selectQueue.length = 0;
    },
  };
});

vi.mock("../../utils.js", () => {
  const makeSelectChain = () => {
    const chain: any = {};
    for (const method of ["from", "where", "orderBy", "limit"]) {
      chain[method] = () => chain;
    }
    chain.then = (
      resolve: (rows: unknown[]) => unknown,
      reject: (err: unknown) => unknown,
    ) => {
      const next = selectQueue.shift() ?? [];
      return (
        next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
      ).then(resolve, reject);
    };
    return chain;
  };
  return {
    db: { select: () => makeSelectChain() },
    eq: (...args: unknown[]) => ({ eq: args }),
    and: (...args: unknown[]) => ({ and: args }),
    asc: (col: unknown) => ({ asc: col }),
    threads: { id: "threads.id", tenant_id: "threads.tenant_id" },
    messages: {
      id: "messages.id",
      role: "messages.role",
      content: "messages.content",
      parts: "messages.parts",
      created_at: "messages.created_at",
      thread_id: "messages.thread_id",
      tenant_id: "messages.tenant_id",
    },
  };
});

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("./access.js", () => ({
  callerVisibleThreadPredicate: vi.fn(() => ({ visible: true })),
}));

vi.mock("../../../lib/twin/m2m-token.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../lib/twin/m2m-token.js")>();
  return { ...original, cachedM2mToken: mockCachedM2mToken };
});

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: mockGetConfig,
  getSecret: mockGetSecret,
}));

vi.mock("../../../lib/brain/flag-thread.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../lib/brain/flag-thread.js")>();
  return { ...original, postBrainFlag: mockPostBrainFlag };
});

import { flagThreadToBrain } from "./flagThreadToBrain.mutation.js";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function cognitoCtx() {
  return {
    auth: { authType: "cognito", email: "vp@mcpherson.com" },
  } as any;
}

function queueHappyPath() {
  selectQueue.push([{ id: THREAD_ID, tenant_id: TENANT_ID }]);
  selectQueue.push([
    {
      id: "m1",
      role: "user",
      content: "is this invoice paid?",
      parts: null,
      created_at: "2026-08-10T00:00:00Z",
    },
    {
      id: "m2",
      role: "assistant",
      content: "Yes, it was paid in full.",
      parts: null,
      created_at: "2026-08-10T00:00:05Z",
    },
  ]);
}

beforeEach(() => {
  resetState();
  vi.clearAllMocks();
  mockResolveCallerTenantId.mockResolvedValue(TENANT_ID);
  mockResolveCallerUserId.mockResolvedValue(USER_ID);
  mockGetConfig.mockImplementation((key: string) => {
    if (key === "BRAIN_OPS_API_URL")
      return "https://opsapi.execute-api.us-east-1.amazonaws.com";
    if (key === "BRAIN_OPS_M2M_SECRET_ARN")
      return "arn:aws:secretsmanager:us-east-1:1:secret:brain-agent-m2m";
    if (key === "ADMIN_URL") return "https://mcpherson.thinkwork.ai";
    return "";
  });
  mockGetSecret.mockResolvedValue(
    JSON.stringify({
      client_id: "client",
      client_secret: "secret",
      token_url: "https://pool.auth.us-east-1.amazoncognito.com/oauth2/token",
      scope: "etl-agent/tasks",
    }),
  );
  mockCachedM2mToken.mockResolvedValue("m2m-token");
  mockPostBrainFlag.mockResolvedValue({
    kind: "accepted",
    flagId: "flag-1",
    taskId: "task-1",
    note: null,
  });
});

describe("flagThreadToBrain", () => {
  it("rejects an empty note before touching the database", async () => {
    await expect(
      flagThreadToBrain(
        null,
        { input: { threadId: THREAD_ID, note: "   " } },
        cognitoCtx(),
      ),
    ).rejects.toThrow(/note is required/i);
    expect(mockResolveCallerTenantId).not.toHaveBeenCalled();
  });

  it("surfaces an invisible or foreign thread as NOT_FOUND", async () => {
    selectQueue.push([]);
    await expect(
      flagThreadToBrain(
        null,
        { input: { threadId: THREAD_ID, note: "wrong answer" } },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    expect(mockPostBrainFlag).not.toHaveBeenCalled();
  });

  it("fails with FAILED_PRECONDITION when the ops-api config is absent", async () => {
    selectQueue.push([{ id: THREAD_ID, tenant_id: TENANT_ID }]);
    mockGetConfig.mockReturnValue("");
    await expect(
      flagThreadToBrain(
        null,
        { input: { threadId: THREAD_ID, note: "wrong answer" } },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "FAILED_PRECONDITION" } });
    expect(mockPostBrainFlag).not.toHaveBeenCalled();
  });

  it("posts the serialized conversation with thread_url and flagged_by, returning the Brain's ids", async () => {
    queueHappyPath();
    const result = await flagThreadToBrain(
      null,
      {
        input: { threadId: THREAD_ID, note: "  the payment claim is false  " },
      },
      cognitoCtx(),
    );
    expect(result).toEqual({ flagId: "flag-1", taskId: "task-1", note: null });

    expect(mockCachedM2mToken).toHaveBeenCalledWith(
      "arn:aws:secretsmanager:us-east-1:1:secret:brain-agent-m2m",
      expect.objectContaining({ clientId: "client" }),
    );
    const call = mockPostBrainFlag.mock.calls[0][0];
    expect(call.submissionsUrl).toBe(
      "https://opsapi.execute-api.us-east-1.amazonaws.com/submissions",
    );
    expect(call.token).toBe("m2m-token");
    expect(call.payload).toEqual({
      source: "thinkwork-agent",
      thread_id: THREAD_ID,
      thread_url: `https://mcpherson.thinkwork.ai/threads/${THREAD_ID}`,
      flagged_by: "vp@mcpherson.com",
      note: "the payment claim is false",
      conversation: [
        {
          role: "user",
          at: "2026-08-10T00:00:00.000Z",
          text: "is this invoice paid?",
        },
        {
          role: "assistant",
          at: "2026-08-10T00:00:05.000Z",
          text: "Yes, it was paid in full.",
        },
      ],
    });
  });

  it("passes through an accepted-but-not-dispatched note with a null task id", async () => {
    queueHappyPath();
    mockPostBrainFlag.mockResolvedValue({
      kind: "accepted",
      flagId: "flag-1",
      taskId: null,
      note: "queued: platform agent busy",
    });
    const result = await flagThreadToBrain(
      null,
      { input: { threadId: THREAD_ID, note: "wrong" } },
      cognitoCtx(),
    );
    expect(result).toEqual({
      flagId: "flag-1",
      taskId: null,
      note: "queued: platform agent busy",
    });
  });

  it("maps a Brain 4xx to BAD_USER_INPUT with the server message", async () => {
    queueHappyPath();
    mockPostBrainFlag.mockResolvedValue({
      kind: "rejected",
      status: 400,
      message: "conversation too large",
    });
    await expect(
      flagThreadToBrain(
        null,
        { input: { threadId: THREAD_ID, note: "wrong" } },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("conversation too large"),
      extensions: { code: "BAD_USER_INPUT" },
    });
  });

  it("maps unreachable/5xx to a retryable SERVICE_UNAVAILABLE error", async () => {
    queueHappyPath();
    mockPostBrainFlag.mockResolvedValue({
      kind: "unreachable",
      message: "HTTP 503",
    });
    await expect(
      flagThreadToBrain(
        null,
        { input: { threadId: THREAD_ID, note: "wrong" } },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({
      message: "Couldn't reach the Brain — try again.",
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  });
});
