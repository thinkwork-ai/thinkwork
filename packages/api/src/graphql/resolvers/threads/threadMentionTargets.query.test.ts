import { describe, expect, it, vi } from "vitest";
import { threadMentionTargets } from "./threadMentionTargets.query.js";

vi.mock("../../../lib/mentions/thread-mention-targets.js", () => ({
  loadThreadMentionTargets: vi.fn(async () => [
    {
      id: "agent:a1",
      targetType: "agent",
      targetId: "a1",
      displayName: "Coordinator",
      avatarUrl: "https://example.com/a.png",
      role: "coordinator",
    },
    {
      id: "user:u1",
      targetType: "user",
      targetId: "u1",
      displayName: "Alex Finance",
      role: "finance",
    },
  ]),
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: vi.fn(async () => "tenant-from-caller"),
}));

describe("threadMentionTargets", () => {
  it("returns Space mention targets with GraphQL enum casing", async () => {
    await expect(
      threadMentionTargets(null, { threadId: "thread-1" }, {
        auth: { tenantId: "tenant-1" },
      } as any),
    ).resolves.toEqual([
      {
        id: "agent:a1",
        targetType: "AGENT",
        targetId: "a1",
        displayName: "Coordinator",
        avatarUrl: "https://example.com/a.png",
        role: "coordinator",
      },
      {
        id: "user:u1",
        targetType: "USER",
        targetId: "u1",
        displayName: "Alex Finance",
        avatarUrl: undefined,
        role: "finance",
      },
    ]);
  });
});
