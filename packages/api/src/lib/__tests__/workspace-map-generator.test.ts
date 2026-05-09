import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted state — drizzle table tag + db query dispatch + S3 spy
// ---------------------------------------------------------------------------

const {
  state,
  s3Calls,
  mockRegenerateManifest,
} = vi.hoisted(() => ({
  state: {
    agent: {
      name: "Acme Daily Digest",
      slug: "acme-daily-digest",
      tenant_id: "tenant-1",
    } as { name: string; slug: string; tenant_id: string } | null,
    tenantSlug: "acme",
    computer: null as { id: string; tenant_id: string } | null,
    skills: [] as Array<{
      skill_id: string;
      config: Record<string, unknown> | null;
      enabled: boolean;
    }>,
    knowledgeBases: [] as Array<{
      id: string;
      name: string | null;
      description: string | null;
    }>,
    connectors: [] as Array<{
      catalog_slug: string | null;
      display_name: string;
      description: string | null;
      category: string | null;
    }>,
    workflows: [] as Array<{
      catalog_slug: string | null;
      routine_schedule: string | null;
      display_name: string;
      description: string | null;
      default_schedule: string | null;
    }>,
    skillCatalog: [] as Array<{
      slug: string;
      name: string;
      description: string | null;
      mcp_server: string | null;
      triggers: string[] | null;
    }>,
    s3GetResponses: new Map<string, string | null>(),
    listObjectsResponses: [] as string[],
  },
  s3Calls: {
    puts: [] as Array<{ key: string; body: string }>,
    gets: [] as string[],
    lists: [] as string[],
  },
  mockRegenerateManifest: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send(cmd: { input?: { Bucket?: string; Key?: string; Body?: string; Prefix?: string }; constructor: { name: string } }) {
      const name = cmd.constructor.name;
      const key = cmd.input?.Key ?? "";
      if (name === "PutObjectCommand") {
        s3Calls.puts.push({ key, body: cmd.input?.Body ?? "" });
        return {};
      }
      if (name === "GetObjectCommand") {
        s3Calls.gets.push(key);
        const value = state.s3GetResponses.get(key);
        if (value === undefined || value === null) {
          throw new Error("NoSuchKey");
        }
        return {
          Body: {
            transformToString: async () => value,
          },
        };
      }
      if (name === "ListObjectsV2Command") {
        const prefix = cmd.input?.Prefix ?? "";
        s3Calls.lists.push(prefix);
        return {
          Contents: state.listObjectsResponses.map((slug) => ({
            Key: `${prefix}${slug}/CONTEXT.md`,
          })),
          IsTruncated: false,
        };
      }
      return {};
    }
  },
  GetObjectCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  PutObjectCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  ListObjectsV2Command: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

// Drizzle query mock — dispatches by the first argument to .from(table).
// We tag each table object with __name and route to the canned state above.
function tagTable(name: string): Record<string, unknown> {
  return new Proxy(
    { __name: name },
    {
      get(target, prop: string) {
        if (prop === "__name") return name;
        // Return a stable column reference (string) so eq/and don't blow up.
        return `${name}.${String(prop)}`;
      },
    },
  );
}

vi.mock("@thinkwork/database-pg", () => {
  function makeQuery(table: { __name?: string }): unknown[] {
    const name = table.__name ?? "";
    if (name === "agents") return state.agent ? [state.agent] : [];
    if (name === "tenants") return [{ slug: state.tenantSlug }];
    if (name === "computers") return state.computer ? [state.computer] : [];
    if (name === "agent_skills") return state.skills;
    if (name === "agent_knowledge_bases") return state.knowledgeBases;
    if (name === "connectors") return state.connectors;
    if (name === "routines") return state.workflows;
    if (name === "skill_catalog") return state.skillCatalog;
    return [];
  }

  function chainable(rows: unknown[]): Record<string, unknown> {
    const promise = Promise.resolve(rows);
    const chain: Record<string, unknown> = {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
      orderBy: () => chain,
      limit: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      execute: async () => rows,
    };
    return chain;
  }

  return {
    getDb: () => ({
      select: () => ({
        from: (table: { __name?: string }) => chainable(makeQuery(table)),
      }),
    }),
  };
});

vi.mock("@thinkwork/database-pg/schema", () => ({
  agents: tagTable("agents"),
  agentSkills: tagTable("agent_skills"),
  agentKnowledgeBases: tagTable("agent_knowledge_bases"),
  knowledgeBases: tagTable("knowledge_bases"),
  computers: tagTable("computers"),
  connectors: tagTable("connectors"),
  routines: tagTable("routines"),
  tenantConnectorCatalog: tagTable("tenant_connector_catalog"),
  tenantWorkflowCatalog: tagTable("tenant_workflow_catalog"),
  skillCatalog: tagTable("skill_catalog"),
  tenants: tagTable("tenants"),
}));

vi.mock("../workspace-manifest.js", () => ({
  regenerateManifest: mockRegenerateManifest,
}));

// drizzle-orm helpers — test cares about table dispatch only, not predicates.
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  ne: () => ({}),
  asc: () => ({}),
  isNotNull: () => ({}),
}));

