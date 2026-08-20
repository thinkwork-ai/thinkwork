import { describe, expect, it } from "vitest";

import {
  connectionsNamedByManifest,
  mcpServersInTools,
  narrowingFromManifest,
  parseMcpToolLabel,
  readConnectorOperationsFromWorkspace,
  readSidecarOperations,
  resolveToolScopeMode,
  scopeTools,
  type ScopableTool,
  type ScopeManifest,
} from "../src/runtime/tool-scope.js";

function mcpTool(server: string, operation: string): ScopableTool {
  return {
    name: `mcp_${server.replace(/[^a-zA-Z0-9_-]/g, "_")}_${operation}`,
    label: `${server}: ${operation}`,
  };
}

const platformTools: ScopableTool[] = [
  { name: "execute_code", label: "Execute code" },
  { name: "emit_json_render_ui", label: "Emit UI" },
  { name: "emit_analytics_chart" },
  { name: "workspace_skill", label: "Workspace skill" },
  { name: "mcp", label: "MCP proxy" },
];

describe("resolveToolScopeMode", () => {
  it("defaults to `all` when unset", () => {
    expect(resolveToolScopeMode({})).toBe("all");
  });

  it("accepts the known modes case-insensitively", () => {
    expect(resolveToolScopeMode({ TOOL_SCOPE_MODE: "manifest" })).toBe(
      "manifest",
    );
    expect(resolveToolScopeMode({ TOOL_SCOPE_MODE: " Manifest-Strict " })).toBe(
      "manifest-strict",
    );
    expect(resolveToolScopeMode({ TOOL_SCOPE_MODE: "all" })).toBe("all");
  });

  it("fails open to `all` on an unrecognized value", () => {
    expect(resolveToolScopeMode({ TOOL_SCOPE_MODE: "strict" })).toBe("all");
    expect(resolveToolScopeMode({ TOOL_SCOPE_MODE: "" })).toBe("all");
  });
});

describe("parseMcpToolLabel", () => {
  it("splits an MCP-built tool into server + operation", () => {
    expect(parseMcpToolLabel(mcpTool("twenty--crm", "execute_tool"))).toEqual({
      server: "twenty--crm",
      operation: "execute_tool",
    });
  });

  it("refuses non-MCP tools and manifest binding wrappers", () => {
    expect(parseMcpToolLabel({ name: "execute_code" })).toBeNull();
    expect(
      parseMcpToolLabel({ name: "read", label: "Read a file" }),
    ).toBeNull();
    expect(
      parseMcpToolLabel({
        name: "crm_list_deals",
        label: "twenty--crm: list_deals (binding)",
      }),
    ).toBeNull();
    // Same label shape but not an mcp_-named tool — not the MCP surface.
    expect(
      parseMcpToolLabel({ name: "custom_tool", label: "server: op" }),
    ).toBeNull();
  });
});

describe("scopeTools — mode `all` (default, ships dark)", () => {
  it("is a byte-for-byte no-op", () => {
    const tools = [
      ...platformTools,
      mcpTool("brain", "brain_ask"),
      mcpTool("brain", "brain_search"),
      mcpTool("linear", "list_issues"),
    ];
    const result = scopeTools({ mode: "all", tools, manifest: null });
    expect(result.after).toBe(tools.length);
    expect(result.tools).toEqual(tools);
    expect(result.droppedNames).toEqual([]);
    expect(result.connections).toEqual([]);
  });

  it("is a no-op even when the manifest narrows the connection", () => {
    const manifest: ScopeManifest = {
      active: [
        {
          name: "brain_ask_binding",
          class: "tool",
          kind: "binding",
          connection: "brain",
          operation: "brain_ask",
        },
      ],
    };
    const tools = [mcpTool("brain", "brain_ask"), mcpTool("brain", "brain_x")];
    expect(scopeTools({ mode: "all", tools, manifest }).after).toBe(2);
  });
});

