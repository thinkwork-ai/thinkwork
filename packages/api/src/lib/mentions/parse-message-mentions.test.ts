import { describe, expect, it } from "vitest";
import { parseMessageMentions } from "./parse-message-mentions.js";

const targets = [
  {
    targetType: "agent" as const,
    targetId: "11111111-1111-4111-8111-111111111111",
    displayName: "Coordinator",
    aliases: ["coordinator", "coord"],
  },
  {
    targetType: "user" as const,
    targetId: "22222222-2222-4222-8222-222222222222",
    displayName: "Alex Finance",
    aliases: ["alex"],
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
});
