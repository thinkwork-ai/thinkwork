import { refreshCustomerOnboardingGoalFolderSafely } from "../spaces/customer-onboarding-goal-md.js";

export interface GoalCompletionMetadataInput {
  current: unknown;
  completedAt: Date;
  completedByUserId: string;
}

export function withGoalCompletionMetadata(
  input: GoalCompletionMetadataInput,
): Record<string, unknown> {
  const base =
    input.current &&
    typeof input.current === "object" &&
    !Array.isArray(input.current)
      ? (input.current as Record<string, unknown>)
      : {};

  return compactObject({
    ...base,
    completion: compactObject({
      completedAt: input.completedAt.toISOString(),
      completedByUserId: input.completedByUserId,
      source: "goal_review",
      brainCandidate: compactObject({
        sourceType: "completed_goal_folder",
        status: "pending_eligibility",
      }),
    }),
  });
}

export async function finalizeCompletedThreadGoal(
  input: { tenantId: string; threadId: string },
  deps: {
    refreshGoalFolder?: typeof refreshCustomerOnboardingGoalFolderSafely;
  } = {},
) {
  const refreshGoalFolder =
    deps.refreshGoalFolder ?? refreshCustomerOnboardingGoalFolderSafely;
  return refreshGoalFolder(input, { goalStatus: "completed" });
}

function compactObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}
