import { describe, expect, it } from "vitest";
import {
  markDefaultAgentTarget,
  resolveDefaultAgentIdForMentionTargets,
  type ThreadMentionTarget,
} from "./thread-mention-targets.js";

describe("thread mention target default-agent helpers", () => {
  it("uses the same default-agent priority as default dispatch", () => {
    expect(
      resolveDefaultAgentIdForMentionTargets({
        threadAgentId: "thread-agent",
        platformAgentId: "platform-agent",
        subscribedAgentParticipantId: "participant-agent",
      }),
    ).toBe("thread-agent");

    expect(
      resolveDefaultAgentIdForMentionTargets({
        platformAgentId: "platform-agent",
        subscribedAgentParticipantId: "participant-agent",
      }),
    ).toBe("platform-agent");

    expect(
      resolveDefaultAgentIdForMentionTargets({
        subscribedAgentParticipantId: "participant-agent",
      }),
    ).toBe("participant-agent");
  });

  it("does not expose a default-agent alias target for Computer-owned threads", () => {
    expect(
      resolveDefaultAgentIdForMentionTargets({
        computerId: "computer-1",
        threadAgentId: "thread-agent",
        platformAgentId: "platform-agent",
        subscribedAgentParticipantId: "participant-agent",
      }),
    ).toBeNull();
  });

  it("marks the resolved default agent and merges reserved aliases", () => {
    const targets = new Map<string, ThreadMentionTarget>([
      [
        "agent:agent-1",
        {
          id: "agent:agent-1",
          targetType: "agent",
          targetId: "agent-1",
          displayName: "Coordinator",
          aliases: ["Coordinator", "coord", "agent"],
        },
      ],
    ]);

    markDefaultAgentTarget(targets, "agent-1");

    expect(targets.get("agent:agent-1")).toMatchObject({
      isDefaultAgent: true,
      aliases: ["agent", "think", "Coordinator", "coord"],
    });
  });
});