describe("scopeTools — mode `manifest`", () => {
  const manifest: ScopeManifest = {
    active: [
      { name: "brain", class: "connection", slug: "brain" },
      {
        name: "ask_the_brain",
        class: "tool",
        kind: "binding",
        connection: "brain",
        operation: "brain_ask",
      },
      {
        name: "search_the_brain",
        class: "tool",
        kind: "binding",
        connection: "brain",
        operation: "brain_search",
      },
      { name: "read", class: "builtin" },
      {
        name: "make_slides",
        class: "tool",
        kind: "script",
        entry: "run.py",
      },
    ],
  };

  it("keeps only the granted operations of a narrowed connection", () => {
    const tools = [
      ...platformTools,
      mcpTool("brain", "brain_ask"),
      mcpTool("brain", "brain_search"),
      mcpTool("brain", "brain_counts"),
      mcpTool("brain", "catalog_lineage"),
    ];
    const result = scopeTools({ mode: "manifest", tools, manifest });
    expect(result.droppedNames).toEqual(
      ["mcp_brain_catalog_lineage", "mcp_brain_brain_counts"].sort(),
    );
    expect(result.after).toBe(tools.length - 2);
    expect(result.connections).toEqual([
      { server: "brain", kept: 2, dropped: 2, reason: "narrowed" },
    ]);
  });

  it("never drops platform, builtin, or manifest capability tools", () => {
    const tools = [...platformTools, mcpTool("brain", "brain_counts")];
    const result = scopeTools({ mode: "manifest", tools, manifest });
    for (const tool of platformTools) {
      expect(result.tools).toContain(tool);
    }
  });

  it("leaves a connection nobody narrowed completely alone", () => {
    const tools = [
      mcpTool("linear", "list_issues"),
      mcpTool("linear", "save_issue"),
      mcpTool("linear", "get_team"),
    ];
    const result = scopeTools({ mode: "manifest", tools, manifest });
    expect(result.after).toBe(3);
    expect(result.connections).toEqual([
      { server: "linear", kept: 3, dropped: 0, reason: "no_narrowing" },
    ]);
  });

  it("applies a connector sidecar allowlist on top of the manifest", () => {
    const tools = [
      mcpTool("linear", "list_issues"),
      mcpTool("linear", "save_issue"),
      mcpTool("linear", "get_team"),
    ];
    const result = scopeTools({
      mode: "manifest",
      tools,
      manifest,
      sidecarOperations: new Map([["linear", ["list_issues"]]]),
    });
    expect(result.after).toBe(1);
    expect(result.tools[0]!.name).toBe("mcp_linear_list_issues");
    expect(result.connections).toEqual([
      { server: "linear", kept: 1, dropped: 2, reason: "narrowed" },
    ]);
  });

  it("unions the manifest and sidecar grants rather than intersecting them", () => {
    const tools = [
      mcpTool("brain", "brain_ask"),
      mcpTool("brain", "brain_counts"),
      mcpTool("brain", "catalog_lineage"),
    ];
    const result = scopeTools({
      mode: "manifest",
      tools,
      manifest,
      sidecarOperations: new Map([["brain", ["brain_counts"]]]),
    });
    expect(result.droppedNames).toEqual(["mcp_brain_catalog_lineage"]);
  });

  it("is a no-op with no manifest and no sidecars", () => {
    const tools = [mcpTool("brain", "brain_ask"), ...platformTools];
    const result = scopeTools({ mode: "manifest", tools, manifest: null });
    expect(result.after).toBe(tools.length);
    expect(result.droppedNames).toEqual([]);
  });
});

