import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted state — drizzle table tag + db query dispatch + S3 spy
// ---------------------------------------------------------------------------

const {
  state,
  s3Calls,
  mockRegenerateManifest,
  mockRegenerateManifestForPrefix,
} = vi.hoisted(() => ({
  state: {
    agent: {
      name: "Acme Daily Digest",
      slug: "acme-daily-digest",
      tenant_id: "tenant-1",
    } as { name: string; slug: string; tenant_id: string } | null,
    space: null as {
      name: string;
      slug: string;
      tenant_id: string;
    } | null,
    tenantSlug: "acme",
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
    workflows: [] as Array<{
      catalog_slug: string | null;
      routine_schedule: string | null;
      display_name: string;
      description: string | null;
      default_schedule: string | null;
    }>,
    s3GetResponses: new Map<string, string | null | Error>(),
    listObjectsResponses: [] as string[],
  },
  s3Calls: {
    puts: [] as Array<{ key: string; body: string }>,
    gets: [] as string[],
    lists: [] as string[],
  },
  mockRegenerateManifest: vi.fn(),
  mockRegenerateManifestForPrefix: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send(cmd: {
      input?: { Bucket?: string; Key?: string; Body?: string; Prefix?: string };
      constructor: { name: string };
    }) {
      const name = cmd.constructor.name;
      const key = cmd.input?.Key ?? "";
      if (name === "PutObjectCommand") {
        s3Calls.puts.push({ key, body: cmd.input?.Body ?? "" });
        return {};
      }
      if (name === "GetObjectCommand") {
        s3Calls.gets.push(key);
        const value = state.s3GetResponses.get(key);
        if (value instanceof Error) {
          throw value;
        }
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
          Contents: state.listObjectsResponses.map((path) => ({
            Key: path.startsWith(prefix) ? path : `${prefix}${path}`,
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
    if (name === "spaces") return state.space ? [state.space] : [];
    if (name === "tenants") return [{ slug: state.tenantSlug }];
    if (name === "agent_skills") return state.skills;
    if (name === "agent_knowledge_bases") return state.knowledgeBases;
    if (name === "routines") return state.workflows;
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
  routines: tagTable("routines"),
  tenantWorkflowCatalog: tagTable("tenant_workflow_catalog"),
  spaces: tagTable("spaces"),
  tenants: tagTable("tenants"),
}));

vi.mock("../workspace-manifest.js", () => ({
  regenerateManifest: mockRegenerateManifest,
  regenerateManifestForPrefix: mockRegenerateManifestForPrefix,
}));

// drizzle-orm helpers — test cares about table dispatch only, not predicates.
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  asc: () => ({}),
  isNotNull: () => ({}),
}));

import {
  generateContextFolderStructure,
  generateContextFolderStructureForSpace,
  normalizeAgentsMd,
  regenerateAgentsMdDerivedSections,
  regenerateWorkspaceMap,
  replaceDerivedAgentsMdSections,
} from "../workspace-map-generator.js";

const PREFIX = "tenants/acme/agents/acme-daily-digest/workspace/";

function resetState(): void {
  state.agent = {
    name: "Acme Daily Digest",
    slug: "acme-daily-digest",
    tenant_id: "tenant-1",
  };
  state.space = null;
  state.tenantSlug = "acme";
  state.skills = [];
  state.knowledgeBases = [];
  state.workflows = [];
  state.s3GetResponses.clear();
  state.listObjectsResponses = [];
  s3Calls.puts.length = 0;
  s3Calls.gets.length = 0;
  s3Calls.lists.length = 0;
  mockRegenerateManifest.mockReset();
  mockRegenerateManifestForPrefix.mockReset();
}

function lastWrittenAgentsMd(path = "AGENTS.md"): string | null {
  const put = [...s3Calls.puts]
    .reverse()
    .find((p) => p.key === `${PREFIX}${path}`);
  return put?.body ?? null;
}

function lastWritten(path: string): string | null {
  const put = [...s3Calls.puts]
    .reverse()
    .find((p) => p.key === `${PREFIX}${path}`);
  return put?.body ?? null;
}

beforeEach(() => {
  resetState();
  process.env.WORKSPACE_BUCKET = "thinkwork-dev-workspace";
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
    expect(lastWrittenAgentsMd()).toContain("## Knowledge Bases");
    expect(lastWrittenAgentsMd()).toContain("No knowledge bases assigned.");
  });
});

