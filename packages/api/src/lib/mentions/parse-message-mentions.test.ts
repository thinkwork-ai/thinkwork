import { describe, expect, it } from "vitest";
import { parseMessageMentions } from "./parse-message-mentions.js";

const targets = [
  {
    targetType: "agent" as const,
    targetId: "11111111-1111-4111-8111-111111111111",
    displayName: "Coordinator",
    aliases: ["agent", "think", "coordinator", "coord"],
    isDefaultAgent: true,
  },
  {
    targetType: "user" as const,
    targetId: "22222222-2222-4222-8222-222222222222",
    displayName: "Alex Finance",
    aliases: ["alex"],
  },
  {
    targetType: "agent_profile" as const,
    targetId: "33333333-3333-4333-8333-333333333333",
    displayName: "Research",
    aliases: ["research"],
  },
];

describe("parseMessageMentions", () => {
  it("accepts structured mentions and fills display names from targets", () => {
    expect(
      parseMessageMentions({
        content: "Can you review this?",
        targets,
        explicitMentions: [
          {
            targetType: "AGENT",
            targetId: "11111111-1111-4111-8111-111111111111",
          },
        ],
      }),
    ).toEqual([
      {
        targetType: "agent",
        targetId: "11111111-1111-4111-8111-111111111111",
        displayName: "Coordinator",
        rawText: null,
        startOffset: null,
        endOffset: null,
      },
    ]);
  });

  it("finds text mentions from aliases and de-duplicates structured mentions", () => {
    expect(
      parseMessageMentions({
        content: "@coord please ask @alex about credit.",
        targets,
        explicitMentions: [
          {
            targetType: "AGENT",
            targetId: "11111111-1111-4111-8111-111111111111",
            displayName: "Coordinator",
          },
        ],
      }).map((mention) => ({
        targetType: mention.targetType,
        targetId: mention.targetId,
        displayName: mention.displayName,
        rawText: mention.rawText,
      })),
    ).toEqual([
      {
        targetType: "agent",
        targetId: "11111111-1111-4111-8111-111111111111",
        displayName: "Coordinator",
        rawText: null,
      },
      {
        targetType: "user",
        targetId: "22222222-2222-4222-8222-222222222222",
        displayName: "Alex Finance",
        rawText: "@alex",
      },
    ]);
  });

  it("resolves reserved default-agent aliases before generic target names", () => {
    expect(
      parseMessageMentions({
        content: "@agent can you help @think through the next step?",
        targets: [
          ...targets,
          {
            targetType: "user" as const,
            targetId: "33333333-3333-4333-8333-333333333333",
            displayName: "Agent",
            aliases: ["agent"],
          },
        ],
      }).map((mention) => ({
        targetType: mention.targetType,
        targetId: mention.targetId,
        displayName: mention.displayName,
        rawText: mention.rawText,
      })),
    ).toEqual([
      {
        targetType: "agent",
        targetId: "11111111-1111-4111-8111-111111111111",
        displayName: "agent",
        rawText: "@agent",
      },
    ]);
  });

  it("matches default-agent aliases case-insensitively with mention boundaries", () => {
    expect(
      parseMessageMentions({
        content: "Loop in @Think, but not @thinking or email@agent",
        targets,
      }).map((mention) => ({
        targetType: mention.targetType,
        targetId: mention.targetId,
        displayName: mention.displayName,
        rawText: mention.rawText,
      })),
    ).toEqual([
      {
        targetType: "agent",
        targetId: "11111111-1111-4111-8111-111111111111",
        displayName: "agent",
        rawText: "@Think",
      },
    ]);
  });

  it("parses Agent Profile mentions from explicit input and # text aliases", () => {
    expect(
      parseMessageMentions({
        content: "#research cite the source",
        targets,
        explicitMentions: [
          {
            targetType: "AGENT_PROFILE",
            targetId: "33333333-3333-4333-8333-333333333333",
            displayName: "Research",
            rawText: "#Research",
          },
        ],
      }).map((mention) => ({
        targetType: mention.targetType,
        targetId: mention.targetId,
        displayName: mention.displayName,
        rawText: mention.rawText,
      })),
    ).toEqual([
      {
        targetType: "agent_profile",
        targetId: "33333333-3333-4333-8333-333333333333",
        displayName: "Research",
        rawText: "#Research",
      },
    ]);
  });

  it("keeps @ Agent Profile mentions as a backwards-compatible text alias", () => {
    expect(
      parseMessageMentions({
        content: "@research cite the source",
        targets,
      }).map((mention) => ({
        targetType: mention.targetType,
        displayName: mention.displayName,
        rawText: mention.rawText,
      })),
    ).toEqual([
      {
        targetType: "agent_profile",
        displayName: "Research",
        rawText: "@research",
      },
    ]);
  });
});
