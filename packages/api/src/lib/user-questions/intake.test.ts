/**
 * ask_user_question intake — auth, payload-contract validation, the
 * security-critical thread-turn ownership join, the single-transaction
 * message + pending-row write, 409 conflict mapping, and awaited fan-out.
 * Plan 2026-06-09-005 U2.
 *
 * Mocking mirrors chat-agent-activity.test.ts: stub getDb() with a
 * chainable select harness + a transaction wrapper that simulates
 * rollback (restores recorded inserts on throw), so the 409 test can
 * assert that NO message row survives a pending-row conflict.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const TURN_ID = "44444444-4444-4444-4444-444444444444";
const OTHER_THREAD_ID = "55555555-5555-5555-5555-555555555555";
const OTHER_TENANT_ID = "99999999-9999-9999-9999-999999999999";
const MESSAGE_ID = "66666666-6666-6666-6666-666666666666";
const VALID_SECRET = "test-api-secret-xyz";

interface TurnRow {
  id: string;
  tenant_id: string;
  thread_id: string | null;
  agent_id: string | null;
  status: string;
}

interface ThreadRow {
  id: string;
  tenant_id: string;
  status: string;
  title: string;
}

const mocks = vi.hoisted(() => ({
  tables: {
    threadTurns: {
      id: { name: "id" },
      tenant_id: { name: "tenant_id" },
      thread_id: { name: "thread_id" },
      agent_id: { name: "agent_id" },
      status: { name: "status" },
    },
    threads: {
      id: { name: "id" },
      tenant_id: { name: "tenant_id" },
      status: { name: "status" },
      title: { name: "title" },
    },
    messages: { id: { name: "id" } },
    pendingUserQuestions: { id: { name: "id" } },
  },
  turnRow: null as unknown,
  threadRow: null as unknown,
  insertedMessages: [] as Array<Record<string, unknown>>,
  insertedQuestions: [] as Array<Record<string, unknown>>,
  pendingInsertError: null as Error | null,
  notifyNewMessage: vi.fn(),
  notifyThreadUpdate: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => {
  const tx = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === mocks.tables.messages) {
          return {
            returning: async () => {
              mocks.insertedMessages.push(values);
              return [{ id: MESSAGE_ID }];
            },
          };
        }
        return (async () => {
          if (mocks.pendingInsertError) throw mocks.pendingInsertError;
          mocks.insertedQuestions.push(values);
        })();
      },
    }),
  };
  return {
    getDb: () => ({
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => {
              if (table === mocks.tables.threadTurns) {
                return mocks.turnRow ? [mocks.turnRow] : [];
              }
              return mocks.threadRow ? [mocks.threadRow] : [];
            },
          }),
        }),
      }),
      // Simulate transactional rollback: any throw inside the callback
      // restores the recorded inserts to their pre-transaction state.
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
        const messagesSnapshot = mocks.insertedMessages.length;
        const questionsSnapshot = mocks.insertedQuestions.length;
        try {
          return await fn(tx);
        } catch (err) {
          mocks.insertedMessages.length = messagesSnapshot;
          mocks.insertedQuestions.length = questionsSnapshot;
          throw err;
        }
      },
    }),
  };
});

vi.mock("@thinkwork/database-pg/schema", () => mocks.tables);

vi.mock("../../graphql/notify.js", () => ({
  notifyNewMessage: mocks.notifyNewMessage,
  notifyThreadUpdate: mocks.notifyThreadUpdate,
}));

import { handleQuestionIntake } from "./intake.js";

function validQuestions() {
  return [
    {
      question: "Which environment should I deploy to?",
      header: "Environment",
      options: [
        { label: "Dev (Recommended)", description: "Safe to iterate" },
        { label: "Prod", description: "Customer-facing" },
      ],
    },
  ];
}

interface Overrides {
  authorization?: string;
  noAuth?: boolean;
  method?: string;
  threadIdPath?: string;
  body?: unknown;
}

function mockEvent(
  overrides: Overrides = {},
): Parameters<typeof handleQuestionIntake>[0] {
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
          questions: validQuestions(),
        });
  return {
    requestContext: {
      http: {
        method: overrides.method ?? "POST",
        path: `/api/threads/${overrides.threadIdPath ?? THREAD_ID}/questions`,
      },
    },
    headers: auth ? { authorization: auth } : {},
    pathParameters: { threadId: overrides.threadIdPath ?? THREAD_ID },
    body,
  } as unknown as Parameters<typeof handleQuestionIntake>[0];
}

function parseBody(res: { body?: string }): Record<string, unknown> {
  return JSON.parse(res.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.API_AUTH_SECRET = VALID_SECRET;
  mocks.turnRow = {
    id: TURN_ID,
    tenant_id: TENANT_ID,
    thread_id: THREAD_ID,
    agent_id: AGENT_ID,
    status: "running",
  } satisfies TurnRow;
  mocks.threadRow = {
    id: THREAD_ID,
    tenant_id: TENANT_ID,
    status: "in_progress",
    title: "Quarterly report",
  } satisfies ThreadRow;
  mocks.insertedMessages = [];
  mocks.insertedQuestions = [];
  mocks.pendingInsertError = null;
  mocks.notifyNewMessage.mockResolvedValue(undefined);
  mocks.notifyThreadUpdate.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.API_AUTH_SECRET;
});

describe("question intake — auth", () => {
  it("401 when Authorization is missing; nothing written, nothing notified", async () => {
    const res = await handleQuestionIntake(mockEvent({ noAuth: true }));
    expect(res.statusCode).toBe(401);
    expect(mocks.insertedMessages).toHaveLength(0);
    expect(mocks.insertedQuestions).toHaveLength(0);
    expect(mocks.notifyNewMessage).not.toHaveBeenCalled();
    expect(mocks.notifyThreadUpdate).not.toHaveBeenCalled();
  });

  it("401 when bearer doesn't match API_AUTH_SECRET", async () => {
    const res = await handleQuestionIntake(
      mockEvent({ authorization: "Bearer nope" }),
    );
    expect(res.statusCode).toBe(401);
    expect(mocks.insertedMessages).toHaveLength(0);
  });

  it("405 on non-POST", async () => {
    const res = await handleQuestionIntake(mockEvent({ method: "OPTIONS" }));
    expect(res.statusCode).toBe(405);
  });
});

describe("question intake — payload validation (400)", () => {
  it("400 on non-UUID threadId path param", async () => {
    const res = await handleQuestionIntake(
      mockEvent({ threadIdPath: "not-a-uuid" }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("400 on missing thread_turn_id", async () => {
    const res = await handleQuestionIntake(
      mockEvent({ body: { questions: validQuestions() } }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).error).toContain("thread_turn_id");
  });

  it("400 on 5 questions (max 4)", async () => {
    const q = validQuestions()[0];
    const res = await handleQuestionIntake(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          questions: [q, q, q, q, q],
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).error).toContain("too many questions");
    expect(mocks.insertedMessages).toHaveLength(0);
  });

  it("400 on a single option (min 2)", async () => {
    const res = await handleQuestionIntake(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          questions: [
            {
              question: "Pick one?",
              header: "Pick",
              options: [{ label: "Only", description: "" }],
            },
          ],
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).error).toContain("options");
  });

  it("400 on header longer than 12 chars", async () => {
    const res = await handleQuestionIntake(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          questions: [
            {
              question: "Pick one?",
              header: "ThirteenChars", // 13
              options: [
                { label: "A", description: "" },
                { label: "B", description: "" },
              ],
            },
          ],
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).error).toContain("header");
  });

  it("400 on option label longer than 60 chars", async () => {
    const res = await handleQuestionIntake(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          questions: [
            {
              question: "Pick one?",
              header: "Pick",
              options: [
                { label: "x".repeat(61), description: "" },
                { label: "B", description: "" },
              ],
            },
          ],
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).error).toContain("label");
  });

  it("400 when the serialized payload exceeds 8 KB", async () => {
    const res = await handleQuestionIntake(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          questions: [
            {
              question: "Pick one?",
              header: "Pick",
              options: [
                { label: "A", description: "y".repeat(9000) },
                { label: "B", description: "" },
              ],
            },
          ],
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).error).toContain("8192");
  });
});

describe("question intake — ownership join (security)", () => {
  it("404 when the turn does not exist", async () => {
    mocks.turnRow = null;
    const res = await handleQuestionIntake(mockEvent());
    expect(res.statusCode).toBe(404);
    expect(parseBody(res).code).toBe("TURN_NOT_FOUND");
    expect(mocks.insertedMessages).toHaveLength(0);
  });

  it("404 when the turn belongs to a different thread (forged path)", async () => {
    mocks.turnRow = {
      id: TURN_ID,
      tenant_id: TENANT_ID,
      thread_id: OTHER_THREAD_ID,
      agent_id: AGENT_ID,
      status: "running",
    } satisfies TurnRow;
    const res = await handleQuestionIntake(mockEvent());
    expect(res.statusCode).toBe(404);
    expect(parseBody(res).code).toBe("TURN_NOT_FOUND");
    expect(mocks.insertedMessages).toHaveLength(0);
    expect(mocks.notifyNewMessage).not.toHaveBeenCalled();
  });

  it("403 when the turn is no longer active", async () => {
    mocks.turnRow = {
      id: TURN_ID,
      tenant_id: TENANT_ID,
      thread_id: THREAD_ID,
      agent_id: AGENT_ID,
      status: "succeeded",
    } satisfies TurnRow;
    const res = await handleQuestionIntake(mockEvent());
    expect(res.statusCode).toBe(403);
    expect(parseBody(res).code).toBe("TURN_NOT_ACTIVE");
    expect(mocks.insertedMessages).toHaveLength(0);
  });

  it("403 when the thread's tenant does not match the turn's tenant", async () => {
    mocks.threadRow = {
      id: THREAD_ID,
      tenant_id: OTHER_TENANT_ID,
      status: "in_progress",
      title: "Quarterly report",
    } satisfies ThreadRow;
    const res = await handleQuestionIntake(mockEvent());
    expect(res.statusCode).toBe(403);
    expect(parseBody(res).code).toBe("TENANT_MISMATCH");
    expect(mocks.insertedMessages).toHaveLength(0);
    expect(mocks.notifyNewMessage).not.toHaveBeenCalled();
  });

  it("404 when the thread row is missing", async () => {
    mocks.threadRow = null;
    const res = await handleQuestionIntake(mockEvent());
    expect(res.statusCode).toBe(404);
    expect(parseBody(res).code).toBe("THREAD_NOT_FOUND");
  });
});

describe("question intake — happy path", () => {
  it("writes the pending row + the question message (content AND parts) and awaits both notifies", async () => {
    const delegationContext = {
      profileSlug: "researcher",
      originalTask: "find the report",
      escalationCount: 0,
    };
    const res = await handleQuestionIntake(
      mockEvent({
        body: {
          thread_turn_id: TURN_ID,
          questions: validQuestions(),
          delegation_context: delegationContext,
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.ok).toBe(true);
    expect(body.messageId).toBe(MESSAGE_ID);
    expect(typeof body.questionId).toBe("string");

    // Message: content carries the markdown fallback, parts the structure.
    expect(mocks.insertedMessages).toHaveLength(1);
    const message = mocks.insertedMessages[0];
    expect(message).toMatchObject({
      thread_id: THREAD_ID,
      tenant_id: TENANT_ID,
      role: "assistant",
      sender_type: "agent",
      sender_id: AGENT_ID,
    });
    expect(message.content).toContain("**Environment**");
    expect(message.content).toContain("Which environment should I deploy to?");
    expect(message.content).toContain("- Dev (Recommended) — Safe to iterate");
    expect(message.content).toContain("- Prod — Customer-facing");
    expect(message.parts).toEqual([
      {
        type: "data-user-question",
        questionId: body.questionId,
        questions: validQuestions(),
      },
    ]);

    // Pending row: questions payload + delegation_context, no answer state.
    expect(mocks.insertedQuestions).toHaveLength(1);
    expect(mocks.insertedQuestions[0]).toMatchObject({
      id: body.questionId,
      tenant_id: TENANT_ID,
      thread_id: THREAD_ID,
      message_id: MESSAGE_ID,
      thread_turn_id: TURN_ID,
      status: "pending",
      questions: validQuestions(),
      delegation_context: delegationContext,
    });

    // Fan-out: both notifies fired (and are awaited in the handler — LWA).
    expect(mocks.notifyNewMessage).toHaveBeenCalledTimes(1);
    expect(mocks.notifyNewMessage.mock.calls[0][0]).toMatchObject({
      messageId: MESSAGE_ID,
      threadId: THREAD_ID,
      tenantId: TENANT_ID,
      role: "assistant",
      senderType: "agent",
      senderId: AGENT_ID,
    });
    expect(mocks.notifyThreadUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.notifyThreadUpdate.mock.calls[0][0]).toMatchObject({
      threadId: THREAD_ID,
      tenantId: TENANT_ID,
      status: "in_progress",
      title: "Quarterly report",
    });
  });

  it("stores delegation_context as null when omitted", async () => {
    const res = await handleQuestionIntake(mockEvent());
    expect(res.statusCode).toBe(200);
    expect(mocks.insertedQuestions[0].delegation_context).toBeNull();
  });
});

describe("question intake — one pending per thread (409)", () => {
  it("maps the partial-unique-index violation to 409 and rolls the message back", async () => {
    mocks.pendingInsertError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "pending_user_questions_one_pending_per_thread"',
      ),
      { code: "23505" },
    );
    const res = await handleQuestionIntake(mockEvent());
    expect(res.statusCode).toBe(409);
    const body = parseBody(res);
    expect(body.code).toBe("QUESTION_ALREADY_PENDING");
    expect(body.error).toContain("already pending");
    // The transaction rolled back: no message row survives the conflict.
    expect(mocks.insertedMessages).toHaveLength(0);
    expect(mocks.insertedQuestions).toHaveLength(0);
    expect(mocks.notifyNewMessage).not.toHaveBeenCalled();
    expect(mocks.notifyThreadUpdate).not.toHaveBeenCalled();
  });

  it("recognizes 23505 wrapped in err.cause (driver wrapping)", async () => {
    mocks.pendingInsertError = Object.assign(new Error("insert failed"), {
      cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
    });
    const res = await handleQuestionIntake(mockEvent());
    expect(res.statusCode).toBe(409);
  });

  it("500 (not 409) on a non-unique-violation transaction failure", async () => {
    mocks.pendingInsertError = new Error("connection reset");
    const res = await handleQuestionIntake(mockEvent());
    expect(res.statusCode).toBe(500);
    expect(mocks.notifyNewMessage).not.toHaveBeenCalled();
  });
});