describe("regenerateAgentsMdDerivedSections", () => {
  it("preserves custom AGENTS.md prose while replacing derived sections only", async () => {
    state.skills = [
      {
        skill_id: "editor-review",
        config: {},
        enabled: true,
      },
    ];
    state.listObjectsResponses = [
      "AGENTS.md",
      "CONTEXT.md",
      "skills/editor-review/SKILL.md",
      "alpha/CONTEXT.md",
      "alpha/notes.md",
    ];
    state.s3GetResponses.set(
      `${PREFIX}AGENTS.md`,
      [
        "# Acme Daily Digest — Workspace Map",
        "",
        "## Routing",
        "",
        "| Task | Go to | Read | Skills |",
        "| --- | --- | --- | --- |",
        "| Alpha work | alpha/ | alpha/CONTEXT.md | editor-review |",
        "",
        "## Folder Structure",
        "old folder section",
        "",
        "---",
        "",
        "## Custom Instructions",
        "",
        "Keep this operator-authored paragraph.",
        "",
        "## Skills & Tools",
        "old skill section",
      ].join("\n"),
    );
    state.s3GetResponses.set(
      `${PREFIX}alpha/CONTEXT.md`,
      "# Alpha\n\n## Skills & Tools\n\n| Skill | When |\n| --- | --- |\n| Editor Review | When editing |\n",
    );
    state.s3GetResponses.set(
      `${PREFIX}skills/editor-review/SKILL.md`,
      [
        "---",
        "name: editor-review",
        "display_name: Editor Review",
        "description: Review edited workspace files",
        "triggers:",
        "  - review edits",
        "---",
        "",
        "# Editor Review",
      ].join("\n"),
    );

    await regenerateAgentsMdDerivedSections("agent-1");

    const written = lastWrittenAgentsMd();
    expect(written).toContain("## Routing");
    expect(written).toContain("Keep this operator-authored paragraph.");
    expect(written).toContain("## Custom Instructions");
    expect(written).not.toContain("old folder section");
    expect(written).not.toContain("old skill section");
    expect(written).toContain("alpha/ ← Alpha");
    expect(written).toContain(
      "| Editor Review | Review edited workspace files | review edits |",
    );
    expect(s3Calls.puts.map((p) => p.key)).toEqual([`${PREFIX}AGENTS.md`]);
    expect(mockRegenerateManifest).toHaveBeenCalledTimes(1);
  });

  it("refreshes a nested AGENTS.md from that folder down", async () => {
    state.listObjectsResponses = [
      "AGENTS.md",
      "earnest-falcon-947/AGENTS.md",
      "earnest-falcon-947/CONTEXT.md",
      "earnest-falcon-947/skills/review/SKILL.md",
      "earnest-falcon-947/reports/CONTEXT.md",
      "earnest-falcon-947/reports/daily.md",
      "jovial-narwhal-612/CONTEXT.md",
    ];
    state.s3GetResponses.set(
      `${PREFIX}earnest-falcon-947/AGENTS.md`,
      [
        "# Nested custom map",
        "",
        "## Folder Structure",
        "old nested tree",
        "",
        "---",
        "",
        "## Local Notes",
        "Preserve this nested operator note.",
      ].join("\n"),
    );
    state.s3GetResponses.set(
      `${PREFIX}earnest-falcon-947/reports/CONTEXT.md`,
      "# Reports\n\nDaily reporting instructions.",
    );

    await regenerateAgentsMdDerivedSections(
      "agent-1",
      "earnest-falcon-947/AGENTS.md",
    );

    const written = lastWrittenAgentsMd("earnest-falcon-947/AGENTS.md");
    expect(written).toContain("# Nested custom map");
    expect(written).toContain("Preserve this nested operator note.");
    expect(written).not.toContain("old nested tree");
    expect(written).toContain("earnest-falcon-947/");
    expect(written).toContain("reports/ ← Reports");
    expect(written).toContain("skills/");
    expect(written).not.toContain("jovial-narwhal-612");
    expect(s3Calls.puts.map((p) => p.key)).toEqual([
      `${PREFIX}earnest-falcon-947/AGENTS.md`,
    ]);
    expect(mockRegenerateManifest).toHaveBeenCalledTimes(1);
  });

  it("seeds a blank nested AGENTS.md before adding derived sections", async () => {
    state.listObjectsResponses = [
      "earnest-falcon-947/AGENTS.md",
      "earnest-falcon-947/skills/review/SKILL.md",
    ];
    state.s3GetResponses.set(`${PREFIX}earnest-falcon-947/AGENTS.md`, "");

    await regenerateAgentsMdDerivedSections(
      "agent-1",
      "earnest-falcon-947/AGENTS.md",
    );

    const written = lastWrittenAgentsMd("earnest-falcon-947/AGENTS.md");
    expect(written).toContain("# earnest-falcon-947 — Workspace Map");
    expect(written).toContain("## Folder Structure");
    expect(written).toContain("skills/");
  });
});

