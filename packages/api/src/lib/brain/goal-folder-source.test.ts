import { describe, expect, it } from "vitest";

import {
  completedGoalFolderToBrainCandidate,
  evaluateCompletedGoalFolderEligibility,
  type CompletedGoalFolderRecord,
} from "./goal-folder-source.js";

const completedGoal: CompletedGoalFolderRecord = {
  id: "goal-1",
  tenantId: "tenant-1",
  threadId: "thread-1",
  templateKey: "customer_onboarding",
  outcome: "Complete customer onboarding for Acme.",
  status: "completed",
  reviewPolicy: { required: true, type: "human_final_review" },
  metadata: {
    review: { action: "CONFIRM_COMPLETION", reviewedByUserId: "user-1" },
  },
  completedAt: new Date("2026-05-27T15:00:00.000Z"),
};

describe("completed Goal folder Brain source", () => {
  it("turns a reviewed completed Goal folder into a cited Brain candidate", () => {
    const result = completedGoalFolderToBrainCandidate({
      goal: completedGoal,
      files: {
        goal: "# GOAL\nOutcome: Complete customer onboarding for Acme.",
        progress: "# PROGRESS\n- Required complete: 7/7",
        decisions: "# DECISIONS\n- Credit terms requested: yes (Net 30).",
        handoffs:
          "# HANDOFFS\n- Human reviewer: confirm final onboarding review.",
        artifacts: "# ARTIFACTS\n- Contract link: https://example.com/doc",
      },
    });

    expect(result.eligibility).toEqual({ eligible: true, reasons: [] });
    expect(result.candidate).toMatchObject({
      title: "Complete customer onboarding for Acme.",
      sourceFamily: "BRAIN",
      providerId: "goal-folder",
      citation: {
        label: "Completed Goal folder",
        sourceId: "goal-1",
        metadata: {
          sourceType: "completed_goal_folder",
          tenantId: "tenant-1",
          threadId: "thread-1",
          templateKey: "customer_onboarding",
          completedAt: "2026-05-27T15:00:00.000Z",
        },
      },
    });
    expect(result.candidate?.summary).toContain("Credit terms requested: yes");
    expect(result.candidate?.summary).toContain("Contract link");
  });

  it("does not require artifacts when decisions or handoffs carry the source", () => {
    const result = completedGoalFolderToBrainCandidate({
      goal: completedGoal,
      files: {
        goal: "# GOAL\nOutcome: Complete customer onboarding for Acme.",
        progress: "# PROGRESS\n- Required complete: 7/7",
        decisions: "# DECISIONS\n- Tax exempt: no.",
        handoffs: "# HANDOFFS\n- None.",
        artifacts: "# ARTIFACTS\n- None captured yet.",
      },
    });

    expect(result.eligibility.eligible).toBe(true);
    expect(result.candidate?.summary).toContain("Tax exempt: no.");
  });

  it("keeps incomplete or weak Goal folders out of Brain candidates", () => {
    const eligibility = evaluateCompletedGoalFolderEligibility({
      goal: {
        ...completedGoal,
        status: "active",
        metadata: {},
      },
      files: {
        goal: "# GOAL",
        progress: "# PROGRESS",
        decisions: "# DECISIONS\n- None captured yet.",
        handoffs: "# HANDOFFS\n- None.",
        artifacts: "# ARTIFACTS\n- None.",
      },
    });

    expect(eligibility).toEqual({
      eligible: false,
      reasons: [
        "goal_not_completed",
        "completion_not_reviewed_or_declared_no_review",
        "no_decisions_handoffs_or_artifacts",
      ],
    });
  });
});