import { regenerateWorkspaceMap } from "../workspace-map-generator.js";

const PREFIX = "tenants/acme/agents/acme-daily-digest/workspace/";

function resetState(): void {
  state.agent = {
    name: "Acme Daily Digest",
    slug: "acme-daily-digest",
    tenant_id: "tenant-1",
  };
  state.tenantSlug = "acme";
  state.computer = { id: "computer-1", tenant_id: "tenant-1" };
  state.skills = [];
  state.knowledgeBases = [];
  state.connectors = [];
  state.workflows = [];
  state.skillCatalog = [];
  state.s3GetResponses.clear();
  state.listObjectsResponses = [];
  s3Calls.puts.length = 0;
  s3Calls.gets.length = 0;
  s3Calls.lists.length = 0;
  mockRegenerateManifest.mockReset();
}

function lastWrittenAgentsMd(): string | null {
  const put = [...s3Calls.puts]
    .reverse()
    .find((p) => p.key === `${PREFIX}AGENTS.md`);
  return put?.body ?? null;
}

beforeEach(() => {
  resetState();
  process.env.WORKSPACE_BUCKET = "thinkwork-dev-workspace";
});

describe("regenerateWorkspaceMap — Connectors projection", () => {
  it("projects active connectors into the Connectors section keyed by Computer", async () => {
    state.connectors = [
      {
        catalog_slug: "slack",
        display_name: "Slack",
        description: "Send and receive messages",
        category: "Messaging",
      },
      {
        catalog_slug: "github",
        display_name: "GitHub",
        description: "Repos, PRs, issues",
        category: "Engineering",
      },
    ];
    await regenerateWorkspaceMap("agent-1", "computer-1");
    const md = lastWrittenAgentsMd();
    expect(md).toContain("## Connectors");
    expect(md).toContain("| Slack | Send and receive messages | Messaging |");
    expect(md).toContain("| GitHub | Repos, PRs, issues | Engineering |");
  });

  it("renders empty Connectors section with placeholder line when none active", async () => {
    state.connectors = [];
    await regenerateWorkspaceMap("agent-1", "computer-1");
    const md = lastWrittenAgentsMd();
    expect(md).toContain("## Connectors");
    expect(md).toContain("No connectors configured.");
  });
});

describe("regenerateWorkspaceMap — Workflows projection", () => {
  it("projects active workflows with catalog default_schedule", async () => {
    state.workflows = [
      {
        catalog_slug: "daily-digest",
        routine_schedule: null,
        display_name: "Daily Digest",
        description: "Summarizes yesterday's activity",
        default_schedule: "cron(0 13 * * ? *)",
      },
    ];
    await regenerateWorkspaceMap("agent-1", "computer-1");
    const md = lastWrittenAgentsMd();
    expect(md).toContain("## Workflows");
    expect(md).toContain(
      "| Daily Digest | Summarizes yesterday's activity | cron(0 13 * * ? *) |",
    );
  });

  it("falls back to routines.schedule when catalog default_schedule is null", async () => {
    state.workflows = [
      {
        catalog_slug: "daily-digest",
        routine_schedule: "cron(0 9 * * MON *)",
        display_name: "Daily Digest",
        description: "Summary",
        default_schedule: null,
      },
    ];
    await regenerateWorkspaceMap("agent-1", "computer-1");
    expect(lastWrittenAgentsMd()).toContain("cron(0 9 * * MON *)");
  });

  it("renders 'on-demand' when both schedules are null", async () => {
    state.workflows = [
      {
        catalog_slug: "ad-hoc-flow",
        routine_schedule: null,
        display_name: "Ad-hoc Flow",
        description: null,
        default_schedule: null,
      },
    ];
    await regenerateWorkspaceMap("agent-1", "computer-1");
    expect(lastWrittenAgentsMd()).toContain("| Ad-hoc Flow | — | on-demand |");
  });

  it("renders empty Workflows section with placeholder line when none active", async () => {
    state.workflows = [];
    await regenerateWorkspaceMap("agent-1", "computer-1");
    expect(lastWrittenAgentsMd()).toContain("## Workflows");
    expect(lastWrittenAgentsMd()).toContain("No workflows configured.");
  });
});