describe("normalizeAgentsMd", () => {
  it("replaces a malformed AGENTS.md with the canonical template plus derived sections", async () => {
    state.listObjectsResponses = ["AGENTS.md", "memory/lessons.md"];
    state.s3GetResponses.set(`${PREFIX}AGENTS.md`, "not markdown at all");

    await normalizeAgentsMd("agent-1");

    const written = lastWrittenAgentsMd();
    expect(written).toContain("# AGENTS.md");
    expect(written).toContain("## Routing");
    expect(written).toContain("## ID & Naming Conventions");
    expect(written).toContain("## Folder Structure");
    expect(written).toContain("memory/");
    expect(written).not.toContain("not markdown at all");
    expect(s3Calls.puts.map((p) => p.key)).toEqual([`${PREFIX}AGENTS.md`]);
    expect(mockRegenerateManifest).toHaveBeenCalledTimes(1);
  });
});

describe("generateContextFolderStructure", () => {
  it("replaces only the nested CONTEXT.md folder structure from that folder down", async () => {
    state.listObjectsResponses = [
      "AGENTS.md",
      "CONTEXT.md",
      "community/CONTEXT.md",
      "community/docs/platforms.md",
      "community/docs/.gitkeep",
      "community/content/newsletters/welcome.md",
      "community/content/templates/CONTEXT.md",
      "sales/CONTEXT.md",
    ];
    state.s3GetResponses.set(
      `${PREFIX}community/CONTEXT.md`,
      [
        "# Community",
        "",
        "## What This Workspace Is",
        "",
        "Custom prose stays.",
        "",
        "## Folder Structure",
        "stale tree",
        "",
        "## Skills & Tools for This Workspace",
        "",
        "Keep this table.",
      ].join("\n"),
    );
    state.s3GetResponses.set(
      `${PREFIX}community/content/templates/CONTEXT.md`,
      "# Templates\n\nReusable content patterns.",
    );

    await generateContextFolderStructure("agent-1", "community/CONTEXT.md");

    const written = lastWritten("community/CONTEXT.md") ?? "";
    expect(written).toContain("# Community");
    expect(written).toContain("Custom prose stays.");
    expect(written).toContain("Keep this table.");
    expect(written).not.toContain("stale tree");
    expect(written).toContain("community/");
    expect(written).toContain("CONTEXT.md ← You are here");
    expect(written).toContain("content/");
    expect(written).toContain("templates/ ← Templates");
    expect(written).toContain("platforms.md");
    expect(written).not.toContain("sales/");
    expect(written).not.toContain(".gitkeep");
  });

  it("seeds a blank nested CONTEXT.md and appends a folder structure section", async () => {
    state.listObjectsResponses = [
      "earnest-falcon-947/CONTEXT.md",
      "earnest-falcon-947/skills/renewal-prep/SKILL.md",
    ];
    state.s3GetResponses.set(`${PREFIX}earnest-falcon-947/CONTEXT.md`, "");

    await generateContextFolderStructure(
      "agent-1",
      "earnest-falcon-947/CONTEXT.md",
    );

    const written = lastWritten("earnest-falcon-947/CONTEXT.md") ?? "";
    expect(written).toContain("# Earnest Falcon 947");
    expect(written).toContain("## Folder Structure");
    expect(written).toContain("earnest-falcon-947/");
    expect(written).toContain("CONTEXT.md ← You are here");
    expect(written).toContain("renewal-prep/");
  });

  it("renders root CONTEXT.md from the full workspace subtree", async () => {
    state.listObjectsResponses = [
      "CONTEXT.md",
      "community/CONTEXT.md",
      "community/docs/platforms.md",
      "memory/lessons.md",
    ];
    state.s3GetResponses.set(`${PREFIX}CONTEXT.md`, "# Root Context\n");
    state.s3GetResponses.set(`${PREFIX}community/CONTEXT.md`, "# Community\n");

    await generateContextFolderStructure("agent-1", "CONTEXT.md");

    const written = lastWritten("CONTEXT.md") ?? "";
    expect(written).toContain("acme-daily-digest/");
    expect(written).toContain("CONTEXT.md ← You are here");
    expect(written).toContain("community/ ← Community");
    expect(written).toContain("memory/ ← Long-lived agent memory");
  });

  it("appends a folder structure section when nonblank CONTEXT.md lacks one", async () => {
    state.listObjectsResponses = [
      "community/CONTEXT.md",
      "community/docs/platforms.md",
    ];
    state.s3GetResponses.set(
      `${PREFIX}community/CONTEXT.md`,
      "# Community\n\n## What This Workspace Is\n\nExisting prose.\n",
    );

    await generateContextFolderStructure("agent-1", "community/CONTEXT.md");

    const written = lastWritten("community/CONTEXT.md") ?? "";
    expect(written).toContain("Existing prose.");
    expect(written).toContain("---\n\n## Folder Structure");
    expect(written).toContain("platforms.md");
  });

  it("rethrows non-not-found reads before writing a seeded CONTEXT.md", async () => {
    state.listObjectsResponses = ["community/CONTEXT.md"];
    const err = new Error("access denied");
    err.name = "AccessDenied";
    state.s3GetResponses.set(`${PREFIX}community/CONTEXT.md`, err);

    await expect(
      generateContextFolderStructure("agent-1", "community/CONTEXT.md"),
    ).rejects.toThrow("access denied");
    expect(lastWritten("community/CONTEXT.md")).toBeNull();
  });

  it("surfaces manifest regeneration failures after writing", async () => {
    state.listObjectsResponses = ["community/CONTEXT.md"];
    state.s3GetResponses.set(`${PREFIX}community/CONTEXT.md`, "# Community\n");
    mockRegenerateManifest
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("manifest down"));

    await expect(
      generateContextFolderStructure("agent-1", "community/CONTEXT.md"),
    ).rejects.toThrow("manifest down");
    expect(lastWritten("community/CONTEXT.md")).toContain(
      "CONTEXT.md ← You are here",
    );
  });

  it("rejects non-CONTEXT.md paths", async () => {
    await expect(
      generateContextFolderStructure("agent-1", "community/README.md"),
    ).rejects.toThrow("CONTEXT.md path");
  });
});

