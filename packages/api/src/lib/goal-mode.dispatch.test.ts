import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chatAgentInvokeSource = readFileSync(
  new URL("../handlers/chat-agent-invoke.ts", import.meta.url),
  "utf8",
);
const wakeupProcessorSource = readFileSync(
  new URL("../handlers/wakeup-processor.ts", import.meta.url),
  "utf8",
);

describe("goal mode dispatch payload boundary", () => {
  // THINK-597: the composer Goal surface is gone. Chat sends no longer carry a
  // goalMode intent, so the chat dispatch path must not reintroduce one.
  it("keeps chat dispatch free of composer goal-mode plumbing", () => {
    expect(chatAgentInvokeSource).not.toContain("goalMode");
    expect(chatAgentInvokeSource).not.toContain("goal_mode");
    expect(wakeupProcessorSource).not.toContain(
      'wakeup.source === "chat_message" && payload?.goalMode',
    );
  });

  it("maps AgentLoop wakeups into AgentCore goal_mode", () => {
    expect(wakeupProcessorSource).toContain('wakeup.source === "agent_loop"');
    expect(wakeupProcessorSource).toContain(
      "goal_mode: toRuntimeGoalModePayload(agentLoopPayload.goalMode)",
    );
  });

  it("maps workflow_step wakeups into AgentCore goal_mode", () => {
    expect(wakeupProcessorSource).toContain(
      'wakeup.source === "workflow_step"',
    );
    expect(wakeupProcessorSource).toContain(
      "goal_mode: toRuntimeGoalModePayload",
    );
  });

  it("resumes a paused goal across the user-question card boundary", () => {
    expect(wakeupProcessorSource).toContain("goalModeFromQuestionSourceTurn");
    expect(wakeupProcessorSource).toContain(
      "goal_mode: toRuntimeGoalModePayload(resumedGoal)",
    );
  });
});
