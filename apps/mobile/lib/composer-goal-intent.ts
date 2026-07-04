import type { SendMessageGoalMode } from "../../../packages/react-native-sdk/src/send-message-options";

export interface GoalIntentDraft {
  doneLooksLike: string;
  notToDo: string;
  checkInWhen: string;
}

export interface GoalIntentState {
  draft: GoalIntentDraft;
  activeGoalMode: SendMessageGoalMode | null;
}

export const emptyGoalIntentDraft: GoalIntentDraft = {
  doneLooksLike: "",
  notToDo: "",
  checkInWhen: "",
};

export function composeGoalObjective(draft: GoalIntentDraft) {
  const sections = [
    ["Done", draft.doneLooksLike],
    ["Don't", draft.notToDo],
    ["Check in", draft.checkInWhen],
  ] as const;

  return sections
    .map(([label, value]) => [label, value.trim()] as const)
    .filter(([, value]) => value.length > 0)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

export function goalModeForDraft(
  draft: GoalIntentDraft,
): SendMessageGoalMode | null {
  const objective = composeGoalObjective(draft);
  if (!objective) return null;
  return {
    enabled: true,
    action: "start",
    objective,
  };
}

export function applyGoalIntent(
  state: GoalIntentState,
  draft: GoalIntentDraft,
): GoalIntentState {
  return {
    draft,
    activeGoalMode: goalModeForDraft(draft),
  };
}

export function cancelGoalIntent(state: GoalIntentState): GoalIntentState {
  return {
    ...state,
    activeGoalMode: null,
  };
}

export function clearGoalIntent(): GoalIntentState {
  return {
    draft: emptyGoalIntentDraft,
    activeGoalMode: null,
  };
}

export function completeGoalIntentSend(state: GoalIntentState): GoalIntentState {
  return state.activeGoalMode ? clearGoalIntent() : state;
}

export function failGoalIntentSend(state: GoalIntentState): GoalIntentState {
  return state;
}