describe("replaceDerivedAgentsMdSections", () => {
  it("replaces only derived section bodies and preserves hand-authored regions byte-identical", () => {
    const existing = [
      "# Acme Map",
      "",
      "## What This Is",
      "operator prose",
      "---",
      "",
      "## Folder Structure",
      "",
      "old tree",
      "---",
      "",
      "## Quick Navigation",
      "custom rows stay",
      "",
      "## Skills & Tools",
      "old skills",
      "",
      "## Token Management",
      "hand-written token rules",
      "",
    ].join("\n");

    const rendered = replaceDerivedAgentsMdSections(existing, {
      "Folder Structure": "\n```text\nfresh tree\n```\n",
      "Skills & Tools": "\nNo skills assigned.\n",
      "Knowledge Bases": "\nNo knowledge bases assigned.\n",
      Workflows: "\nNo workflows configured.\n",
    });

    expect(rendered).toContain("## Folder Structure");
    expect(rendered).toContain("```text\nfresh tree\n```");
    expect(rendered).not.toContain("old tree");
    expect(rendered).toContain(
      "## Skills & Tools\n\nNo skills assigned.\n## Token Management",
    );
    expect(rendered).toContain(
      "## Knowledge Bases\n\nNo knowledge bases assigned.",
    );
    expect(rendered).toContain("## Workflows\n\nNo workflows configured.");
    expect(rendered).toContain(
      "## What This Is\noperator prose\n---\n\n## Folder Structure",
    );
    expect(rendered).toContain(
      "## Quick Navigation\ncustom rows stay\n\n## Skills & Tools",
    );
    expect(
      rendered.endsWith("## Token Management\nhand-written token rules\n"),
    ).toBe(false);
    expect(rendered).toContain(
      "## Token Management\nhand-written token rules\n",
    );
  });

  it("appends absent derived sections in canonical order behind dividers", () => {
    const rendered = replaceDerivedAgentsMdSections(
      "# Map\n\n## What This Is\ncustom",
      {
        "Folder Structure": "\n```text\nroot/\n```\n",
        "Skills & Tools": "\nNo skills assigned.\n",
        "Knowledge Bases": "\nNo knowledge bases assigned.\n",
        Workflows: "\nNo workflows configured.\n",
      },
    );

    expect(rendered).toBe(
      [
        "# Map",
        "",
        "## What This Is",
        "custom",
        "---",
        "",
        "## Folder Structure",
        "",
        "```text",
        "root/",
        "```",
        "---",
        "",
        "## Skills & Tools",
        "",
        "No skills assigned.",
        "---",
        "",
        "## Knowledge Bases",
        "",
        "No knowledge bases assigned.",
        "---",
        "",
        "## Workflows",
        "",
        "No workflows configured.",
        "",
      ].join("\n"),
    );
  });

  it("does not preserve old leading blank lines when refreshing derived sections", () => {
    const existing = [
      "# Map",
      "",
      "## Folder Structure",
      "",
      "",
      "",
      "```text",
      "old tree",
      "```",
      "---",
      "",
      "## Skills & Tools",
      "",
      "",
      "",
      "No old skills.",
      "",
    ].join("\n");
    const sections = {
      "Folder Structure": "\n```text\nfresh tree\n```\n",
      "Skills & Tools": "\nNo skills assigned.\n",
      "Knowledge Bases": "\nNo knowledge bases assigned.\n",
      Workflows: "\nNo workflows configured.\n",
    };

    const once = replaceDerivedAgentsMdSections(existing, sections);
    const twice = replaceDerivedAgentsMdSections(once, sections);

    expect(twice).toBe(once);
    expect(once).toContain("## Folder Structure\n\n```text\nfresh tree\n```");
    expect(once).toContain("## Skills & Tools\n\nNo skills assigned.");
    expect(once).not.toContain("## Folder Structure\n\n\n");
    expect(once).not.toContain("## Skills & Tools\n\n\n");
  });
});

