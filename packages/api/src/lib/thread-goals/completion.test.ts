import { describe, expect, it, vi } from "vitest";

import {
  finalizeCompletedThreadGoal,
  withGoalCompletionMetadata,
} from "./completion.js";

describe("thread Goal completion helpers", () => {
  it("records completion metadata without losing existing review metadata", () => {
    const metadata = withGoalCompletionMetadata({
      current: {
        review: {
          action: "CONFIRM_COMPLETION",
          reviewedByUserId: "user-1",
        },
      },
      completedAt: new Date("2026-05-27T15:00:00.000Z"),
      completedByUserId: "user-1",
    });

    expect(metadata).toMatchObject({
      review: {
        action: "CONFIRM_COMPLETION",
        reviewedByUserId: "user-1",
      },
      completion: {
        completedAt: "2026-05-27T15:00:00.000Z",
        completedByUserId: "user-1",
        source: "goal_review",
        brainCandidate: {
          sourceType: "completed_goal_folder",
          status: "pending_eligibility",
        },
      },
    });
  });

  it("finalizes the rendered Goal folder with completed status", async () => {
    const refreshGoalFolder = vi.fn(async () => [{ key: "GOAL.md", bytes: 1 }]);

    await expect(
      finalizeCompletedThreadGoal(
        { tenantId: "tenant-1", threadId: "thread-1" },
        { refreshGoalFolder },
      ),
    ).resolves.toEqual([{ key: "GOAL.md", bytes: 1 }]);

    expect(refreshGoalFolder).toHaveBeenCalledWith(
      { tenantId: "tenant-1", threadId: "thread-1" },
      { goalStatus: "completed" },
    );
  });
});
