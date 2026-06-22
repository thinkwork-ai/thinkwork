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
  it("maps direct chat goalMode into AgentCore goal_mode", () => {
    expect(chatAgentInvokeSource).toContain("goalMode?: RuntimeGoalMode");
    expect(chatAgentInvokeSource).toContain("toRuntimeGoalModePayload");
    expect(chatAgentInvokeSource).toContain("goal_mode: event.goalMode");
  });

  it("maps fallback chat-message wakeups into AgentCore goal_mode", () => {
    expect(wakeupProcessorSource).toContain("toRuntimeGoalModePayload");
    expect(wakeupProcessorSource).toContain(
      'wakeup.source === "chat_message" && payload?.goalMode',
    );
    expect(wakeupProcessorSource).toContain(
      "goal_mode: toRuntimeGoalModePayload",
    );
  });

  it("keeps AgentLoop wakeups visible instead of converting them to Pi goal mode", () => {
    expect(wakeupProcessorSource).toContain('wakeup.source === "agent_loop"');
    expect(wakeupProcessorSource).not.toContain(
      'wakeup.source === "chat_message" || wakeup.source === "agent_loop"',
    );
  });
});