describe("scopeTools — mode `manifest-strict`", () => {
  const manifest: ScopeManifest = {
    active: [
      { name: "brain", class: "connection", slug: "brain" },
      {
        name: "ask_the_brain",
        class: "tool",
        kind: "binding",
        connection: "brain",
        operation: "brain_ask",
      },
    ],
  };

  it("drops the whole MCP surface of a connection the manifest never names", () => {
    const tools = [
      ...platformTools,
      mcpTool("brain", "brain_ask"),
      mcpTool("linear", "list_issues"),
      mcpTool("linear", "get_team"),
    ];
    const result = scopeTools({ mode: "manifest-strict", tools, manifest });
    expect(result.droppedNames).toEqual([
      "mcp_linear_get_team",
      "mcp_linear_list_issues",
    ]);
    expect(result.connections).toEqual([
      { server: "brain", kept: 1, dropped: 0, reason: "narrowed" },
      { server: "linear", kept: 0, dropped: 2, reason: "not_in_manifest" },
    ]);
  });

  it("keeps a manifest-named connection that carries no narrowing", () => {
    const namedOnly: ScopeManifest = {
      active: [{ name: "linear", class: "connection", slug: "linear" }],
    };
    const tools = [mcpTool("linear", "list_issues"), mcpTool("linear", "x")];
    const result = scopeTools({
      mode: "manifest-strict",
      tools,
      manifest: namedOnly,
    });
    expect(result.after).toBe(2);
    expect(result.connections[0]!.reason).toBe("no_narrowing");
  });

  it("stays a no-op when the manifest names no connections at all", () => {
    const empty: ScopeManifest = {
      active: [{ name: "read", class: "builtin" }],
    };
    const tools = [mcpTool("linear", "list_issues")];
    expect(
      scopeTools({ mode: "manifest-strict", tools, manifest: empty }).after,
    ).toBe(1);
  });
});

describe("manifest readers", () => {
  it("collects binding narrowings and named connections", () => {
    const manifest: ScopeManifest = {
      active: [
        { name: "gh", class: "connection", slug: "github" },
        {
          name: "t1",
          class: "tool",
          kind: "binding",
          connection: "gh",
          operation: "a",
        },
        {
          name: "t2",
          class: "tool",
          kind: "binding",
          connection: "gh",
          operation: "b",
        },
        { name: "t3", class: "tool", kind: "script", entry: "x.py" },
      ],
    };
    expect([...narrowingFromManifest(manifest).get("gh")!.operations]).toEqual([
      "a",
      "b",
    ]);
    expect([...connectionsNamedByManifest(manifest)].sort()).toEqual([
      "gh",
      "github",
    ]);
  });

  it("tolerates a null or malformed manifest", () => {
    expect(narrowingFromManifest(null).size).toBe(0);
    expect(
      connectionsNamedByManifest({ active: [] } as ScopeManifest).size,
    ).toBe(0);
  });
});

describe("connector sidecar reads", () => {
  const files = new Map<string, string>([
    [
      "/ws/connectors/linear/.assignment.json",
      JSON.stringify({ permissions: { operations: ["list_issues"] } }),
    ],
    [
      "/ws/connections/legacy/.assignment.json",
      JSON.stringify({ permissions: { operations: ["old_op"] } }),
    ],
    ["/ws/connectors/empty/.assignment.json", JSON.stringify({})],
    ["/ws/connectors/broken/.assignment.json", "{not json"],
    [
      "/ws/connectors/all/.assignment.json",
      JSON.stringify({ permissions: { operations: [] } }),
    ],
  ]);
  const readTextFile = async (p: string) => files.get(p) ?? null;

  it("reads permissions.operations, preferring connectors/ over connections/", async () => {
    await expect(
      readConnectorOperationsFromWorkspace("/ws", "linear", { readTextFile }),
    ).resolves.toEqual(["list_issues"]);
    await expect(
      readConnectorOperationsFromWorkspace("/ws", "legacy", { readTextFile }),
    ).resolves.toEqual(["old_op"]);
  });

  it("treats missing, empty, and malformed sidecars as no narrowing", async () => {
    for (const slug of ["absent", "empty", "broken", "all"]) {
      await expect(
        readConnectorOperationsFromWorkspace("/ws", slug, { readTextFile }),
      ).resolves.toBeNull();
    }
  });

  it("builds a per-server map, omitting servers without a narrowing", async () => {
    const map = await readSidecarOperations("/ws", ["linear", "absent"], {
      readTextFile,
    });
    expect([...map.keys()]).toEqual(["linear"]);
  });
});

describe("mcpServersInTools", () => {
  it("lists the distinct MCP servers behind an assembled tool list", () => {
    expect(
      mcpServersInTools([
        ...platformTools,
        mcpTool("brain", "a"),
        mcpTool("brain", "b"),
        mcpTool("linear", "c"),
      ]),
    ).toEqual(["brain", "linear"]);
  });
});
