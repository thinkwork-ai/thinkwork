import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCallerUserId: vi.fn(),
  requireAgentLoopAdmin: vi.fn(),
  saveAgentLoop: vi.fn(),
  updateSet: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ op: "eq", field, value })),
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            (table as { id?: string })?.id === "threadParticipants.id"
              ? [{ id: "participant-1" }]
              : [
                  {
                    id: "thread-1",
                    tenant_id: "tenant-1",
                    metadata: {
                      purpose: "automation_builder",
                      builderSessionId: "session-1",
                    },
                  },
                ],
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        mocks.updateSet(values);
        return { where: async () => [] };
      },
    }),
    insert: () => ({
      values: (values: unknown) => {
        mocks.insertValues(values);
        return {};
      },
    }),
  },
  messages: {},
  threadParticipants: {
    id: "threadParticipants.id",
    tenant_id: "threadParticipants.tenant_id",
    thread_id: "threadParticipants.thread_id",
    user_id: "threadParticipants.user_id",
  },
  threads: {
    id: "threads.id",
    tenant_id: "threads.tenant_id",
    metadata: "threads.metadata",
  },
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mocks.resolveCallerUserId,
}));

vi.mock("./types.js", () => ({
  parseAwsJsonObject: (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {},
  requireAgentLoopAdmin: mocks.requireAgentLoopAdmin,
}));

vi.mock("./saveAgentLoop.mutation.js", () => ({
  saveAgentLoop: mocks.saveAgentLoop,
}));

// eslint-disable-next-line import/first
import { confirmAutomationDraft } from "./confirmAutomationDraft.mutation.js";

beforeEach(() => {
  mocks.resolveCallerUserId.mockReset().mockResolvedValue("user-1");
  mocks.requireAgentLoopAdmin.mockReset().mockResolvedValue(undefined);
  mocks.saveAgentLoop.mockReset().mockResolvedValue({ id: "loop-1" });
  mocks.updateSet.mockReset();
  mocks.insertValues.mockReset();
});

describe("confirmAutomationDraft", () => {
  it("saves the Automation with the builder thread id and links the thread back", async () => {
    const saved = await confirmAutomationDraft(
      null,
      {
        input: {
          builderThreadId: "thread-1",
          input: {
            tenantId: "tenant-1",
            name: "Linear dispatcher",
            triggerSpec: {},
            goalSpec: {},
            workerSpec: {},
            judgeSpec: {},
            sourceMetadata: { prompt: "Route Linear issues." },
          },
        },
      },
      {} as any,
    );

    expect(saved).toEqual({ id: "loop-1" });
    expect(mocks.requireAgentLoopAdmin).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "confirm_automation_draft",
    );
    expect(mocks.resolveCallerUserId).toHaveBeenCalledWith(expect.anything());
    expect(mocks.saveAgentLoop).toHaveBeenCalledWith(
      null,
      {
        input: expect.objectContaining({
          sourceMetadata: expect.objectContaining({
            createdFrom: "settings.automations.chat",
            creationMode: "chat",
            builderThreadId: "thread-1",
            designerSkill: "automation-loop-designer",
          }),
        }),
      },
      expect.anything(),
    );
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          builderSessionId: "session-1",
          agentLoopId: "loop-1",
        }),
      }),
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_id: "thread-1",
        content: "Automation draft confirmed and saved.",
        metadata: expect.objectContaining({ agentLoopId: "loop-1" }),
      }),
    );
  });
});
