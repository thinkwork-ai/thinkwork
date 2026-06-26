import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  THREAD_JSON_RENDER_CATALOG_VERSION,
  THREAD_JSON_RENDER_PART_TYPE,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
  createThreadJsonRenderSpecHash,
  type ThreadJsonRenderPart,
} from "../../../lib/thread-json-render/persisted-parts.js";

const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const SOURCE_MESSAGE_ID = "66666666-6666-6666-6666-666666666666";

const mocks = vi.hoisted(() => ({
  tables: {
    messages: {
      __table__: "messages",
      id: { name: "messages.id" },
      thread_id: { name: "messages.thread_id" },
      tenant_id: { name: "messages.tenant_id" },
      role: { name: "messages.role" },
      parts: { name: "messages.parts" },
      metadata: { name: "messages.metadata" },
      sender_id: { name: "messages.sender_id" },
      created_at: { name: "messages.created_at" },
    },
    threads: {
      __table__: "threads",
      id: { name: "threads.id" },
      tenant_id: { name: "threads.tenant_id" },
    },
  },
  selectQueue: [] as Array<Array<Record<string, unknown>>>,
  resolveCallerFromAuth: vi.fn(),
  visiblePredicate: vi.fn(() => ({ visible: true })),
  sendMessage: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = mocks.selectQueue.shift() ?? [];
          const promise = Promise.resolve(rows);
          return Object.assign(promise, { limit: () => Promise.resolve(rows) });
        },
      }),
    }),
  },
  eq: (field: unknown, value: unknown) => ({ eq: [field, value] }),
  gt: (field: unknown, value: unknown) => ({ gt: [field, value] }),
  messageToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    threadId: row.thread_id,
    tenantId: row.tenant_id,
    role: row.role,
    content: row.content,
    metadata: row.metadata,
    createdAt: row.created_at,
  }),
  messages: mocks.tables.messages,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join("?"),
    values,
  }),
  threads: mocks.tables.threads,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mocks.resolveCallerFromAuth,
}));

vi.mock("../threads/access.js", () => ({
  callerVisibleThreadPredicate: mocks.visiblePredicate,
}));

vi.mock("./sendMessage.mutation.js", () => ({
  sendMessage: mocks.sendMessage,
}));

import { handleGenUIAction } from "./handleGenUIAction.mutation.js";

const ctx = { auth: { authType: "cognito" } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectQueue = [];
  mocks.resolveCallerFromAuth.mockResolvedValue({
    userId: USER_ID,
    tenantId: TENANT_ID,
  });
  mocks.sendMessage.mockResolvedValue({
    id: "message-action-1",
    threadId: THREAD_ID,
    tenantId: TENANT_ID,
    role: "USER",
    content: "GenUI action: Approve",
    metadata: {},
    createdAt: "2026-06-21T00:00:00.000Z",
  });
});

describe("handleGenUIAction", () => {
  it("validates the persisted part and dispatches a normal user message", async () => {
    const fixture = sourcePart();
    enqueueHappySource(fixture);
    mocks.selectQueue.push([]); // duplicate lookup
    mocks.selectQueue.push([{ count: 0 }]); // rate limit

    const result = await handleGenUIAction(
      {},
      { input: actionInput(fixture) },
      ctx,
    );

    expect(result.id).toBe("message-action-1");
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    const forwarded = mocks.sendMessage.mock.calls[0][1].input;
    expect(forwarded).toMatchObject({
      threadId: THREAD_ID,
      role: "USER",
      agentRequested: true,
      senderType: "user",
      senderId: USER_ID,
    });
    expect(forwarded.content).toContain("Generated UI action: Approve");
    expect(JSON.parse(forwarded.metadata).jsonRenderAction).toMatchObject({
      source: "json_render_action",
      sourceMessageId: SOURCE_MESSAGE_ID,
      partId: fixture.id,
      actionId: "approve-task",
      actionKind: "approve",
      specHash: fixture.data.specHash,
      idempotencyKey: actionInput(fixture).idempotencyKey,
    });
  });

  it("returns an existing idempotent action message without dispatching twice", async () => {
    const fixture = sourcePart();
    enqueueHappySource(fixture);
    mocks.selectQueue.push([
      {
        id: "message-existing",
        thread_id: THREAD_ID,
        tenant_id: TENANT_ID,
        role: "user",
        content: "GenUI action: Approve",
        metadata: { jsonRenderAction: { idempotencyKey: "idem-1" } },
        created_at: new Date("2026-06-21T00:00:00Z"),
      },
    ]);

    const result = await handleGenUIAction(
      {},
      { input: actionInput(fixture) },
      ctx,
    );

    expect(result.id).toBe("message-existing");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects stale action submissions with an old spec hash", async () => {
    const fixture = sourcePart();
    enqueueHappySource(fixture);

    await expect(
      handleGenUIAction(
        {},
        { input: { ...actionInput(fixture), specHash: "old" } },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects unknown action ids before dispatch", async () => {
    const fixture = sourcePart();
    enqueueHappySource(fixture);

    await expect(
      handleGenUIAction(
        {},
        { input: { ...actionInput(fixture), actionId: "unknown" } },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects submitted params that try to override host-owned context", async () => {
    const fixture = sourcePart();
    enqueueHappySource(fixture);

    await expect(
      handleGenUIAction(
        {},
        {
          input: {
            ...actionInput(fixture),
            params: {
              taskId: "task-123",
              threadId: "attacker-thread",
              senderId: "attacker-user",
            },
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rate-limits repeated unique submissions before dispatch", async () => {
    const fixture = sourcePart();
    enqueueHappySource(fixture);
    mocks.selectQueue.push([]); // duplicate lookup
    mocks.selectQueue.push([{ count: 12 }]); // rate limit

    await expect(
      handleGenUIAction(
        {},
        { input: { ...actionInput(fixture), idempotencyKey: "idem-2" } },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "RATE_LIMITED" } });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});

function sourcePart() {
  const spec = {
    root: "review",
    elements: {
      review: {
        type: "task.review",
        props: {
          title: "Review onboarding task",
          summary: "Confirm the customer kickoff task is ready.",
          status: "pending",
          primaryActionId: "approve-task",
        },
        children: [],
      },
    },
  };
  return {
    type: THREAD_JSON_RENDER_PART_TYPE,
    id: "json-render:task-review:123",
    data: {
      schemaVersion: THREAD_JSON_RENDER_SCHEMA_VERSION,
      catalogVersion: THREAD_JSON_RENDER_CATALOG_VERSION,
      status: "ready",
      spec,
      mobileFallback: {
        title: "Review onboarding task",
        summary: "Confirm the customer kickoff task is ready.",
      },
      durableActions: [
        {
          id: "approve-task",
          label: "Approve",
          kind: "approve",
          params: { taskId: "task-123" },
        },
      ],
      specHash: createThreadJsonRenderSpecHash(spec),
    },
  } satisfies ThreadJsonRenderPart;
}

function enqueueHappySource(fixture: ReturnType<typeof sourcePart>) {
  mocks.selectQueue.push([{ id: THREAD_ID }]);
  mocks.selectQueue.push([
    {
      id: SOURCE_MESSAGE_ID,
      thread_id: THREAD_ID,
      tenant_id: TENANT_ID,
      role: "assistant",
      parts: [fixture],
    },
  ]);
}

function actionInput(fixture: ReturnType<typeof sourcePart>) {
  return {
    threadId: THREAD_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    partId: fixture.id,
    actionId: "approve-task",
    specHash: fixture.data.specHash!,
    idempotencyKey: "idem-1",
    params: { taskId: "task-123" },
  };
}