describe("regenerateWorkspaceMap — recursive folder tree", () => {
  it("renders full S3 workspace depth with annotations and hidden-file filtering", async () => {
    state.listObjectsResponses = [
      "AGENTS.md",
      "CONTEXT.md",
      "events/",
      "memory/.gitkeep",
      "review/run-1.md",
      "skills/account-health-review/SKILL.md",
      "earnest-falcon-947/CONTEXT.md",
      "earnest-falcon-947/.DS_Store",
      "earnest-falcon-947/skills/renewal-prep/SKILL.md",
    ];
    state.s3GetResponses.set(
      `${PREFIX}earnest-falcon-947/CONTEXT.md`,
      "# Earnest Falcon\n\n## Skills & Tools\n\n| Skill | Description |\n| --- | --- |\n| Renewal Prep | Prep |\n",
    );

    await regenerateWorkspaceMap("agent-1");
    const md = lastWrittenAgentsMd() ?? "";

    expect(md).toContain("acme-daily-digest/\n");
    expect(md).toContain("AGENTS.md ← You are here (always loaded)");
    expect(md).toContain("CONTEXT.md ← Task router");
    expect(md).toContain("events/ ← Event log");
    expect(md).toContain("memory/ ← Long-lived agent memory");
    expect(md).toContain("review/ ← Human review artifacts");
    expect(md).toContain("skills/ ← Workspace skills");
    expect(md).toContain("earnest-falcon-947/ ← Earnest Falcon");
    expect(md).toContain("renewal-prep/");
    expect(md).not.toContain(".gitkeep");
    expect(md).not.toContain(".DS_Store");
  });

  it("discovers both legacy flat and workspaces-parent subagent contexts during transition", async () => {
    state.listObjectsResponses = [
      "AGENTS.md",
      "legacy-flat/CONTEXT.md",
      "workspaces/sql/CONTEXT.md",
      "workspaces/sql/skills/snowflake/SKILL.md",
    ];
    state.s3GetResponses.set(
      `${PREFIX}legacy-flat/CONTEXT.md`,
      "# Legacy Flat\n\n## What This Workspace Is\nLegacy context.\n",
    );
    state.s3GetResponses.set(
      `${PREFIX}workspaces/sql/CONTEXT.md`,
      "# SQL\n\n## What This Workspace Is\nWarehouse context.\n",
    );

    await regenerateWorkspaceMap("agent-1");
    const md = lastWrittenAgentsMd() ?? "";
    const context = lastWritten("CONTEXT.md") ?? "";

    expect(md).toContain("legacy-flat/ ← Legacy Flat");
    expect(md).toContain("workspaces/");
    expect(md).toContain("sql/ ← SQL");
    expect(context).toContain("| Legacy Flat | Legacy context. |");
    expect(context).toContain("| SQL | Warehouse context. |");
  });

  it("prefers workspaces-parent context over legacy flat context for the same slug", async () => {
    state.listObjectsResponses = [
      "AGENTS.md",
      "expenses/CONTEXT.md",
      "workspaces/expenses/CONTEXT.md",
      "workspaces/expenses/reports/summary.md",
    ];
    state.s3GetResponses.set(
      `${PREFIX}expenses/CONTEXT.md`,
      "# Legacy Expenses\n\n## What This Workspace Is\nLegacy context.\n",
    );
    state.s3GetResponses.set(
      `${PREFIX}workspaces/expenses/CONTEXT.md`,
      "# Workspace Expenses\n\n## What This Workspace Is\nNew context.\n",
    );

    await regenerateWorkspaceMap("agent-1");
    const md = lastWrittenAgentsMd() ?? "";
    const context = lastWritten("CONTEXT.md") ?? "";

    expect(md).toContain("workspaces/");
    expect(md).toContain("expenses/ ← Workspace Expenses");
    expect(md).not.toContain("expenses/ ← Legacy Expenses");
    expect(context).toContain("| Workspace Expenses | New context. |");
    expect(context).not.toContain("| Legacy Expenses | Legacy context. |");
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
      [...s3Calls.puts].reverse().find((p) => p.key === `${PREFIX}CONTEXT.md`)
        ?.body ?? "";

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

describe("generateContextFolderStructureForSpace", () => {
  const SPACE_PREFIX = "tenants/acme/spaces/sales/source/";

  function lastWrittenSpace(path: string): string | null {
    const put = [...s3Calls.puts]
      .reverse()
      .find((p) => p.key === `${SPACE_PREFIX}${path}`);
    return put?.body ?? null;
  }

  beforeEach(() => {
    state.agent = null;
    state.space = { name: "Sales", slug: "sales", tenant_id: "tenant-1" };
  });

  it("renders the root Space subtree under the space slug", async () => {
    state.listObjectsResponses = [
      "CONTEXT.md",
      "memory/CONTEXT.md",
      "memory/lessons.md",
      "playbooks/intro.md",
    ];
    state.s3GetResponses.set(
      `${SPACE_PREFIX}CONTEXT.md`,
      "# Sales — Context\n",
    );
    state.s3GetResponses.set(`${SPACE_PREFIX}memory/CONTEXT.md`, "# Memory\n");

    await generateContextFolderStructureForSpace("space-1", "CONTEXT.md");

    const written = lastWrittenSpace("CONTEXT.md") ?? "";
    expect(written).toContain("sales/");
    expect(written).toContain("CONTEXT.md ← You are here");
    expect(written).toContain("memory/");
    expect(written).toContain("playbooks/");
    expect(written).not.toContain("# Acme Daily Digest");
  });

  it("scopes nested CONTEXT.md to its parent subtree", async () => {
    state.listObjectsResponses = [
      "CONTEXT.md",
      "memory/CONTEXT.md",
      "memory/lessons.md",
      "memory/playbooks/intro.md",
      "playbooks/elsewhere.md",
    ];
    state.s3GetResponses.set(
      `${SPACE_PREFIX}memory/CONTEXT.md`,
      "# Memory\n\n## Notes\n\nKeep this.\n",
    );

    await generateContextFolderStructureForSpace(
      "space-1",
      "memory/CONTEXT.md",
    );

    const written = lastWrittenSpace("memory/CONTEXT.md") ?? "";
    expect(written).toContain("Keep this.");
    expect(written).toContain("memory/");
    expect(written).toContain("CONTEXT.md ← You are here");
    expect(written).toContain("lessons.md");
    expect(written).toContain("playbooks/");
    expect(written).not.toContain("elsewhere.md");
  });

  it("seeds a blank Space CONTEXT.md with the Space name and folder structure", async () => {
    state.listObjectsResponses = ["CONTEXT.md", "playbooks/intro.md"];
    state.s3GetResponses.set(`${SPACE_PREFIX}CONTEXT.md`, "");

    await generateContextFolderStructureForSpace("space-1", "CONTEXT.md");

    const written = lastWrittenSpace("CONTEXT.md") ?? "";
    expect(written).toContain("# Sales — Context");
    expect(written).toContain("## Folder Structure");
    expect(written).toContain("sales/");
    expect(written).toContain("CONTEXT.md ← You are here");
    expect(written).toContain("playbooks/");
  });

  it("regenerates the Space prefix manifest and not the agent one", async () => {
    state.listObjectsResponses = ["CONTEXT.md"];
    state.s3GetResponses.set(
      `${SPACE_PREFIX}CONTEXT.md`,
      "# Sales — Context\n",
    );

    await generateContextFolderStructureForSpace("space-1", "CONTEXT.md");

    expect(mockRegenerateManifestForPrefix).toHaveBeenCalledTimes(1);
    expect(mockRegenerateManifestForPrefix.mock.calls[0]?.[1]).toBe(
      SPACE_PREFIX,
    );
    expect(mockRegenerateManifest).not.toHaveBeenCalled();
  });

  it("does not call any AGENTS.md derived-section refresh on Spaces", async () => {
    state.listObjectsResponses = ["CONTEXT.md"];
    state.s3GetResponses.set(
      `${SPACE_PREFIX}CONTEXT.md`,
      "# Sales — Context\n",
    );

    await generateContextFolderStructureForSpace("space-1", "CONTEXT.md");

    expect(s3Calls.puts.some((p) => p.key.endsWith("AGENTS.md"))).toBe(false);
  });

  it("rejects non-CONTEXT.md paths", async () => {
    await expect(
      generateContextFolderStructureForSpace("space-1", "memory/notes.md"),
    ).rejects.toThrow("CONTEXT.md path");
  });

  it("no-ops when the Space slug or tenant slug cannot be resolved", async () => {
    state.space = null;

    await generateContextFolderStructureForSpace("space-1", "CONTEXT.md");

    expect(s3Calls.puts).toEqual([]);
    expect(mockRegenerateManifestForPrefix).not.toHaveBeenCalled();
  });
});
