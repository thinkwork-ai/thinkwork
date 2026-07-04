import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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

describe("Mention Invite target scoping (THINK-136 R2, fix for private-space mention rejection)", () => {
  const source = readFileSync(
    new URL("./thread-mention-targets.ts", import.meta.url),
    "utf8",
  );

  it("offers every active tenant member as a user mention target regardless of space access mode — a mention is a thread-level invite, so private-space threads must not reject tenant members", () => {
    // The pre-fix gate hid tenant members behind public-space access, which
    // made validateExplicitMentions reject the invite that the composer
    // legitimately offered (first send failed; retry silently dropped it).
    expect(source).not.toContain('spaceAccessMode === "public"');
    expect(source).toContain("Mention Invite");
  });

  it("keeps the tenant-member union active-members-only and user-principal-only", () => {
    const block = source.slice(
      source.indexOf("Mention Invite"),
      source.indexOf("if (!input.spaceId) {"),
    );
    expect(block).toContain('eq(tenantMembers.principal_type, "user")');
    expect(block).toContain('eq(tenantMembers.status, "active")');
  });
});
