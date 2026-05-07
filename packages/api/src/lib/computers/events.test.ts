import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({}),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  computers: {},
  computerEvents: {},
}));

import {
  normalizeComputerEventLimit,
  toGraphqlComputerEvent,
} from "./events.js";

describe("computer events helpers", () => {
  it("bounds event query limits", () => {
    expect(normalizeComputerEventLimit()).toBe(25);
    expect(normalizeComputerEventLimit(null)).toBe(25);
    expect(normalizeComputerEventLimit(0)).toBe(1);
    expect(normalizeComputerEventLimit(7.8)).toBe(7);
    expect(normalizeComputerEventLimit(500)).toBe(100);
  });

  it("maps database rows to GraphQL event shape", () => {
    const createdAt = new Date("2026-05-07T01:00:00Z");

    expect(
      toGraphqlComputerEvent({
        id: "event-1",
        tenant_id: "tenant-1",
        computer_id: "computer-1",
        task_id: "task-1",
        event_type: "computer_task_completed",
        level: "warn",
        payload: { ok: true },
        created_at: createdAt,
      }),
    ).toEqual({
      id: "event-1",
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
      eventType: "computer_task_completed",
      level: "WARN",
      payload: { ok: true },
      createdAt,
    });
  });
});
