import { describe, expect, it } from "vitest";
import { deriveAgentDefault, deriveAgentMode } from "./agent-mode";

const me = "user-me";

describe("deriveAgentMode", () => {
  it("is single-player with no other humans", () => {
    expect(
      deriveAgentMode({
        currentUserId: me,
        threadMessages: [{ role: "USER", senderId: me, senderType: "user" }],
        draftMentions: [],
      }),
    ).toBe("single");
  });

  it("is multi-player when the current draft mentions another user", () => {
    expect(
      deriveAgentMode({
        currentUserId: me,
        threadMessages: [],
        draftMentions: [{ targetType: "USER", targetId: "user-scott" }],
      }),
    ).toBe("multi");
  });

  it("is multi-player when another human has posted (not mentioned)", () => {
    // The OQ1 footgun: a participant who posts without being @mentioned.
    expect(
      deriveAgentMode({
        currentUserId: me,
        threadMessages: [
          { role: "USER", senderId: me, senderType: "user" },
          { role: "USER", senderId: "user-scott", senderType: "user" },
        ],
        draftMentions: [],
      }),
    ).toBe("multi");
  });

  it("agent mentions never trigger multi-player", () => {
    expect(
      deriveAgentMode({
        currentUserId: me,
        threadMessages: [{ role: "USER", senderId: me, senderType: "user" }],
        draftMentions: [{ targetType: "AGENT", targetId: "agent-1" }],
      }),
    ).toBe("single");
  });

  it("the current user mentioning themselves stays single-player", () => {
    expect(
      deriveAgentMode({
        currentUserId: me,
        draftMentions: [{ targetType: "USER", targetId: me }],
      }),
    ).toBe("single");
  });

  it("ignores assistant/agent-authored messages", () => {
    expect(
      deriveAgentMode({
        currentUserId: me,
        threadMessages: [
          { role: "USER", senderId: me, senderType: "user" },
          { role: "ASSISTANT", senderId: "agent-1", senderType: "agent" },
        ],
        draftMentions: [],
      }),
    ).toBe("single");
  });

  it("skips sender-based detection when currentUserId is unknown", () => {
    // Without knowing who "I" am, an authored message can't be attributed to
    // another human — fall back to draft mentions only.
    expect(
      deriveAgentMode({
        currentUserId: null,
        threadMessages: [{ role: "USER", senderId: "someone", senderType: "user" }],
        draftMentions: [],
      }),
    ).toBe("single");
  });
});

describe("deriveAgentDefault", () => {
  it("defaults the toggle ON in single-player", () => {
    expect(deriveAgentDefault({ currentUserId: me }).agentDefaultOn).toBe(true);
  });

  it("defaults the toggle OFF in multi-player", () => {
    expect(
      deriveAgentDefault({
        currentUserId: me,
        draftMentions: [{ targetType: "USER", targetId: "user-scott" }],
      }).agentDefaultOn,
    ).toBe(false);
  });
});
