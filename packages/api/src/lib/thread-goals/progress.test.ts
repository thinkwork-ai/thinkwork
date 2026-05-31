import { describe, expect, it } from "vitest";

import {
  deriveThreadGoalTaskProgress,
  renderThreadGoalProgressMarkdown,
} from "./progress.js";

describe("thread Goal progress", () => {
  it("derives required-task progress for a non-template Goal", () => {
    const progress = deriveThreadGoalTaskProgress([
      task("completed"),
      task("completed"),
      task("completed"),
      task("todo"),
      task("blocked"),
      task("in_progress"),
      task("not_applicable"),
    ]);

    expect(progress).toEqual({
      completedRequired: 3,
      totalRequired: 6,
      remainingRequired: 3,
      percent: 50,
      readyForReview: false,
      noRequiredTasks: false,
      status: "active",
    });
  });

  it("moves to review only when required applicable tasks are complete", () => {
    expect(
      deriveThreadGoalTaskProgress([
        task("completed"),
        task("completed"),
        task("not_applicable"),
      ]),
    ).toMatchObject({
      completedRequired: 2,
      totalRequired: 2,
      readyForReview: true,
      status: "in_review",
    });
  });

  it("does not complete zero-required Goals", () => {
    expect(
      deriveThreadGoalTaskProgress([
        task("not_applicable"),
        task("not_applicable"),
      ]),
    ).toEqual({
      completedRequired: 0,
      totalRequired: 0,
      remainingRequired: 0,
      percent: 0,
      readyForReview: false,
      noRequiredTasks: true,
      status: "active",
    });
  });

  it("renders a template-agnostic progress file", () => {
    const markdown = renderThreadGoalProgressMarkdown({
      threadTitle: "Renewal prep",
      goalTitle: "Prepare ACME renewal",
      updatedAt: new Date("2026-05-31T18:00:00.000Z"),
      tasks: [
        {
          title: "Collect usage report",
          status: "completed",
          required: true,
          blocked: false,
          owner: "CSM",
        },
        {
          title: "Draft proposal",
          status: "todo",
          required: true,
          blocked: true,
          notes: "Waiting on pricing.",
          roleKey: "sales",
        },
      ],
    });

    expect(markdown).toContain("Goal: Prepare ACME renewal");
    expect(markdown).toContain("Status: Waiting on 1 required task.");
    expect(markdown).toContain("- Required complete: 1/2");
    expect(markdown).toContain("- Overall: 50%");
    expect(markdown).toContain(
      "| Draft proposal | Todo | Sales | Yes | Waiting on pricing. |",
    );
  });
});

function task(status: string) {
  return { required: true, status };
}
