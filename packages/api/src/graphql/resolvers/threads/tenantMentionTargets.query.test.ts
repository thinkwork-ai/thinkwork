import { describe, expect, it, vi } from "vitest";
import { tenantMentionTargets } from "./tenantMentionTargets.query.js";

vi.mock("../../../lib/mentions/thread-mention-targets.js", () => ({
  loadTenantMentionTargets: vi.fn(async () => [
    {
      id: "user:u1",
      targetType: "user",
      targetId: "u1",
      displayName: "Alex Finance",
      aliases: ["alex"],
      isDefaultAgent: false,
      role: "finance",
    },
    {
      id: "agent:a1",
      targetType: "agent",
      targetId: "a1",
      displayName: "Coordinator",
      aliases: ["agent", "think", "coordinator"],
      isDefaultAgent: true,
      avatarUrl: "https://example.com/a.png",
      role: "coordinator",
    },
  ]),
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: vi.fn(async () => "tenant-from-caller"),
}));

describe("tenantMentionTargets", () => {
  it("returns tenant mention targets with GraphQL enum casing", async () => {
    await expect(
      tenantMentionTargets(null, { tenantId: "tenant-1" }, {
        auth: { tenantId: "tenant-1" },
      } as any),
    ).resolves.toEqual([
      {
        id: "user:u1",
        targetType: "USER",
        targetId: "u1",
        displayName: "Alex Finance",
        aliases: ["alex"],
        isDefaultAgent: false,
        avatarUrl: undefined,
        role: "finance",
      },
      {
        id: "agent:a1",
        targetType: "AGENT",
        targetId: "a1",
        displayName: "Coordinator",
        aliases: ["agent", "think", "coordinator"],
        isDefaultAgent: true,
        avatarUrl: "https://example.com/a.png",
        role: "coordinator",
      },
    ]);
  });

  it("returns [] when no caller tenant can be resolved", async () => {
    const { resolveCallerTenantId } = await import(
      "../core/resolve-auth-user.js"
    );
    vi.mocked(resolveCallerTenantId).mockResolvedValueOnce(
      null as unknown as string,
    );
    await expect(
      tenantMentionTargets(null, { tenantId: "tenant-1" }, {
        auth: {},
      } as any),
    ).resolves.toEqual([]);
  });
});