describe("regenerateWorkspaceMap — built-in tool filter", () => {
  it("excludes EVERY BUILTIN_TOOL_SLUGS entry from the Skills table (list-coupled)", async () => {
    // Iterate the canonical list to defend against future expansions —
    // hardcoding subsets means new built-in slugs slip through silently.
    const { BUILTIN_TOOL_SLUGS } = await import("../builtin-tool-slugs.js");
    state.skills = [
      ...BUILTIN_TOOL_SLUGS.map((slug) => ({
        skill_id: slug,
        config: null,
        enabled: true,
      })),
      { skill_id: "sales-prep", config: null, enabled: true },
    ];
    state.skillCatalog = [
      {
        slug: "sales-prep",
        name: "Sales Prep",
        description: "Prep notes",
        mcp_server: null,
        triggers: null,
      },
    ];
    await regenerateWorkspaceMap("agent-1", "computer-1");
    const md = lastWrittenAgentsMd() ?? "";
    expect(md).toContain("Sales Prep");
    for (const builtin of BUILTIN_TOOL_SLUGS) {
      expect(md).not.toContain(builtin);
    }
  });

  it("excludes built-in tool slugs from the Skills table", async () => {
    state.skills = [
      { skill_id: "web-search", config: null, enabled: true },
      { skill_id: "sales-prep", config: null, enabled: true },
    ];
    state.skillCatalog = [
      {
        slug: "sales-prep",
        name: "Sales Prep",
        description: "Prep notes for upcoming meetings",
        mcp_server: null,
        triggers: null,
      },
    ];
    await regenerateWorkspaceMap("agent-1", "computer-1");
    const md = lastWrittenAgentsMd() ?? "";
    expect(md).toContain("Sales Prep");
    expect(md).not.toContain("web-search");
    expect(md).not.toContain("Web Search");
  });

  it("renders 'No skills assigned.' when only built-in tools are present", async () => {
    state.skills = [
      { skill_id: "web-search", config: null, enabled: true },
      { skill_id: "agent-email-send", config: null, enabled: true },
    ];
    await regenerateWorkspaceMap("agent-1", "computer-1");
    expect(lastWrittenAgentsMd()).toContain("No skills assigned.");
  });
});

describe("regenerateWorkspaceMap — idempotent write", () => {
  it("skips both S3 PutObject calls when content is unchanged", async () => {
    // First render produces the canonical content.
    state.workflows = [
      {
        catalog_slug: "daily-digest",
        routine_schedule: null,
        display_name: "Daily Digest",
        description: "Summary",
        default_schedule: null,
      },
    ];
    await regenerateWorkspaceMap("agent-1", "computer-1");
    expect(s3Calls.puts.length).toBe(2); // AGENTS.md + CONTEXT.md
    const firstAgentsMd = lastWrittenAgentsMd()!;
    const firstContextMd =
      [...s3Calls.puts]
        .reverse()
        .find((p) => p.key === `${PREFIX}CONTEXT.md`)?.body ?? "";

    // Configure S3 to return the same body the renderer just wrote.
    state.s3GetResponses.set(`${PREFIX}AGENTS.md`, firstAgentsMd);
    state.s3GetResponses.set(`${PREFIX}CONTEXT.md`, firstContextMd);
    s3Calls.puts.length = 0;
    mockRegenerateManifest.mockReset();

    // Re-render with identical state — both writes should be skipped.
    await regenerateWorkspaceMap("agent-1", "computer-1");
    expect(s3Calls.puts.length).toBe(0);
    // Manifest regen also skipped (no-op render).
    expect(mockRegenerateManifest).not.toHaveBeenCalled();
  });

  it("writes when content differs from what's on S3", async () => {
    state.s3GetResponses.set(`${PREFIX}AGENTS.md`, "stale content");
    state.s3GetResponses.set(`${PREFIX}CONTEXT.md`, "stale content");
    state.workflows = [
      {
        catalog_slug: "daily-digest",
        routine_schedule: null,
        display_name: "Daily Digest",
        description: "Summary",
        default_schedule: null,
      },
    ];
    await regenerateWorkspaceMap("agent-1", "computer-1");
    expect(s3Calls.puts.length).toBe(2);
    expect(mockRegenerateManifest).toHaveBeenCalledTimes(1);
  });
});

describe("regenerateWorkspaceMap — Computer fallback resolution", () => {
  it("auto-resolves Computer from agentId when computerId is omitted", async () => {
    state.connectors = [
      {
        catalog_slug: "slack",
        display_name: "Slack",
        description: null,
        category: null,
      },
    ];
    await regenerateWorkspaceMap("agent-1");
    expect(lastWrittenAgentsMd()).toContain("| Slack | — | — |");
  });

  it("renders 'No connectors configured.' when no Computer found and no computerId given", async () => {
    state.computer = null;
    state.connectors = [
      {
        catalog_slug: "slack",
        display_name: "Slack",
        description: null,
        category: null,
      },
    ];
    await regenerateWorkspaceMap("agent-1");
    const md = lastWrittenAgentsMd();
    // Connectors section still rendered, but the connector list is empty
    // because the renderer skipped the connectors query.
    expect(md).toContain("## Connectors");
    expect(md).toContain("No connectors configured.");
    expect(md).not.toContain("| Slack |");
  });
});
