import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  THREAD_JSON_RENDER_CATALOG_VERSION,
  THREAD_JSON_RENDER_PART_TYPE,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
  createThreadJsonRenderSpecHash,
  type ThreadJsonRenderPart,
} from "../../../lib/thread-json-render/persisted-parts.js";
import { createResultListJsonRenderFixture } from "@thinkwork/thread-json-render";

const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const SPACE_ID = "44444444-4444-4444-4444-444444444444";
const SOURCE_MESSAGE_ID = "66666666-6666-6666-6666-666666666666";
const WORK_ITEM_ID = "77777777-7777-7777-7777-777777777777";
const STATUS_DONE_ID = "88888888-8888-8888-8888-888888888888";

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
    workItemEvents: {
      __table__: "work_item_events",
      tenant_id: { name: "work_item_events.tenant_id" },
      work_item_id: { name: "work_item_events.work_item_id" },
      thread_id: { name: "work_item_events.thread_id" },
      metadata: { name: "work_item_events.metadata" },
      new_status_id: { name: "work_item_events.new_status_id" },
      created_at: { name: "work_item_events.created_at" },
    },
    threads: {
      __table__: "threads",
      id: { name: "threads.id" },
      tenant_id: { name: "threads.tenant_id" },
      space_id: { name: "threads.space_id" },
    },
  },
  selectQueue: [] as Array<Array<Record<string, unknown>>>,
  resolveCallerFromAuth: vi.fn(),
  visiblePredicate: vi.fn(() => ({ visible: true })),
  sendMessage: vi.fn(),
  setWorkItemStatus: vi.fn(),
  createWorkItemRow: vi.fn(),
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
  workItemEvents: mocks.tables.workItemEvents,
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

vi.mock("../../../lib/work-items/work-item-status-tool.js", () => ({
  setWorkItemStatus: mocks.setWorkItemStatus,
}));

vi.mock("../../../lib/work-items/work-item-service.js", () => ({
  createWorkItem: mocks.createWorkItemRow,
}));

import { handleJsonRenderAction } from "./handleJsonRenderAction.mutation.js";
import { TaskStatusToolError } from "../../../lib/task-status-tool.js";

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
    content: "Generated UI action: Approve",
    metadata: {},
    createdAt: "2026-06-21T00:00:00.000Z",
  });
  mocks.setWorkItemStatus.mockResolvedValue({
    ok: true,
    workItemId: WORK_ITEM_ID,
    previousStatusCategory: "active",
    statusCategory: "done",
    statusId: STATUS_DONE_ID,
    linkedTaskId: null,
  });
  mocks.createWorkItemRow.mockResolvedValue({
    id: "99999999-9999-9999-9999-999999999999",
    title: "Draft QA checklist",
    owner_user_id: USER_ID,
  });
});

