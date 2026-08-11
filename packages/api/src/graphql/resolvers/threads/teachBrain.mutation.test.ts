/**
 * teachBrain resolver tests (THINK-784): required text, server-side
 * taught_by attribution, the optional-thread visibility gate, config
 * failure, and the 4xx/5xx error surface.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockGetSecret,
  mockCachedM2mToken,
  mockPostBrainTeaching,
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
    mockPostBrainTeaching: vi.fn(),
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
    threads: { id: "threads.id", tenant_id: "threads.tenant_id" },
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

vi.mock("../../../lib/brain/teach.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../lib/brain/teach.js")>();
  return { ...original, postBrainTeaching: mockPostBrainTeaching };
});

import { teachBrain } from "./teachBrain.mutation.js";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function cognitoCtx(email = "expert@mcpherson.com") {
  return {
    auth: { authType: "cognito", email },
  } as any;
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
  mockPostBrainTeaching.mockResolvedValue({
    kind: "accepted",
    teachingId: "teaching-1",
    taskId: "task-1",
    note: null,
  });
});

describe("teachBrain", () => {
  it("rejects an empty statement before doing anything else", async () => {
    await expect(
      teachBrain(null, { input: { text: "   " } }, cognitoCtx()),
    ).rejects.toThrow(/statement is required/i);
    expect(mockPostBrainTeaching).not.toHaveBeenCalled();
  });

  it("rejects a caller with no resolvable identity — taught_by is required", async () => {
    await expect(
      teachBrain(
        null,
        { input: { text: "Waco depot's backup generator is the Beast" } },
        cognitoCtx(""),
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mockPostBrainTeaching).not.toHaveBeenCalled();
  });

  it("teaches globally without any thread lookup", async () => {
    const result = await teachBrain(
      null,
      {
        input: { text: "  The Waco depot generator is nicknamed the Beast.  " },
      },
      cognitoCtx(),
    );
    expect(result).toEqual({
      teachingId: "teaching-1",
      taskId: "task-1",
      note: null,
    });
    expect(mockResolveCallerTenantId).not.toHaveBeenCalled();

    const call = mockPostBrainTeaching.mock.calls[0][0];
    expect(call.teachingsUrl).toBe(
      "https://opsapi.execute-api.us-east-1.amazonaws.com/teachings",
    );
    expect(call.token).toBe("m2m-token");
    expect(call.payload).toEqual({
      source: "thinkwork-agent",
      taught_by: "expert@mcpherson.com",
      text: "The Waco depot generator is nicknamed the Beast.",
    });
  });

  it("rejects a non-UUID answersQuestionId before posting", async () => {
    await expect(
      teachBrain(
        null,
        { input: { text: "answer", answersQuestionId: "not-a-uuid" } },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mockPostBrainTeaching).not.toHaveBeenCalled();
  });

  it("passes a valid answersQuestionId through to the payload", async () => {
    const questionId = "44444444-4444-4444-8444-444444444444";
    await teachBrain(
      null,
      { input: { text: "answer", answersQuestionId: questionId } },
      cognitoCtx(),
    );
    const call = mockPostBrainTeaching.mock.calls[0][0];
    expect(call.payload.answers_question_id).toBe(questionId);
  });

  it("resolves a visible thread to context_thread_url", async () => {
    selectQueue.push([{ id: THREAD_ID }]);
    await teachBrain(
      null,
      { input: { text: "teach with context", threadId: THREAD_ID } },
      cognitoCtx(),
    );
    const call = mockPostBrainTeaching.mock.calls[0][0];
    expect(call.payload.context_thread_url).toBe(
      `https://mcpherson.thinkwork.ai/threads/${THREAD_ID}`,
    );
  });

  it("surfaces an invisible or foreign context thread as NOT_FOUND", async () => {
    selectQueue.push([]);
    await expect(
      teachBrain(
        null,
        { input: { text: "teach", threadId: THREAD_ID } },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    expect(mockPostBrainTeaching).not.toHaveBeenCalled();
  });

  it("fails with FAILED_PRECONDITION when the ops-api config is absent", async () => {
    mockGetConfig.mockReturnValue("");
    await expect(
      teachBrain(null, { input: { text: "teach" } }, cognitoCtx()),
    ).rejects.toMatchObject({ extensions: { code: "FAILED_PRECONDITION" } });
    expect(mockPostBrainTeaching).not.toHaveBeenCalled();
  });

  it("passes through an accepted-but-not-dispatched note with a null task id", async () => {
    mockPostBrainTeaching.mockResolvedValue({
      kind: "accepted",
      teachingId: "teaching-1",
      taskId: null,
      note: "queued: platform agent busy",
    });
    const result = await teachBrain(
      null,
      { input: { text: "teach" } },
      cognitoCtx(),
    );
    expect(result).toEqual({
      teachingId: "teaching-1",
      taskId: null,
      note: "queued: platform agent busy",
    });
  });

  it("maps a Brain 4xx to BAD_USER_INPUT with the server message", async () => {
    mockPostBrainTeaching.mockResolvedValue({
      kind: "rejected",
      status: 400,
      message: "domain must be a lowercase-dash slug",
    });
    await expect(
      teachBrain(null, { input: { text: "teach" } }, cognitoCtx()),
    ).rejects.toMatchObject({
      message: expect.stringContaining("lowercase-dash slug"),
      extensions: { code: "BAD_USER_INPUT" },
    });
  });

  it("maps unreachable/5xx to a retryable SERVICE_UNAVAILABLE error", async () => {
    mockPostBrainTeaching.mockResolvedValue({
      kind: "unreachable",
      message: "HTTP 503",
    });
    await expect(
      teachBrain(null, { input: { text: "teach" } }, cognitoCtx()),
    ).rejects.toMatchObject({
      message: "Couldn't reach the Brain — try again.",
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  });
});
