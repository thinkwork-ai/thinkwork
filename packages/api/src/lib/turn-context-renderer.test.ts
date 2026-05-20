import { describe, expect, it, vi } from "vitest";

import {
  renderSpaceContextMarkdown,
  renderTurnContext,
  type ResolvedTurnContext,
  type TurnContextRepository,
} from "./turn-context-renderer.js";
import type { WorkspaceObjectStore } from "./workspace-renderer.js";

const BASE_CONTEXT: ResolvedTurnContext = {
  tenantId: "tenant-1",
  tenantSlug: "acme",
  agentId: "agent-1",
  agentSlug: "sql-agent",
  agentName: "SQL Agent",
  spaceId: "space-1",
  spaceSlug: "finance",
  spaceName: "Finance",
  spacePrompt: "Use finance workspace context.",
  spaceContextConfig: null,
  spaceToolPolicy: { blockedTools: ["send_email"] },
  spaceMcpPolicy: { allowedServers: ["warehouse"] },
};

class FakeRepository implements TurnContextRepository {
  constructor(private readonly context: ResolvedTurnContext | null) {}

  async resolve(): Promise<ResolvedTurnContext | null> {
    return this.context;
  }
}

class FakeObjectStore implements WorkspaceObjectStore {
  readonly copies: { bucket: string; sourceKey: string; targetKey: string }[] =
    [];
  readonly puts: { bucket: string; key: string; content: string }[] = [];

  constructor(private readonly keys: string[]) {}

  async listKeys(): Promise<string[]> {
    return this.keys;
  }

  async copyObject(input: {
    bucket: string;
    sourceKey: string;
    targetKey: string;
  }): Promise<void> {
    this.copies.push(input);
  }

  async putText(input: {
    bucket: string;
    key: string;
    content: string;
  }): Promise<void> {
    this.puts.push(input);
  }
}

describe("renderTurnContext", () => {
  it("renders Space files into the agent workspace namespace", async () => {
    const store = new FakeObjectStore([
      "tenants/acme/spaces/finance/source/AGENTS.md",
      "tenants/acme/spaces/finance/source/folders/reporting.md",
      "tenants/acme/spaces/finance/source/manifest.json",
    ]);
    const regenerateManifest = vi.fn().mockResolvedValue(undefined);

    const result = await renderTurnContext(
      {
        tenantId: "tenant-1",
        agentId: "agent-1",
        threadId: "thread-1",
        turnId: "turn-1",
        agentBlockedTools: ["browser_automation"],
      },
      {
        bucket: "workspace-bucket",
        repository: new FakeRepository(BASE_CONTEXT),
        objectStore: store,
        regenerateManifest,
        now: () => new Date("2026-05-20T12:00:00.000Z"),
      },
    );

    expect(result).toMatchObject({
      rendered: true,
      spaceSlug: "finance",
      copiedFiles: ["AGENTS.md", "folders/reporting.md"],
      effectivePolicy: {
        blockedTools: ["browser_automation", "send_email"],
        mcpAllowedServers: ["warehouse"],
      },
    });
    expect(store.copies.map((copy) => copy.targetKey).sort()).toEqual([
      "tenants/acme/agents/sql-agent/workspace/spaces/finance/AGENTS.md",
      "tenants/acme/agents/sql-agent/workspace/spaces/finance/folders/reporting.md",
    ]);
    expect(store.puts.map((put) => put.key).sort()).toEqual([
      "tenants/acme/agents/sql-agent/workspace/SPACE_CONTEXT.md",
      "tenants/acme/agents/sql-agent/workspace/effective-policy.json",
    ]);
    expect(
      store.puts.find((put) => put.key.endsWith("effective-policy.json"))
        ?.content,
    ).toContain('"turnId": "turn-1"');
    expect(regenerateManifest).toHaveBeenCalledWith(
      "workspace-bucket",
      "acme",
      "sql-agent",
    );
    expect(
      store.copies.some((copy) => copy.targetKey.endsWith("IDENTITY.md")),
    ).toBe(false);
  });

  it("skips rendering when the thread has no active Space context", async () => {
    const store = new FakeObjectStore([
      "tenants/acme/spaces/finance/source/AGENTS.md",
    ]);

    const result = await renderTurnContext(
      { tenantId: "tenant-1", agentId: "agent-1" },
      {
        bucket: "workspace-bucket",
        repository: new FakeRepository(null),
        objectStore: store,
        regenerateManifest: false,
      },
    );

    expect(result).toEqual({ rendered: false, reason: "context_unresolved" });
    expect(store.copies).toHaveLength(0);
    expect(store.puts).toHaveLength(0);
  });
});

describe("renderSpaceContextMarkdown", () => {
  it("describes active Space files and policies", () => {
    const markdown = renderSpaceContextMarkdown({
      context: BASE_CONTEXT,
      copiedFiles: ["AGENTS.md"],
      effectivePolicy: {
        blockedTools: ["send_email"],
        allowedTools: null,
        mcpAllowedServers: null,
        mcpBlockedServers: [],
        diagnostics: [],
      },
      renderedAt: new Date("2026-05-20T12:00:00.000Z"),
    });

    expect(markdown).toContain("# Active Space Context: Finance");
    expect(markdown).toContain("spaces/finance/AGENTS.md");
    expect(markdown).toContain("Blocked tools: send_email");
  });
});
