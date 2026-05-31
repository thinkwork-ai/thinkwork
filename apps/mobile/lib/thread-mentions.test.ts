import { describe, expect, it } from "vitest";
import {
  currentMentionQuery,
  mentionCandidatesForTargets,
  sendMessageMentionsForInput,
} from "./thread-mentions";

describe("thread mentions", () => {
  it("maps thread mention targets to mobile autocomplete candidates", () => {
    expect(
      mentionCandidatesForTargets([
        {
          id: "target-1",
          targetType: "USER",
          targetId: "user-scott",
          displayName: "Scott Hertel",
        },
        {
          id: "target-2",
          targetType: "AGENT",
          targetId: "agent-1",
          displayName: "agent",
        },
      ]),
    ).toEqual([
      {
        id: "target-1",
        name: "Scott Hertel",
        displayName: "Scott Hertel",
        targetId: "user-scott",
        targetType: "USER",
        type: "member",
      },
      {
        id: "target-2",
        name: "agent",
        displayName: "agent",
        targetId: "agent-1",
        targetType: "AGENT",
        type: "assistant",
      },
    ]);
  });

  it("maps selected mobile mentions to SendMessageInput mentions", () => {
    expect(
      sendMessageMentionsForInput([
        {
          id: "target-1",
          targetType: "USER",
          targetId: "user-scott",
          displayName: "Scott Hertel",
          rawText: "@Scott Hertel",
          type: "member",
        },
      ]),
    ).toEqual([
      {
        targetType: "USER",
        targetId: "user-scott",
        displayName: "Scott Hertel",
        rawText: "@Scott Hertel",
      },
    ]);
  });

  it("detects an active mention query at the current cursor", () => {
    expect(currentMentionQuery("@", 1)).toBe("");
    expect(currentMentionQuery("hello @bre", 10)).toBe("bre");
    expect(currentMentionQuery("hello @Brett Odom", 12)).toBe("Brett");
  });

  it("hides autocomplete when the mention token is deleted or stale cursor moves past text", () => {
    expect(currentMentionQuery("", 1)).toBeNull();
    expect(currentMentionQuery("hello ", 50)).toBeNull();
    expect(currentMentionQuery("hello @bre done", 15)).toBeNull();
  });
});
