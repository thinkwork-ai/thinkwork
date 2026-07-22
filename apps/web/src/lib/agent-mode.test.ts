import { describe, expect, it } from "vitest";
import {
  deriveAgentDefault,
  deriveAgentDispatch,
  deriveAgentMode,
  resolveDraftMentions,
  type AgentDispatchRequestValue,
  type DraftMentionTarget,
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

    it("draft user-mention outranks server AGENT mode (THINK-328 defect)", () => {
      // The defect: an existing single-player thread (server mode AGENT) whose
      // follow-up draft @mentions another human left the toggle checked.
      const result = deriveAgentDefault({
        currentUserId: me,
        serverMode: "AGENT",
        threadMessages: [{ role: "USER", senderId: me, senderType: "user" }],
        draftMentions: [{ targetType: "USER", targetId: "user-scott" }],
      });
      expect(result.mode).toBe("multi");
      expect(result.agentDefaultOn).toBe(false);
    });

    it("server AGENT still wins over a draft self-mention", () => {
      const result = deriveAgentDefault({
        currentUserId: me,
        serverMode: "AGENT",
        draftMentions: [{ targetType: "USER", targetId: me }],
      });
      expect(result.mode).toBe("single");
      expect(result.agentDefaultOn).toBe(true);
    });

    it("server AGENT still wins over agent and agent-profile draft mentions", () => {
      for (const targetType of ["AGENT", "AGENT_PROFILE"] as const) {
        const result = deriveAgentDefault({
          currentUserId: me,
          serverMode: "AGENT",
          draftMentions: [{ targetType, targetId: "agent-thing" }],
        });
        expect(result.mode).toBe("single");
        expect(result.agentDefaultOn).toBe(true);
      }
    });

    it("server MULTIPLAYER stays multi with a draft user-mention", () => {
      const result = deriveAgentDefault({
        currentUserId: me,
        serverMode: "MULTIPLAYER",
        draftMentions: [{ targetType: "USER", targetId: "user-scott" }],
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

describe("resolveDraftMentions", () => {
  const targets: DraftMentionTarget[] = [
    { targetType: "USER", targetId: "user-bob", displayName: "Bob Smith" },
    {
      targetType: "USER",
      targetId: "user-al",
      displayName: "Al Green",
      aliases: ["al"],
    },
    { targetType: "USER", targetId: me, displayName: "Current User" },
    { targetType: "AGENT", targetId: "agent-1", displayName: "Marco" },
    {
      targetType: "AGENT_PROFILE",
      targetId: "profile-research",
      displayName: "Research",
      aliases: ["research"],
    },
  ];

  it("keeps a structured mention while its rawText is in the text", () => {
    expect(
      resolveDraftMentions({
        text: "hey @Bob Smith can you look",
        structuredMentions: [
          { targetType: "USER", targetId: "user-bob", rawText: "@Bob Smith" },
        ],
        currentUserId: me,
      }),
    ).toEqual([{ targetType: "USER", targetId: "user-bob" }]);
  });

  it("drops a structured mention whose rawText was deleted (R2)", () => {
    expect(
      resolveDraftMentions({
        text: "hey can you look",
        structuredMentions: [
          { targetType: "USER", targetId: "user-bob", rawText: "@Bob Smith" },
        ],
        currentUserId: me,
      }),
    ).toEqual([]);
  });

  it("drops a structured mention on partial deletion of its rawText", () => {
    expect(
      resolveDraftMentions({
        text: "hey @Bob Sm can you look",
        structuredMentions: [
          { targetType: "USER", targetId: "user-bob", rawText: "@Bob Smith" },
        ],
        currentUserId: me,
      }),
    ).toEqual([]);
  });

  describe("typed plain-text scan (R7, mirrors server findTextMentions)", () => {
    const resolve = (text: string, currentUserId: string | null = me) =>
      resolveDraftMentions({ text, mentionTargets: targets, currentUserId });

    it("matches a typed display name case-insensitively at the start", () => {
      expect(resolve("@bob smith please review")).toEqual([
        { targetType: "USER", targetId: "user-bob" },
      ]);
    });

    it("matches at a whitespace boundary", () => {
      expect(resolve("please review @Bob Smith")).toEqual([
        { targetType: "USER", targetId: "user-bob" },
      ]);
    });

    it("matches with a punctuation terminator", () => {
      expect(resolve("@Al, take a look")).toEqual([
        { targetType: "USER", targetId: "user-al" },
      ]);
    });

    it("does not match without a boundary before the @ (emails)", () => {
      expect(resolve("mail me at email@al.example")).toEqual([]);
    });

    it("does not match a longer word sharing the alias prefix", () => {
      // Trailing-boundary lookahead: "@Albert" must not match alias "Al".
      expect(resolve("@Albert is someone else")).toEqual([]);
    });

    it("matches an alias", () => {
      expect(resolve("hey @al can you check")).toEqual([
        { targetType: "USER", targetId: "user-al" },
      ]);
    });

    it("never matches the current user's own name", () => {
      expect(resolve("@Current User please")).toEqual([]);
    });

    it("never returns AGENT or AGENT_PROFILE targets", () => {
      expect(resolve("@Marco and #Research and @research")).toEqual([]);
    });

    it("counts typed USER matches when the current user is unknown", () => {
      // Pins deriveAgentMode's semantics: any user mention is "other" when the
      // current user is unknown.
      expect(resolve("@Bob Smith please", null)).toEqual([
        { targetType: "USER", targetId: "user-bob" },
      ]);
      expect(
        resolveDraftMentions({
          text: "@Current User please",
          mentionTargets: targets,
          currentUserId: null,
        }),
      ).toEqual([{ targetType: "USER", targetId: me }]);
    });
  });

  it("dedupes a structured + typed mention of the same target", () => {
    expect(
      resolveDraftMentions({
        text: "hey @Bob Smith can you look",
        structuredMentions: [
          { targetType: "USER", targetId: "user-bob", rawText: "@Bob Smith" },
        ],
        mentionTargets: targets,
        currentUserId: me,
      }),
    ).toEqual([{ targetType: "USER", targetId: "user-bob" }]);
  });
});

describe("deriveAgentDispatch", () => {
  const cases: Array<{
    name: string;
    overridden: boolean;
    enabled: boolean;
    expected: AgentDispatchRequestValue;
  }> = [
    {
      name: "untouched → AUTO (enabled)",
      overridden: false,
      enabled: true,
      expected: "AUTO",
    },
    {
      name: "untouched → AUTO (disabled)",
      overridden: false,
      enabled: false,
      expected: "AUTO",
    },
    {
      name: "manual ON → FORCE_ON",
      overridden: true,
      enabled: true,
      expected: "FORCE_ON",
    },
    {
      name: "manual OFF → FORCE_OFF",
      overridden: true,
      enabled: false,
      expected: "FORCE_OFF",
    },
  ];

  for (const { name, overridden, enabled, expected } of cases) {
    it(name, () => {
      expect(deriveAgentDispatch({ overridden, enabled })).toBe(expected);
    });
  }
});
