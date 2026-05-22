import { describe, expect, it } from "vitest";
import {
  agentRepointTargets,
  pickCanonicalAgent,
  type CollapseAgentRow,
} from "./migrate-collapse-agents";
import {
  assertTargetContained,
  foldAgentWorkspaces,
  workspacePrefix,
  type WorkspaceObjectStore,
} from "./fold-agent-workspaces";

class MemoryWorkspaceStore implements WorkspaceObjectStore {
  readonly keys = new Set<string>();
  readonly copies: Array<{ sourceKey: string; targetKey: string }> = [];
  readonly deleted: string[] = [];

  constructor(keys: string[]) {
    for (const key of keys) this.keys.add(key);
  }

  async listObjects(prefix: string): Promise<string[]> {
    return [...this.keys].filter((key) => key.startsWith(prefix)).sort();
  }

  async objectExists(key: string): Promise<boolean> {
    return this.keys.has(key);
  }

  async objectFingerprint(key: string): Promise<string | null> {
    if (!this.keys.has(key)) return null;
    return key.includes("same-content") ? "same" : key;
  }

  async copyObject(sourceKey: string, targetKey: string): Promise<void> {
    this.copies.push({ sourceKey, targetKey });
    this.keys.add(targetKey);
  }

  async deleteObjects(keys: string[]): Promise<void> {
    this.deleted.push(...keys);
    for (const key of keys) this.keys.delete(key);
  }

  async countObjects(prefix: string): Promise<number> {
    return [...this.keys].filter((key) => key.startsWith(prefix)).length;
  }
}

function agent(
  overrides: Partial<CollapseAgentRow> & Pick<CollapseAgentRow, "id" | "slug">,
): CollapseAgentRow {
  return {
    tenantId: "tenant-1",
    tenantSlug: "acme",
    status: "idle",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    isPlatformDefault: false,
    ...overrides,
  };
}

describe("pickCanonicalAgent", () => {
  it("picks the oldest non-archived agent and ignores archived rows", () => {
    const canonical = pickCanonicalAgent([
      agent({
        id: "archived-oldest",
        slug: "old",
        status: "archived",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      }),
      agent({
        id: "active-newer",
        slug: "newer",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      }),
      agent({
        id: "active-oldest",
        slug: "platform",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ]);

    expect(canonical?.id).toBe("active-oldest");
  });

  it("uses id as a stable tie-breaker and returns null when all are archived", () => {
    expect(
      pickCanonicalAgent([
        agent({ id: "b", slug: "b" }),
        agent({ id: "a", slug: "a" }),
      ])?.id,
    ).toBe("a");

    expect(
      pickCanonicalAgent([agent({ id: "z", slug: "z", status: "archived" })]),
    ).toBeNull();
  });
});

describe("foldAgentWorkspaces", () => {
  it("plans and copies non-canonical workspaces under subagent folders", async () => {
    const store = new MemoryWorkspaceStore([
      "tenants/acme/agents/platform/workspace/AGENTS.md",
      "tenants/acme/agents/finance/workspace/SOUL.md",
      "tenants/acme/agents/finance/workspace/tools/report.md",
      "tenants/acme/agents/reports/workspace/AGENTS.md",
    ]);

    const result = await foldAgentWorkspaces({
      store,
      tenantSlug: "acme",
      canonicalAgent: { id: "platform-id", slug: "platform" },
      sourceAgents: [
        { id: "finance-id", slug: "finance" },
        { id: "reports-id", slug: "reports" },
      ],
    });

    expect(result.conflicts).toEqual([]);
    expect(result.plannedCopies.map((copy) => copy.targetKey)).toEqual([
      "tenants/acme/agents/platform/workspace/finance/SOUL.md",
      "tenants/acme/agents/platform/workspace/finance/tools/report.md",
      "tenants/acme/agents/platform/workspace/reports/AGENTS.md",
    ]);
    expect(store.copies).toHaveLength(3);
    expect(result.canonicalPrefixObjectCount).toBe(4);
  });

  it("reports conflicts without copying or deleting objects", async () => {
    const store = new MemoryWorkspaceStore([
      "tenants/acme/agents/platform/workspace/finance/SOUL.md",
      "tenants/acme/agents/finance/workspace/SOUL.md",
    ]);

    const result = await foldAgentWorkspaces({
      store,
      tenantSlug: "acme",
      canonicalAgent: { id: "platform-id", slug: "platform" },
      sourceAgents: [{ id: "finance-id", slug: "finance" }],
    });

    expect(result.conflicts).toEqual([
      {
        sourceAgentId: "finance-id",
        sourceAgentSlug: "finance",
        sourceKey: "tenants/acme/agents/finance/workspace/SOUL.md",
        targetKey: "tenants/acme/agents/platform/workspace/finance/SOUL.md",
        reason: "target_exists",
      },
    ]);
    expect(store.copies).toEqual([]);
    expect(store.deleted).toEqual([]);
  });

  it("treats already-copied identical targets as idempotent", async () => {
    const store = new MemoryWorkspaceStore([
      "tenants/acme/agents/platform/workspace/finance/same-content.md",
      "tenants/acme/agents/finance/workspace/same-content.md",
    ]);

    const result = await foldAgentWorkspaces({
      store,
      tenantSlug: "acme",
      canonicalAgent: { id: "platform-id", slug: "platform" },
      sourceAgents: [{ id: "finance-id", slug: "finance" }],
    });

    expect(result.conflicts).toEqual([]);
    expect(store.copies).toEqual([]);
  });

  it("validates slugs and target prefix containment", () => {
    expect(() => workspacePrefix("acme", "../escape")).toThrow(
      /Invalid agent slug/,
    );
    expect(() =>
      assertTargetContained(
        "tenants/acme/agents/other/workspace/finance/SOUL.md",
        "acme",
        "platform",
      ),
    ).toThrow(/escaped canonical prefix/);
  });
});

describe("agentRepointTargets", () => {
  it("covers the known agent foreign-key surface from the migration plan", () => {
    const labels = agentRepointTargets().map(
      (target) => `${target.table}.${target.column}`,
    );

    expect(labels).toEqual(
      expect.arrayContaining([
        "threads.agent_id",
        "thread_turns.agent_id",
        "thread_turn_events.agent_id",
        "retry_queue.agent_id",
        "eval_test_cases.agent_id",
        "eval_runs.agent_id",
        "scheduled_jobs.agent_id",
        "agent_skills.agent_id",
        "agent_capabilities.agent_id",
        "agent_knowledge_bases.agent_id",
        "agent_mcp_servers.agent_id",
        "email_reply_tokens.agent_id",
        "computers.primary_agent_id",
        "computers.migrated_from_agent_id",
        "space_agent_assignments.agent_id",
        "user_quick_actions.workspace_agent_id",
      ]),
    );
  });
});
