import { describe, expect, it } from "vitest";
import {
  deriveAgentDefault,
  deriveAgentDispatch,
  deriveAgentMode,
  type AgentDispatchRequestValue,
} from "./agent-mode";

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

  it("agent profile mentions never trigger multi-player", () => {
    expect(
      deriveAgentMode({
        currentUserId: me,
        threadMessages: [{ role: "USER", senderId: me, senderType: "user" }],
        draftMentions: [
          { targetType: "AGENT_PROFILE", targetId: "profile-research" },
        ],
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
        threadMessages: [
          { role: "USER", senderId: "someone", senderType: "user" },
        ],
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

  describe("server Thread Mode wins over local heuristics (THINK-136)", () => {
    it("server AGENT forces single-player even when a human posted", () => {
      // Heuristic alone would read multi-player (another human posted); the
      // server override (mode: agent) must win.
      const result = deriveAgentDefault({
        currentUserId: me,
        serverMode: "AGENT",
        threadMessages: [
          { role: "USER", senderId: me, senderType: "user" },
          { role: "USER", senderId: "user-scott", senderType: "user" },
        ],
        draftMentions: [],
      });
      expect(result.mode).toBe("single");
      expect(result.agentDefaultOn).toBe(true);
    });

    it("server MULTIPLAYER forces multi-player even for a solo thread", () => {
      // Heuristic alone would read single-player (only me); the server's real
      // participant count (e.g. a mentioned-but-not-yet-replied user) wins.
      const result = deriveAgentDefault({
        currentUserId: me,
        serverMode: "MULTIPLAYER",
        threadMessages: [{ role: "USER", senderId: me, senderType: "user" }],
        draftMentions: [],
      });
      expect(result.mode).toBe("multi");
      expect(result.agentDefaultOn).toBe(false);
    });

    it("falls back to the heuristic when server mode is absent (legacy data)", () => {
      expect(
        deriveAgentDefault({
          currentUserId: me,
          serverMode: null,
          threadMessages: [
            { role: "USER", senderId: me, senderType: "user" },
            { role: "USER", senderId: "user-scott", senderType: "user" },
          ],
        }),
      ).toEqual({ mode: "multi", agentDefaultOn: false });
      expect(
        deriveAgentDefault({
          currentUserId: me,
          threadMessages: [{ role: "USER", senderId: me, senderType: "user" }],
        }),
      ).toEqual({ mode: "single", agentDefaultOn: true });
    });
  });
});

describe("deriveAgentDispatch", () => {
  const cases: Array<{
    name: string;
    overridden: boolean;
    enabled: boolean;
    expected: AgentDispatchRequestValue;
  }> = [
    { name: "untouched → AUTO (enabled)", overridden: false, enabled: true, expected: "AUTO" },
    { name: "untouched → AUTO (disabled)", overridden: false, enabled: false, expected: "AUTO" },
    { name: "manual ON → FORCE_ON", overridden: true, enabled: true, expected: "FORCE_ON" },
    { name: "manual OFF → FORCE_OFF", overridden: true, enabled: false, expected: "FORCE_OFF" },
  ];

  for (const { name, overridden, enabled, expected } of cases) {
    it(name, () => {
      expect(deriveAgentDispatch({ overridden, enabled })).toBe(expected);
    });
  }
});
