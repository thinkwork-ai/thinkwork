import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const invokeJobScheduleManagerMock = vi.hoisted(() => vi.fn());

vi.mock("@thinkwork/database-pg", () => ({
  getDb: getDbMock,
}));

vi.mock("../../graphql/utils.js", () => ({
  invokeJobScheduleManager: invokeJobScheduleManagerMock,
}));

import {
  eventBridgeAtExpression,
  recordThreadActivityForIdleLearning,
} from "./activity.js";

describe("thread idle-learning activity helper", () => {
  beforeEach(() => {
    delete process.env.REQUESTER_IDLE_MEMORY_LEARNING_ENABLED;
    getDbMock.mockReset();
    invokeJobScheduleManagerMock.mockReset();
  });

  it("formats EventBridge Scheduler at() expressions without milliseconds", () => {
    expect(eventBridgeAtExpression(new Date("2026-05-18T17:15:30.123Z"))).toBe(
      "at(2026-05-18T17:15:30)",
    );
  });

  it("records activity when requester idle memory learning is not explicitly disabled", async () => {
    const executeMock = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: "state-1", activity_sequence: 1 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "job-1" }],
      });
    const updateWhereMock = vi.fn().mockResolvedValue(undefined);
    const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
    getDbMock.mockReturnValue({
      execute: executeMock,
      update: vi.fn(() => ({ set: updateSetMock })),
    });
    invokeJobScheduleManagerMock.mockResolvedValue({ ok: true });

    const result = await recordThreadActivityForIdleLearning({
      tenantId: "00000000-0000-0000-0000-000000000001",
      threadId: "00000000-0000-0000-0000-000000000002",
      computerId: "00000000-0000-0000-0000-000000000003",
      requesterUserId: "00000000-0000-0000-0000-000000000004",
      source: "user_message",
      occurredAt: new Date("2026-05-18T17:00:00Z"),
    });

    expect(result).toMatchObject({
      ok: true,
      stateId: "state-1",
      scheduledJobId: "job-1",
      activitySequence: 1,
    });
    expect(invokeJobScheduleManagerMock).toHaveBeenCalledWith(
      "PUT",
      expect.objectContaining({
        triggerId: "job-1",
        scheduleExpression: "at(2026-05-18T17:15:00)",
      }),
    );
  });

  it("is inert when requester idle memory learning is explicitly disabled", async () => {
    process.env.REQUESTER_IDLE_MEMORY_LEARNING_ENABLED = "false";

    const result = await recordThreadActivityForIdleLearning({
      tenantId: "tenant-1",
      threadId: "thread-1",
      computerId: "computer-1",
      requesterUserId: "user-1",
      source: "user_message",
    });

    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: "feature_disabled",
    });
    expect(getDbMock).not.toHaveBeenCalled();
    expect(invokeJobScheduleManagerMock).not.toHaveBeenCalled();
  });
});
