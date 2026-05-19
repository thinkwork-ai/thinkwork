import { describe, expect, it } from "vitest";
import {
  countRequiredTasks,
  normalizeExternalTaskStatus,
  requiredTasksComplete,
} from "./status.js";

describe("linked task status helpers", () => {
  it("normalizes known provider completion statuses", () => {
    expect(normalizeExternalTaskStatus("COMPLETED")).toEqual({
      status: "completed",
      blocked: false,
      syncStatus: "synced",
    });
    expect(normalizeExternalTaskStatus("done")).toEqual({
      status: "completed",
      blocked: false,
      syncStatus: "synced",
    });
  });

  it("normalizes blocked states without treating them as complete", () => {
    expect(normalizeExternalTaskStatus("on hold")).toEqual({
      status: "blocked",
      blocked: true,
      syncStatus: "synced",
    });
  });

  it("maps unknown provider statuses to UNKNOWN with a sync warning", () => {
    expect(normalizeExternalTaskStatus("waiting-on-mars")).toEqual({
      status: "unknown",
      blocked: false,
      syncStatus: "warning",
    });
    expect(normalizeExternalTaskStatus(null)).toEqual({
      status: "unknown",
      blocked: false,
      syncStatus: "warning",
    });
  });

  it("only requires required tasks for completion detection", () => {
    expect(
      requiredTasksComplete([
        { required: true, status: "completed" },
        { required: false, status: "todo" },
      ]),
    ).toBe(true);
    expect(
      requiredTasksComplete([
        { required: true, status: "completed" },
        { required: true, status: "blocked" },
      ]),
    ).toBe(false);
    expect(requiredTasksComplete([{ required: false, status: "todo" }])).toBe(
      false,
    );
  });

  it("counts required task completion for checklist progress", () => {
    expect(
      countRequiredTasks([
        { required: true, status: "completed" },
        { required: true, status: "todo" },
        { required: false, status: "completed" },
      ]),
    ).toEqual({ required: 2, completed: 1 });
  });
});
