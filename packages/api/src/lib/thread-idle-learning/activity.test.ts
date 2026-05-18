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

  it("is inert unless requester idle memory learning is explicitly enabled", async () => {
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
