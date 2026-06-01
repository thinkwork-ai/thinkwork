import { describe, expect, it } from "vitest";
import {
  agentWorkspacePrefix,
  spaceSourcePrefix,
  threadRuntimePrefix,
  userWorkspacePrefix,
  workspacePathOwner,
} from "./prefixes.js";
import type { ResolvedWorkspaceRenderTuple } from "./types.js";

const TUPLE: ResolvedWorkspaceRenderTuple = {
  tenantId: "tenant-1",
  tenantSlug: "acme",
  agentId: "agent-1",
  agentSlug: "finance-agent",
  agentName: "Finance Agent",
  spaceId: "space-1",
  spaceSlug: "board-pack",
  spaceName: "Board Pack",
  spaceKind: "custom",
  spaceAccessMode: "public",
  spacePrompt: null,
  spaceToolPolicy: {},
  spaceMcpPolicy: {},
  threadId: "thread-1",
  threadSlug: "customer-kickoff",
  userId: "user-1",
  userSlug: "eric",
  userName: "Eric",
};

describe("workspace renderer prefixes", () => {
  it("builds the canonical three-source and per-thread runtime prefixes", () => {
    expect(agentWorkspacePrefix(TUPLE)).toBe(
      "tenants/acme/agents/finance-agent/",
    );
    expect(spaceSourcePrefix(TUPLE)).toBe("tenants/acme/spaces/board-pack/");
    expect(userWorkspacePrefix({ tenantSlug: "acme", userSlug: "eric" })).toBe(
      "tenants/acme/users/eric/",
    );
    expect(threadRuntimePrefix(TUPLE)).toBe(
      "tenants/acme/threads/customer-kickoff/",
    );
  });

  it("falls back to the durable thread id when no thread folder name is known", () => {
    expect(threadRuntimePrefix({ ...TUPLE, threadSlug: null })).toBe(
      "tenants/acme/threads/thread-1/",
    );
  });

  it("maps rendered relative paths to deterministic owners", () => {
    expect(workspacePathOwner("Agent/AGENTS.md")).toBe("agent");
    expect(workspacePathOwner("Agent/skills/reporting/SKILL.md")).toBe("agent");
    expect(workspacePathOwner("Spaces/board-pack/SPACE.md")).toBe("space");
    expect(workspacePathOwner("Spaces/board-pack/docs/customer.md")).toBe(
      "space",
    );
    expect(workspacePathOwner("Space/docs/customer.md")).toBe("space");
    expect(workspacePathOwner("User/USER.md")).toBe("user");
    expect(workspacePathOwner("User/memory/preferences.md")).toBe("user");
    expect(workspacePathOwner("Spaces/board-pack/GOAL.md")).toBe("status");
    expect(workspacePathOwner("Spaces/board-pack/PROGRESS.md")).toBe("status");
    expect(workspacePathOwner("Spaces/board-pack/DECISIONS.md")).toBe(
      "thread_goal",
    );
    expect(workspacePathOwner("USER.md")).toBe("user");
    expect(workspacePathOwner("memory/preferences.md")).toBe("agent");
    expect(workspacePathOwner("SPACE.md")).toBe("space");
    expect(workspacePathOwner("docs/customer.md")).toBe("space");
    expect(workspacePathOwner("goals/launch/notes.md")).toBe("space");
    expect(workspacePathOwner("AGENTS.md")).toBe("agent");
    expect(workspacePathOwner("CONTEXT.md")).toBe("agent");
    expect(workspacePathOwner("skills/reporting/SKILL.md")).toBe("agent");
    expect(workspacePathOwner("GOAL.md")).toBe("status");
    expect(workspacePathOwner("PROGRESS.md")).toBe("status");
    expect(workspacePathOwner("DECISIONS.md")).toBe("thread_goal");
    expect(workspacePathOwner("stages/kickoff/CONTEXT.md")).toBe("thread_goal");
  });

  it("treats scratch and unmapped paths as non-authoritative", () => {
    expect(workspacePathOwner("scratch/tmp.md")).toBe("scratch");
    expect(workspacePathOwner("notes.md")).toBe("unowned");
    expect(workspacePathOwner("../secrets.md")).toBe("unowned");
    expect(workspacePathOwner("memory\\secrets.md")).toBe("unowned");
  });
});
