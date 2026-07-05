import { describe, expect, it, vi } from "vitest";

vi.mock("@thinkwork/react-native-sdk", async () => {
  return await import("../../../../packages/react-native-sdk/src/send-message-options");
});

import {
  applyGoalIntent,
  cancelGoalIntent,
  emptyGoalIntentDraft,
  failGoalIntentSend,
  goalModeForDraft,
} from "../composer-goal-intent";
import { shouldRenderModelPicker } from "../composer-model-selection";
import { buildThreadConversationSendVariables } from "../thread-conversation-send";

describe("mobile composer model and Goal mode", () => {
  it("hides the model picker when the approved catalog is empty", () => {
    expect(shouldRenderModelPicker(undefined)).toBe(false);
    expect(shouldRenderModelPicker(null)).toBe(false);
    expect(shouldRenderModelPicker([])).toBe(false);
  });

  it("sends the selected model and applied Goal objective through send variables", () => {
    const goalMode = goalModeForDraft({
      doneLooksLike: "Ship the mobile composer parity update",
      notToDo: "Do not change GraphQL schema",
      checkInWhen: "Before running final verification",
    });

    expect(
      buildThreadConversationSendVariables({
        threadId: "thread-1",
        content: "Start the goal",
        currentUserId: "user-me",
        modelId: "anthropic.claude-sonnet",
        goalMode,
      }),
    ).toEqual({
      input: {
        threadId: "thread-1",
        role: "USER",
        content: "Start the goal",
        senderType: "user",
        senderId: "user-me",
        modelId: "anthropic.claude-sonnet",
        metadata: JSON.stringify({
          goalMode: {
            enabled: true,
            action: "start",
            objective:
              "Done: Ship the mobile composer parity update\nDon't: Do not change GraphQL schema\nCheck in: Before running final verification",
          },
        }),
      },
    });
  });

  it("turns Goal mode off when the intent card is canceled", () => {
    const applied = applyGoalIntent(
      { draft: emptyGoalIntentDraft, activeGoalMode: null },
      {
        doneLooksLike: "Done state",
        notToDo: "",
        checkInWhen: "",
      },
    );
    const canceled = cancelGoalIntent(applied);

    expect(canceled.activeGoalMode).toBeNull();
    expect(
      buildThreadConversationSendVariables({
        threadId: "thread-1",
        content: "No active goal",
        goalMode: canceled.activeGoalMode,
      }).input,
    ).not.toHaveProperty("metadata");
  });

  it("keeps prior card values available after canceling", () => {
    const applied = applyGoalIntent(
      { draft: emptyGoalIntentDraft, activeGoalMode: null },
      {
        doneLooksLike: "Keep this",
        notToDo: "Avoid that",
        checkInWhen: "At handoff",
      },
    );
    const canceled = cancelGoalIntent(applied);

    expect(canceled.draft).toEqual({
      doneLooksLike: "Keep this",
      notToDo: "Avoid that",
      checkInWhen: "At handoff",
    });
  });

  it("preserves filled Goal state after a failed send", () => {
    const applied = applyGoalIntent(
      { draft: emptyGoalIntentDraft, activeGoalMode: null },
      {
        doneLooksLike: "Retryable done state",
        notToDo: "",
        checkInWhen: "After failure",
      },
    );

    expect(failGoalIntentSend(applied)).toEqual(applied);
  });
});
