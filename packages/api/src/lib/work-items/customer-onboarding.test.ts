import { describe, expect, it } from "vitest";

import { workItemStatusCategoryForLinkedTaskStatus } from "./customer-onboarding.js";
import { linkedTaskStatusForWorkItemProgress } from "./progress.js";

describe("customer onboarding Work Item adapters", () => {
  it("maps legacy linked-task statuses to native Work Item status categories", () => {
    expect(workItemStatusCategoryForLinkedTaskStatus("todo")).toBe("todo");
    expect(workItemStatusCategoryForLinkedTaskStatus("in_progress")).toBe(
      "active",
    );
    expect(workItemStatusCategoryForLinkedTaskStatus("blocked")).toBe(
      "blocked",
    );
    expect(workItemStatusCategoryForLinkedTaskStatus("completed")).toBe("done");
    expect(workItemStatusCategoryForLinkedTaskStatus("not_applicable")).toBe(
      "skipped",
    );
    expect(workItemStatusCategoryForLinkedTaskStatus("cancelled")).toBe(
      "skipped",
    );
    expect(workItemStatusCategoryForLinkedTaskStatus("unknown")).toBe("todo");
  });

  it("maps native Work Item state back to progress statuses", () => {
    expect(linkedTaskStatusForWorkItemProgress("todo", true)).toBe("todo");
    expect(linkedTaskStatusForWorkItemProgress("active", true)).toBe(
      "in_progress",
    );
    expect(linkedTaskStatusForWorkItemProgress("blocked", true)).toBe(
      "blocked",
    );
    expect(linkedTaskStatusForWorkItemProgress("done", true)).toBe("completed");
    expect(linkedTaskStatusForWorkItemProgress("skipped", true)).toBe(
      "not_applicable",
    );
    expect(linkedTaskStatusForWorkItemProgress("done", false)).toBe(
      "not_applicable",
    );
  });
});
