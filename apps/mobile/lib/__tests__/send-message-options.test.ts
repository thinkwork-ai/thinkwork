import { describe, expect, it } from "vitest";
import { ComposerCapabilities } from "../../../../packages/react-native-sdk/src/composer-capabilities";
import { buildSendMessageMutationVariables } from "../../../../packages/react-native-sdk/src/send-message-options";

describe("react-native-sdk send message options", () => {
  it("includes model, dispatch, agent, and Goal mode options in mutation variables", () => {
    const variables = buildSendMessageMutationVariables("thread-1", "Ship it", {
      senderId: "user-1",
      metadata: { source: "mobile" },
      modelId: "anthropic.claude-sonnet",
      agentRequested: true,
      dispatchMode: "ASYNC",
      goalMode: {
        enabled: true,
        action: "start",
        objective: "Finish mobile parity",
        goalRunId: "goal-run-1",
      },
    });

    expect(variables).toEqual({
      input: {
        threadId: "thread-1",
        role: "USER",
        content: "Ship it",
        senderType: "user",
        senderId: "user-1",
        metadata: JSON.stringify({
          source: "mobile",
          goalMode: {
            enabled: true,
            action: "start",
            objective: "Finish mobile parity",
            goalRunId: "goal-run-1",
          },
        }),
        modelId: "anthropic.claude-sonnet",
        agentRequested: true,
        dispatchMode: "ASYNC",
      },
    });
  });

  it("keeps no-option variables identical to the previous SDK contract", () => {
    expect(buildSendMessageMutationVariables("thread-1", "Hello")).toEqual({
      input: {
        threadId: "thread-1",
        role: "USER",
        content: "Hello",
        senderType: "user",
      },
    });
  });

  it("keeps sender-only variables identical to the previous SDK contract", () => {
    expect(
      buildSendMessageMutationVariables("thread-1", "Hello", {
        senderType: "operator",
      }),
    ).toEqual({
      input: {
        threadId: "thread-1",
        role: "USER",
        content: "Hello",
        senderType: "operator",
      },
    });
  });

  it("builds the same variables when a caller retries with the same options", () => {
    const opts = {
      metadata: { source: "retry-test" },
      modelId: "anthropic.claude-haiku",
      agentRequested: false,
      dispatchMode: "SYNC",
      goalMode: {
        enabled: true,
        action: "resume" as const,
        goalRunId: "goal-run-1",
      },
    } as const;

    const first = buildSendMessageMutationVariables("thread-1", "Retry", opts);
    const second = buildSendMessageMutationVariables("thread-1", "Retry", opts);

    expect(second).toEqual(first);
  });

  it("exports the mobile composer capability contract", () => {
    expect([...ComposerCapabilities].sort()).toEqual(
      [
        "attach",
        "agentToggle",
        "goalMode",
        "spaceSelector",
        "modelPicker",
        "voice",
        "mentions",
      ].sort(),
    );
  });
});
