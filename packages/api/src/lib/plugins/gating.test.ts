/**
 * Unit tests for the shared plugin activation gate (plan 2026-06-12-001
 * U7): resolvePluginGate fail-closed semantics, folder/path exclusion
 * helpers, CONTEXT.md routing-entry filtering, and the deduplicated
 * TOOLS.md MCP policy chokepoint (behavior-preservation of the filters
 * previously inlined in chat-agent-invoke and wakeup-processor).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyWorkspaceMcpPolicyFilter,
  EMPTY_PLUGIN_GATE,
  FAIL_CLOSED_PLUGIN_GATE,
  filterContextRoutingEntries,
  isNamespacedPluginSkillPath,
  pluginGateExcludesWorkspacePath,
  pluginGateHasExclusions,
  resolvePluginGate,
  type PluginActivationGate,
  type PluginGateStore,
} from "./gating.js";
import {
  createInMemoryPluginEngineStore,
  type InMemoryPluginEngineStore,
} from "./testing.js";

const TENANT = "tenant-1";
const USER = "user-1";
const OTHER_USER = "user-2";

let store: InMemoryPluginEngineStore;

function seedInstall(args: {
  id: string;
  pluginKey: string;
  workspaceFolders?: string[] | null;
}): void {
  store.seedInstall({
    id: args.id,
    tenant_id: TENANT,
    plugin_key: args.pluginKey,
    state: "installed",
  });
  store.seedComponent({
    plugin_install_id: args.id,
    component_key: "skills",
    component_type: "skills",
    state: args.workspaceFolders ? "provisioned" : "pending",
    handler_ref:
      args.workspaceFolders === null
        ? {}
        : {
            seededCatalogPrefixes: [],
            workspaceFolders: args.workspaceFolders ?? [],
            agentSlug: "platform-agent",
          },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  store = createInMemoryPluginEngineStore();
});

describe("resolvePluginGate", () => {
  it("returns the empty gate when the tenant has no plugin installs", async () => {
    const gate = await resolvePluginGate(
      { tenantId: TENANT, requesterUserId: USER },
      { store },
    );
    expect(gate).toEqual(EMPTY_PLUGIN_GATE);
    expect(pluginGateHasExclusions(gate)).toBe(false);
  });

  it("allows installs the requester holds an ACTIVE activation for and blocks the rest", async () => {
    seedInstall({
      id: "install-a",
      pluginKey: "lastmile",
      workspaceFolders: ["skills/lastmile--crm/"],
    });
    seedInstall({
      id: "install-b",
      pluginKey: "twenty",
      workspaceFolders: ["skills/twenty--pipeline/"],
    });
    store.seedActivation({
      user_id: USER,
      plugin_install_id: "install-a",
    });

    const gate = await resolvePluginGate(
      { tenantId: TENANT, requesterUserId: USER },
      { store },
    );
    expect(gate.allowedInstallIds).toEqual(new Set(["install-a"]));
    expect(gate.blockedInstallIds).toEqual(new Set(["install-b"]));
    expect(gate.blockedSkillFolderPrefixes).toContain(
      "skills/twenty--pipeline/",
    );
    expect(gate.blockedSkillFolderPrefixes).toContain("skills/twenty--");
    expect(gate.blockedSkillFolderPrefixes).not.toContain(
      "skills/lastmile--crm/",
    );
    expect(gate.blockedSkillFolderPrefixes).not.toContain("skills/lastmile--");
  });

  it("non-active activation statuses (needs_reauth, revoked) do NOT allow the install", async () => {
    seedInstall({
      id: "install-a",
      pluginKey: "lastmile",
      workspaceFolders: ["skills/lastmile--crm/"],
    });
    store.seedActivation({
      user_id: USER,
      plugin_install_id: "install-a",
      status: "needs_reauth",
    });
    const gate = await resolvePluginGate(
      { tenantId: TENANT, requesterUserId: USER },
      { store },
    );
    expect(gate.allowedInstallIds.size).toBe(0);
    expect(gate.blockedSkillFolderPrefixes).toContain("skills/lastmile--crm/");
  });

  it("another user's activation never leaks into the requester's gate", async () => {
    seedInstall({
      id: "install-a",
      pluginKey: "lastmile",
      workspaceFolders: ["skills/lastmile--crm/"],
    });
    store.seedActivation({
      user_id: OTHER_USER,
      plugin_install_id: "install-a",
    });
    const gate = await resolvePluginGate(
      { tenantId: TENANT, requesterUserId: USER },
      { store },
    );
    expect(gate.allowedInstallIds.size).toBe(0);
    expect(gate.blockedInstallIds).toEqual(new Set(["install-a"]));
  });

  it("FAIL CLOSED: a null requester blocks every install", async () => {
    seedInstall({
      id: "install-a",
      pluginKey: "lastmile",
      workspaceFolders: ["skills/lastmile--crm/"],
    });
    store.seedActivation({ user_id: USER, plugin_install_id: "install-a" });

    const gate = await resolvePluginGate(
      { tenantId: TENANT, requesterUserId: null },
      { store },
    );
    expect(gate.allowedInstallIds.size).toBe(0);
    expect(gate.blockedSkillFolderPrefixes).toContain("skills/lastmile--crm/");
  });

  it("falls back to the plugin-key namespace pattern when handler_ref recorded no folders", async () => {
    seedInstall({
      id: "install-a",
      pluginKey: "lastmile",
      workspaceFolders: null, // pending provision — nothing recorded
    });
    const gate = await resolvePluginGate(
      { tenantId: TENANT, requesterUserId: USER },
      { store },
    );
    expect(gate.blockedSkillFolderPrefixes).toEqual([
      "skills/lastmile--",
      "skills/lastmile-",
    ]);
    expect(
      pluginGateExcludesWorkspacePath(gate, "skills/lastmile--crm/SKILL.md"),
    ).toBe(true);
    expect(
      pluginGateExcludesWorkspacePath(gate, "skills/lastmile-crm/SKILL.md"),
    ).toBe(true);
  });

  it("falls back closed for Agent Skills spec-compliant plugin skill folders", async () => {
    seedInstall({
      id: "install-a",
      pluginKey: "n8n",
      workspaceFolders: null, // pending provision — nothing recorded
    });
    const gate = await resolvePluginGate(
      { tenantId: TENANT, requesterUserId: USER },
      { store },
    );
    expect(gate.blockedSkillFolderPrefixes).toContain("skills/n8n-");
    expect(
      pluginGateExcludesWorkspacePath(
        gate,
        "skills/n8n-workflow-operator/SKILL.md",
      ),
    ).toBe(true);
  });

  it("FAIL CLOSED, never open: a store error degrades to pattern exclusion of all namespaced plugin folders", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwingStore: PluginGateStore = {
      listInstalls: async () => {
        throw new Error("db unavailable");
      },
      listComponents: async () => [],
      listActivationsForUser: async () => [],
    };
    const gate = await resolvePluginGate(
      { tenantId: TENANT, requesterUserId: USER },
      { store: throwingStore },
    );
    expect(gate).toEqual(FAIL_CLOSED_PLUGIN_GATE);
    expect(
      pluginGateExcludesWorkspacePath(gate, "skills/lastmile--crm/SKILL.md"),
    ).toBe(true);
    expect(
      pluginGateExcludesWorkspacePath(gate, "skills/notes-helper/SKILL.md"),
    ).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe("path helpers", () => {
  it("isNamespacedPluginSkillPath matches only legacy double-hyphen plugin folders", () => {
    expect(isNamespacedPluginSkillPath("skills/lastmile--crm/SKILL.md")).toBe(
      true,
    );
    expect(
      isNamespacedPluginSkillPath(
        "skills/n8n-workflow-operator/references/mcp-tooling.md",
      ),
    ).toBe(false);
    expect(isNamespacedPluginSkillPath("skills/notes-helper/SKILL.md")).toBe(
      false,
    );
    expect(isNamespacedPluginSkillPath("AGENTS.md")).toBe(false);
    expect(
      isNamespacedPluginSkillPath("workspaces/x/skills/lastmile--crm/y.md"),
    ).toBe(false);
  });

  it("pluginGateExcludesWorkspacePath only ever excludes under skills/", () => {
    const gate: PluginActivationGate = {
      hasPluginInstalls: true,
      allowedInstallIds: new Set(),
      blockedInstallIds: new Set(["install-a"]),
      blockedSkillFolderPrefixes: ["skills/lastmile--crm/"],
      blockAllNamespacedPluginFolders: false,
    };
    expect(
      pluginGateExcludesWorkspacePath(gate, "skills/lastmile--crm/SKILL.md"),
    ).toBe(true);
    expect(
      pluginGateExcludesWorkspacePath(gate, "skills/lastmile--crm/sub/a.md"),
    ).toBe(true);
    expect(pluginGateExcludesWorkspacePath(gate, "skills/other/SKILL.md")).toBe(
      false,
    );
    expect(pluginGateExcludesWorkspacePath(gate, "CONTEXT.md")).toBe(false);
    expect(pluginGateExcludesWorkspacePath(gate, "memory/MEMORY.md")).toBe(
      false,
    );
  });
});

describe("filterContextRoutingEntries", () => {
  const gate: PluginActivationGate = {
    hasPluginInstalls: true,
    allowedInstallIds: new Set(),
    blockedInstallIds: new Set(["install-a"]),
    blockedSkillFolderPrefixes: ["skills/lastmile--crm/"],
    blockAllNamespacedPluginFolders: false,
  };

  it("drops routing lines referencing blocked plugin skill folders, keeps everything else", () => {
    const content = [
      "# Context",
      "",
      "- For tasks covered by the `lastmile--crm` skill, read skills/lastmile--crm/SKILL.md and follow it.",
      "- For tasks covered by the `notes-helper` skill, read skills/notes-helper/SKILL.md and follow it.",
      "General prose stays.",
    ].join("\n");
    const result = filterContextRoutingEntries(content, gate);
    expect(result.changed).toBe(true);
    expect(result.content).not.toContain("lastmile--crm");
    expect(result.content).toContain("skills/notes-helper/SKILL.md");
    expect(result.content).toContain("General prose stays.");
  });

  it("is a no-op when no line references a blocked folder", () => {
    const content = "# Context\n\n- read skills/notes-helper/SKILL.md\n";
    const result = filterContextRoutingEntries(content, gate);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it("is a no-op for a gate without exclusions", () => {
    const content = "- read skills/lastmile--crm/SKILL.md\n";
    expect(
      filterContextRoutingEntries(content, EMPTY_PLUGIN_GATE).changed,
    ).toBe(false);
  });

  it("drops namespaced references under the degraded fail-closed gate", () => {
    const content = [
      "- read skills/lastmile--crm/SKILL.md",
      "- read skills/notes-helper/SKILL.md",
    ].join("\n");
    const result = filterContextRoutingEntries(
      content,
      FAIL_CLOSED_PLUGIN_GATE,
    );
    expect(result.changed).toBe(true);
    expect(result.content).toBe("- read skills/notes-helper/SKILL.md");
  });
});

describe("applyWorkspaceMcpPolicyFilter (deduplicated dispatch chokepoint)", () => {
  const configs = [
    { name: "github" },
    { name: "prod-db" },
    { name: "lastmile--crm" },
  ];

  it("null policy passes everything through (no rendered workspace)", () => {
    expect(applyWorkspaceMcpPolicyFilter(configs, null)).toEqual(configs);
    expect(applyWorkspaceMcpPolicyFilter(configs, undefined)).toEqual(configs);
  });

  it("drops blocklisted servers", () => {
    const filtered = applyWorkspaceMcpPolicyFilter(configs, {
      mcpAllowedServers: null,
      mcpBlockedServers: ["prod-db"],
    });
    expect(filtered.map((config) => config.name)).toEqual([
      "github",
      "lastmile--crm",
    ]);
  });

  it("an allowlist drops everything not on it", () => {
    const filtered = applyWorkspaceMcpPolicyFilter(configs, {
      mcpAllowedServers: ["github"],
      mcpBlockedServers: [],
    });
    expect(filtered.map((config) => config.name)).toEqual(["github"]);
  });

  it("blocklist wins over allowlist (matches the previous inline behavior)", () => {
    const filtered = applyWorkspaceMcpPolicyFilter(configs, {
      mcpAllowedServers: ["github", "prod-db"],
      mcpBlockedServers: ["prod-db"],
    });
    expect(filtered.map((config) => config.name)).toEqual(["github"]);
  });
});