describe("handleJsonRenderAction", () => {
  it("validates the persisted part, updates the Work Item, and records audit metadata", async () => {
    const fixture = sourcePart();
    enqueueHappySource(fixture);
    mocks.selectQueue.push([]); // duplicate lookup
    mocks.selectQueue.push([]); // prior work item event lookup
    mocks.selectQueue.push([{ count: 0 }]); // rate limit

    const result = await handleJsonRenderAction(
      {},
      { input: actionInput(fixture) },
      ctx,
    );

    expect(result.id).toBe("message-action-1");
    expect(mocks.setWorkItemStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setWorkItemStatus).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      workItemId: WORK_ITEM_ID,
      threadId: THREAD_ID,
      statusCategory: "DONE",
      statusId: null,
      note: "Approved from generated UI",
      actor: { type: "user", id: USER_ID },
      metadata: {
        jsonRenderAction: {
          source: "json_render_action",
          sourceMessageId: SOURCE_MESSAGE_ID,
          partId: fixture.id,
          actionId: "approve-task",
          actionKind: "approve",
          actionLabel: "Approve",
          target: "work_item_status",
          workItemId: WORK_ITEM_ID,
          statusCategory: "DONE",
          statusId: null,
          specHash: fixture.data.specHash,
          idempotencyKey: actionInput(fixture).idempotencyKey,
        },
      },
    });
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    const forwarded = mocks.sendMessage.mock.calls[0][1].input;
    expect(forwarded).toMatchObject({
      threadId: THREAD_ID,
      role: "USER",
      agentRequested: false,
      senderType: "user",
      senderId: USER_ID,
    });
    expect(forwarded.content).toContain("Generated UI action: Approve");
    const metadata = JSON.parse(forwarded.metadata).jsonRenderAction;
    expect(metadata).toMatchObject({
      source: "json_render_action",
      sourceMessageId: SOURCE_MESSAGE_ID,
      partId: fixture.id,
      actionId: "approve-task",
      actionKind: "approve",
      specHash: fixture.data.specHash,
      idempotencyKey: actionInput(fixture).idempotencyKey,
      mutation: {
        target: "work_item_status",
        workItemId: WORK_ITEM_ID,
        statusCategory: "done",
        statusId: STATUS_DONE_ID,
        previousStatusCategory: "active",
        alreadyApplied: false,
      },
    });
  });

  it("dispatches result.list item actions through the persisted source-part boundary", async () => {
    const fixture =
      createResultListJsonRenderFixture() as unknown as ThreadJsonRenderPart;
    enqueueHappySource(fixture);
    mocks.selectQueue.push([]); // duplicate lookup
    mocks.selectQueue.push([]); // prior work item event lookup
    mocks.selectQueue.push([{ count: 0 }]); // rate limit

    const result = await handleJsonRenderAction(
      {},
      { input: actionInput(fixture) },
      ctx,
    );

    expect(result.id).toBe("message-action-1");
    expect(mocks.setWorkItemStatus).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      workItemId: WORK_ITEM_ID,
      threadId: THREAD_ID,
      statusCategory: "DONE",
      statusId: null,
      note: null,
      actor: { type: "user", id: USER_ID },
      metadata: {
        jsonRenderAction: {
          source: "json_render_action",
          sourceMessageId: SOURCE_MESSAGE_ID,
          partId: fixture.id,
          actionId: "complete-work-item",
          actionKind: "submit",
          actionLabel: "Complete",
          target: "work_item_status",
          workItemId: WORK_ITEM_ID,
          statusCategory: "DONE",
          statusId: null,
          specHash: fixture.data.specHash,
          idempotencyKey: actionInput(fixture).idempotencyKey,
        },
      },
    });
    const forwarded = mocks.sendMessage.mock.calls[0][1].input;
    expect(forwarded.content).toContain("Generated UI action: Complete");
    expect(forwarded.content).toContain("Source: Agent handoff");
    expect(JSON.parse(forwarded.metadata).jsonRenderAction).toMatchObject({
      actionId: "complete-work-item",
      actionKind: "submit",
      actionLabel: "Complete",
      partId: "json-render:result-list:handoff",
      mutation: {
        target: "work_item_status",
        workItemId: WORK_ITEM_ID,
        statusCategory: "done",
        statusId: STATUS_DONE_ID,
        alreadyApplied: false,
      },
    });
  });

  it("creates a new Work Item from a source-bound result.list action and assigns it to the caller", async () => {
    const fixture = createWorkItemSourcePart();
    enqueueHappySource(fixture);
    mocks.selectQueue.push([]); // duplicate lookup
    mocks.selectQueue.push([]); // prior create event lookup
    mocks.selectQueue.push([{ count: 0 }]); // rate limit

    const result = await handleJsonRenderAction(
      {},
      { input: actionInput(fixture) },
      ctx,
    );

    expect(result.id).toBe("message-action-1");
    expect(mocks.setWorkItemStatus).not.toHaveBeenCalled();
    expect(mocks.createWorkItemRow).toHaveBeenCalledTimes(1);
    expect(mocks.createWorkItemRow).toHaveBeenCalledWith(ctx, {
      tenantId: TENANT_ID,
      spaceId: SPACE_ID,
      threadId: THREAD_ID,
      title: "Draft QA checklist",
      notes: "Create the checklist from the generated UI confirmation.",
      priority: "high",
      dueAt: null,
      ownerUserId: USER_ID,
      metadata: {
        jsonRenderAction: {
          source: "json_render_action",
          sourceMessageId: SOURCE_MESSAGE_ID,
          partId: fixture.id,
          actionId: "create-qa-checklist",
          actionKind: "submit",
          actionLabel: "Create Work Item",
          target: "work_item_create",
          title: "Draft QA checklist",
          threadSpaceId: SPACE_ID,
          specHash: fixture.data.specHash,
          idempotencyKey: actionInput(fixture).idempotencyKey,
        },
      },
    });
    const forwarded = mocks.sendMessage.mock.calls[0][1].input;
    expect(forwarded.content).toContain(
      "Generated UI action: Create Work Item",
    );
    expect(JSON.parse(forwarded.metadata).jsonRenderAction).toMatchObject({
      actionId: "create-qa-checklist",
      actionKind: "submit",
      target: "work_item_create",
      mutation: {
        target: "work_item_create",
        workItemId: "99999999-9999-9999-9999-999999999999",
        title: "Draft QA checklist",
        ownerUserId: USER_ID,
        alreadyApplied: false,
      },
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
        content: "Generated UI action: Approve",
        metadata: { jsonRenderAction: { idempotencyKey: "idem-1" } },
        created_at: new Date("2026-06-21T00:00:00Z"),
      },
    ]);

    const result = await handleJsonRenderAction(
      {},
      { input: actionInput(fixture) },
      ctx,
    );

    expect(result.id).toBe("message-existing");
    expect(mocks.setWorkItemStatus).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("repairs missing audit when the Work Item event already applied", async () => {
    const fixture = sourcePart();
    enqueueHappySource(fixture);
    mocks.selectQueue.push([]); // duplicate lookup
    mocks.selectQueue.push([
      {
        workItemId: WORK_ITEM_ID,
        newStatusId: STATUS_DONE_ID,
        metadata: {
          manualMetadata: {
            jsonRenderAction: {
              idempotencyKey: "idem-1",
              statusCategory: "DONE",
            },
          },
        },
        created_at: new Date("2026-06-21T00:00:00Z"),
      },
    ]);
    mocks.selectQueue.push([{ count: 12 }]); // would fail if repair were rate-limited

    await handleJsonRenderAction({}, { input: actionInput(fixture) }, ctx);

    expect(mocks.setWorkItemStatus).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    const forwarded = mocks.sendMessage.mock.calls[0][1].input;
    expect(JSON.parse(forwarded.metadata).jsonRenderAction.mutation).toMatchObject(
      {
        target: "work_item_status",
        workItemId: WORK_ITEM_ID,
        statusCategory: "DONE",
        statusId: STATUS_DONE_ID,
        alreadyApplied: true,
      },
    );
  });

  it("rejects stale action submissions with an old spec hash", async () => {
    const fixture = sourcePart();
    enqueueHappySource(fixture);

    await expect(
      handleJsonRenderAction(
        {},
        { input: { ...actionInput(fixture), specHash: "old" } },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects actions without the Work Item status target before mutation", async () => {
    const fixture = sourcePart({
      params: { workItemId: WORK_ITEM_ID, statusCategory: "DONE" },
    });
    enqueueHappySource(fixture);

    await expect(
      handleJsonRenderAction({}, { input: actionInput(fixture) }, ctx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mocks.setWorkItemStatus).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects Work Item status actions missing a status before mutation", async () => {
    const fixture = sourcePart({
      params: { target: "work_item_status", workItemId: WORK_ITEM_ID },
    });
    enqueueHappySource(fixture);

    await expect(
      handleJsonRenderAction({}, { input: actionInput(fixture) }, ctx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mocks.setWorkItemStatus).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects unknown action ids before dispatch", async () => {
    const fixture = sourcePart();
    enqueueHappySource(fixture);

    await expect(
      handleJsonRenderAction(
        {},
        { input: { ...actionInput(fixture), actionId: "unknown" } },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("maps Work Item status failures without writing a success audit", async () => {
    const fixture = sourcePart();
    enqueueHappySource(fixture);
    mocks.selectQueue.push([]); // duplicate lookup
    mocks.selectQueue.push([]); // prior work item event lookup
    mocks.selectQueue.push([{ count: 0 }]); // rate limit
    mocks.setWorkItemStatus.mockRejectedValue(
      new TaskStatusToolError(
        "Work item is not linked to this thread",
        403,
        "WORK_ITEM_THREAD_REQUIRED",
      ),
    );

    await expect(
      handleJsonRenderAction({}, { input: actionInput(fixture) }, ctx),
    ).rejects.toMatchObject({
      message: "Work item is not linked to this thread",
      extensions: { code: "WORK_ITEM_THREAD_REQUIRED", httpStatus: 403 },
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects submitted params that try to override host-owned context", async () => {
    const fixture = sourcePart();
    enqueueHappySource(fixture);

    await expect(
      handleJsonRenderAction(
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
    mocks.selectQueue.push([]); // prior work item event lookup
    mocks.selectQueue.push([{ count: 12 }]); // rate limit

    await expect(
      handleJsonRenderAction(
        {},
        { input: { ...actionInput(fixture), idempotencyKey: "idem-2" } },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "RATE_LIMITED" } });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});

function sourcePart(
  overrides: {
    params?: Record<string, string>;
    actionId?: string;
  } = {},
) {
  const actionId = overrides.actionId ?? "approve-task";
  const spec = {
    root: "review",
    elements: {
      review: {
        type: "task.review",
        props: {
          title: "Review onboarding task",
          summary: "Confirm the customer kickoff task is ready.",
          status: "pending",
          primaryActionId: actionId,
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
          id: actionId,
          label: "Approve",
          kind: "approve",
          params: overrides.params ?? {
            target: "work_item_status",
            workItemId: WORK_ITEM_ID,
            statusCategory: "DONE",
            note: "Approved from generated UI",
          },
        },
      ],
      specHash: createThreadJsonRenderSpecHash(spec),
    },
  } satisfies ThreadJsonRenderPart;
}

function enqueueHappySource(fixture: ThreadJsonRenderPart) {
  mocks.selectQueue.push([{ id: THREAD_ID, spaceId: SPACE_ID }]);
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

function createWorkItemSourcePart() {
  const spec = {
    root: "results",
    elements: {
      results: {
        type: "result.list",
        props: {
          title: "Work Item proposal",
          summary: "Create the proposed task if it looks right.",
          groups: [{ id: "reviews", title: "Approval and review queues" }],
          items: [
            {
              id: "review-create-1",
              variant: "review",
              groupId: "reviews",
              title: "Would you like to create this Work Item?",
              summary: "Draft QA checklist assigned to you.",
              statusLabel: "Needs confirmation",
              primaryActionId: "create-qa-checklist",
            },
          ],
        },
        children: [],
      },
    },
  };
  return {
    type: THREAD_JSON_RENDER_PART_TYPE,
    id: "json-render:result-list:create-work-item",
    data: {
      schemaVersion: THREAD_JSON_RENDER_SCHEMA_VERSION,
      catalogVersion: THREAD_JSON_RENDER_CATALOG_VERSION,
      status: "ready",
      spec,
      mobileFallback: {
        title: "Work Item proposal",
        summary: "Create the proposed task if it looks right.",
      },
      durableActions: [
        {
          id: "create-qa-checklist",
          label: "Create Work Item",
          kind: "submit",
          params: {
            target: "work_item_create",
            title: "Draft QA checklist",
            notes: "Create the checklist from the generated UI confirmation.",
            priority: "high",
            ownerUserId: "current_user",
          },
        },
      ],
      specHash: createThreadJsonRenderSpecHash(spec),
    },
  } satisfies ThreadJsonRenderPart;
}

function actionInput(fixture: ThreadJsonRenderPart) {
  return {
    threadId: THREAD_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    partId: fixture.id,
    actionId: fixture.data.durableActions![0].id,
    specHash: fixture.data.specHash!,
    idempotencyKey: "idem-1",
    params: fixture.data.durableActions![0].params,
  };
}
