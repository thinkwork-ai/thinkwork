import { describe, expect, it } from "vitest";
import {
  deriveThreadAgentDefault,
  deriveThreadAgentMode,
} from "./thread-agent-mode";

const me = "user-me";

describe("deriveThreadAgentMode", () => {
  it("is single-player with only the current user's messages", () => {
    expect(
      deriveThreadAgentMode({
        currentUserId: me,
        messages: [{ role: "USER", senderId: me, senderType: "human" }],
      }),
    ).toBe("single");
  });

  it("is multi-player when another human has posted", () => {
    expect(
      deriveThreadAgentMode({
        currentUserId: me,
        messages: [
          { role: "USER", senderId: me, senderType: "human" },
          { role: "USER", senderId: "user-scott", senderType: "human" },
        ],
      }),
    ).toBe("multi");
  });

  it("is multi-player when the draft mentions another user", () => {
    expect(
      deriveThreadAgentMode({
        currentUserId: me,
        draftMentions: [{ targetType: "USER", targetId: "user-scott" }],
      }),
    ).toBe("multi");
  });

  it("uses sender metadata when available", () => {
    expect(
      deriveThreadAgentMode({
        currentUserId: me,
        messages: [
          {
            role: "USER",
            senderType: "human",
            sender: { type: "user", id: "user-scott" },
          },
        ],
      }),
    ).toBe("multi");
  });

  it("ignores assistant and agent-authored messages", () => {
    expect(
      deriveThreadAgentMode({
        currentUserId: me,
        messages: [
          { role: "USER", senderId: me, senderType: "human" },
          { role: "ASSISTANT", senderId: "agent-1", senderType: "agent" },
          { role: "USER", senderId: "agent-1", senderType: "agent" },
        ],
        draftMentions: [{ targetType: "AGENT", targetId: "agent-1" }],
      }),
    ).toBe("single");
  });

  it("skips sender-based detection when the current user is unknown", () => {
    expect(
      deriveThreadAgentMode({
        currentUserId: null,
        messages: [
          { role: "USER", senderId: "user-scott", senderType: "human" },
        ],
      }),
    ).toBe("single");
  });
});

describe("deriveThreadAgentDefault", () => {
  it("defaults the agent on in single-player threads", () => {
    expect(
      deriveThreadAgentDefault({
        currentUserId: me,
        messages: [{ role: "USER", senderId: me, senderType: "human" }],
      }).agentDefaultOn,
    ).toBe(true);
  });

  it("defaults the agent off in multi-player threads", () => {
    expect(
      deriveThreadAgentDefault({
        currentUserId: me,
        messages: [
          { role: "USER", senderId: "user-scott", senderType: "human" },
        ],
      }).agentDefaultOn,
    ).toBe(false);
  });
});
