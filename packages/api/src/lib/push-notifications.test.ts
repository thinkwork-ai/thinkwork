import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetDb, dbRows } = vi.hoisted(() => ({
  dbRows: [] as unknown[][],
  mockGetDb: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: mockGetDb,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agents: {
    id: "agents.id",
    human_pair_id: "agents.human_pair_id",
  },
  users: {
    id: "users.id",
    email: "users.email",
    expo_push_token: "users.expo_push_token",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((field, value) => ({ field, value })),
}));

function createDb() {
  const chain: any = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(async () => dbRows.shift() ?? []),
  };
  return {
    select: vi.fn(() => chain),
  };
}

async function sentMessages() {
  const calls = vi.mocked(fetch).mock.calls;
  const body = calls.at(-1)?.[1]?.body;
  expect(typeof body).toBe("string");
  return JSON.parse(body as string);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbRows.length = 0;
  mockGetDb.mockReturnValue(createDb());
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status: 200,
      json: async () => ({ data: [{ status: "ok" }] }),
    })),
  );
});

describe("push notification payloads", () => {
  it("builds computer approval pushes with code tier, sound, and action category", async () => {
    const { buildComputerApprovalPushMessage } = await import(
      "./push-notifications.js"
    );

    expect(
      buildComputerApprovalPushMessage({
        token: "ExponentPushToken[approval]",
        approvalId: "approval-1",
        question: "Approve the browser action?",
      }),
    ).toMatchObject({
      to: "ExponentPushToken[approval]",
      sound: "default",
      categoryId: "computer_approval_actions",
      data: {
        type: "computer_approval",
        approvalId: "approval-1",
        tier: "code",
      },
    });
  });

  it("sends external task pushes with page tier and sound", async () => {
    const { sendExternalTaskPush } = await import("./push-notifications.js");
    dbRows.push([
      {
        id: "user-1",
        email: "eric@example.com",
        token: "ExponentPushToken[external]",
      },
    ]);

    await sendExternalTaskPush({
      userId: "user-1",
      tenantId: "tenant-1",
      threadId: "thread-1",
      title: "Task assigned",
      body: "Review the task",
      eventKind: "assigned",
    });

    expect(await sentMessages()).toEqual([
      expect.objectContaining({
        sound: "default",
        data: expect.objectContaining({
          type: "external_task_event",
          tier: "page",
        }),
      }),
    ]);
  });

  it("sends work item pushes with page tier and sound", async () => {
    const { sendWorkItemPush } = await import("./push-notifications.js");
    dbRows.push([
      {
        id: "user-1",
        email: "eric@example.com",
        token: "ExponentPushToken[workitem]",
      },
    ]);

    await sendWorkItemPush({
      userId: "user-1",
      tenantId: "tenant-1",
      workItemId: "work-item-1",
      kind: "assigned",
      title: "Work item assigned",
      body: "Collect documents",
    });

    expect(await sentMessages()).toEqual([
      expect.objectContaining({
        sound: "default",
        data: {
          type: "work_item_event",
          workItemId: "work-item-1",
          kind: "assigned",
          tier: "page",
        },
      }),
    ]);
  });

  it("omits sound on chart-tier turn completed pushes", async () => {
    const { sendTurnCompletedPush } = await import("./push-notifications.js");
    dbRows.push([
      {
        id: "user-1",
        email: "eric@example.com",
        token: "ExponentPushToken[turn]",
      },
    ]);

    await sendTurnCompletedPush({
      userId: "user-1",
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      title: "Turn complete",
      body: "The agent finished.",
    } as any);

    const [message] = await sentMessages();
    expect("sound" in message).toBe(false);
    expect(message.data).toMatchObject({
      type: "turn_completed",
      tier: "chart",
    });
  });

  it("swallows fetch failures for work item pushes", async () => {
    const { sendWorkItemPush } = await import("./push-notifications.js");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("expo down"));
    dbRows.push([
      {
        id: "user-1",
        email: "eric@example.com",
        token: "ExponentPushToken[workitem]",
      },
    ]);

    await expect(
      sendWorkItemPush({
        userId: "user-1",
        tenantId: "tenant-1",
        workItemId: "work-item-1",
        kind: "blocked",
        title: "Work item blocked",
        body: "Collect documents is blocked.",
      }),
    ).resolves.toBeUndefined();
  });
});
