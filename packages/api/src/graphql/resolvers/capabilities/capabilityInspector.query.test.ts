/**
 * capabilityInspector resolver tests (capability-mapping plan U3).
 *
 * The composer itself (resolveAgentRuntimeConfig, buildMcpConfigs probe
 * mode, renderWorkspaceTuple persist:false) has its own suites; these tests
 * cover the inspector's contract: authz, selection validation, perspective
 * semantics, item assembly with verbatim reasons, inventory diffing, and
 * fingerprint stability.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rowsQueue,
  mockRequireAdminOrServiceCaller,
  mockResolveAgentRuntimeConfig,
  mockRenderWorkspaceTuple,
  mockResolvePluginGate,
} = vi.hoisted(() => ({
  rowsQueue: [] as unknown[][],
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockResolveAgentRuntimeConfig: vi.fn(),
  mockRenderWorkspaceTuple: vi.fn(),
  mockResolvePluginGate: vi.fn(),
}));

function takeRows(): unknown[] {
  return rowsQueue.shift() ?? [];
}

function chainResult() {
  const promise = Promise.resolve(takeRows());
  const chain = {
    limit: () => promise,
    orderBy: () => chain,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  return chain;
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => chainResult() }) }),
  },
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
  desc: (col: unknown) => ({ op: "desc", col }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
  resolvedCapabilityManifests: {
    id: "rcm.id",
    tenant_id: "rcm.tenant_id",
    agent_id: "rcm.agent_id",
    space_id: "rcm.space_id",
    agent_profile_id: "rcm.agent_profile_id",
    config_fingerprint: "rcm.config_fingerprint",
    manifest_json: "rcm.manifest_json",
    created_at: "rcm.created_at",
  },
  agents: {
    id: "agents.id",
    tenant_id: "agents.tenant_id",
    is_platform_default: "agents.is_platform_default",
  },
  spaces: {
    id: "spaces.id",
    tenant_id: "spaces.tenant_id",
    name: "spaces.name",
  },
  users: { id: "users.id", tenant_id: "users.tenant_id" },
  agentProfiles: {
    id: "agentProfiles.id",
    tenant_id: "agentProfiles.tenant_id",
    slug: "agentProfiles.slug",
    name: "agentProfiles.name",
  },
  skillCatalog: {
    slug: "skillCatalog.slug",
    display_name: "skillCatalog.display_name",
    tenant_id: "skillCatalog.tenant_id",
  },
  tenantMcpServers: {
    slug: "tenantMcpServers.slug",
    name: "tenantMcpServers.name",
    status: "tenantMcpServers.status",
    enabled: "tenantMcpServers.enabled",
    tenant_id: "tenantMcpServers.tenant_id",
  },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  pluginInstalls: {
    id: "pluginInstalls.id",
    tenant_id: "pluginInstalls.tenant_id",
    plugin_key: "pluginInstalls.plugin_key",
    state: "pluginInstalls.state",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("../../../lib/resolve-agent-runtime-config.js", () => ({
  resolveAgentRuntimeConfig: mockResolveAgentRuntimeConfig,
}));

vi.mock("../../../lib/workspace-renderer/compose-tuple.js", () => ({
  renderWorkspaceTuple: mockRenderWorkspaceTuple,
}));

vi.mock("../../../lib/plugins/gating.js", () => ({
  resolvePluginGate: mockResolvePluginGate,
}));

import { capabilityInspector } from "./capabilityInspector.query.js";
import type { GraphQLContext } from "../../context.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const SPACE_ID = "33333333-3333-3333-3333-333333333333";
const PROFILE_ID = "44444444-4444-4444-4444-444444444444";
const USER_X = "55555555-5555-5555-5555-555555555555";

const ctx = {} as GraphQLContext;

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    tenantSlug: "acme",
    agentId: AGENT_ID,
    agentName: "Ada",
    agentSlug: "ada",
    agentSystemPrompt: null,
    humanName: undefined,
    humanPairId: null,
    templateId: null,
    templateModel: "us.anthropic.claude-sonnet-4-6",
    budgetMonthlyCents: null,
    budgetPaused: false,
    blockedTools: [],
    sandboxTemplate: null,
    browserAutomationEnabled: false,
    threadJsonRenderUiEnabled: false,
    contextEngineEnabled: false,
    guardrailId: null,
    guardrailConfig: undefined,
    runtimeType: "pi",
    skillsConfig: [
      {
        skillId: "approve-receipt",
        s3Key: "tenants/acme/agents/ada/skills/approve-receipt",
      },
      {
        skillId: "ratio-review",
        s3Key: "tenants/acme/spaces/customer/skills/ratio-review",
      },
      {
        skillId: "web-search",
        s3Key: "tenants/acme/skill-catalog/web-search",
      },
    ],
    trustedSkillIds: ["approve-receipt", "ratio-review", "web-search"],
    knowledgeBasesConfig: undefined,
    mcpConfigs: [
      {
        name: "github",
        url: "https://mcp.example/github",
        transport: "streamable-http",
        tokenStatus: "active",
      },
      {
        name: "prod-db",
        url: "https://mcp.example/prod-db",
        transport: "streamable-http",
        tokenStatus: "configured",
      },
    ],
    piExtensions: [
      {
        extensionId: "ext-1",
        versionId: "ver-1",
        assignmentId: "assignment-1",
        sourceId: "ext-1",
        name: "github_tools",
        displayName: "GitHub Tools",
        repositoryUrl: "https://github.com/acme/github-tools",
        repositoryOwner: "acme",
        repositoryName: "github-tools",
        sourceRef: "main",
        commitSha: "abc",
        manifestHash: "mh",
        artifactHash: "ah",
        artifactUri: "uri",
        runtimeTarget: "agentcore-pi",
        targetType: "default_agent",
        agentProfileId: null,
        toolNames: ["search_issues"],
        lifecycleHooks: [],
        permissionClasses: [],
        grantedPermissionClasses: [],
      },
    ],
    agentProfilesConfig: [
      {
        id: PROFILE_ID,
        slug: "coding",
        name: "Coding",
        description: null,
        routingGuidance: null,
        instructions: "Code.",
        modelId: "model-1",
        builtInKey: null,
        enabled: true,
        availability: { scope: "global", spaceIds: [] },
        sourceSpaceId: null,
        shadowedCentralProfileId: null,
        builtInTools: ["bash"],
        mcpServers: [
          {
            id: "mcp-1",
            slug: "github",
            name: "GitHub",
            availableTools: ["search_issues", "create_issue"],
            allowedTools: ["search_issues"],
          },
        ],
        mcpToolAllowlist: { github: ["search_issues"] },
        skillSlugs: ["approve-receipt", "not-on-agent"],
        piExtensions: [],
        executionControls: {},
      },
    ],
    capabilityDiagnostics: [],
    ...overrides,
  };
}

const EMPTY_GATE = {
  hasPluginInstalls: false,
  allowedInstallIds: new Set<string>(),
  blockedInstallIds: new Set<string>(),
  blockedSkillFolderPrefixes: [],
  blockAllNamespacedPluginFolders: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  rowsQueue.length = 0;
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
  mockResolveAgentRuntimeConfig.mockResolvedValue(baseConfig());
  mockRenderWorkspaceTuple.mockResolvedValue({
    effectivePolicy: {
      blockedTools: [],
      allowedTools: null,
      mcpBlockedServers: [],
      mcpAllowedServers: null,
      modelRouting: [],
      diagnostics: [],
    },
  });
  mockResolvePluginGate.mockResolvedValue(EMPTY_GATE);
});

/** Stage the selection lookups + inventory queries for a happy-path call. */
function stageHappyPath(opts: { agentArg?: boolean; spaceArg?: boolean } = {}) {
  if (opts.agentArg !== false) {
    rowsQueue.push([{ id: AGENT_ID }]); // agent lookup
  } else {
    rowsQueue.push([{ id: AGENT_ID }]); // platform-default lookup
  }
  if (opts.spaceArg) rowsQueue.push([{ id: SPACE_ID, name: "Customer" }]);
  // inventory: catalog, mcp registry, plugin installs
  rowsQueue.push([
    { slug: "approve-receipt", display_name: "Approve Receipt" },
    { slug: "never-installed", display_name: "Never Installed" },
  ]);
  rowsQueue.push([
    { slug: "github", name: "GitHub", status: "approved", enabled: true },
    { slug: "pending-crm", name: "CRM", status: "pending", enabled: true },
  ]);
  rowsQueue.push([]);
}

describe("authz + selection validation", () => {
  it("non-operator caller → authz rejection propagates", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValue(new Error("forbidden"));
    await expect(
      capabilityInspector(null, { tenantId: TENANT_ID }, ctx),
    ).rejects.toThrow("forbidden");
  });

  it("cross-tenant agent id → invalid_selection (fail closed, no existence leak)", async () => {
    rowsQueue.push([]); // agent lookup finds nothing in caller's tenant
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: "99999999-9999-9999-9999-999999999999" },
      ctx,
    );
    expect(res.state).toBe("invalid_selection");
    expect(res.predicted).toBeNull();
  });

  it("nonexistent space → invalid_selection, never the base-agent fallback", async () => {
    rowsQueue.push([{ id: AGENT_ID }]); // agent
    rowsQueue.push([]); // space lookup empty
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID, spaceId: SPACE_ID },
      ctx,
    );
    expect(res.state).toBe("invalid_selection");
    expect(res.stateDetail).toContain("space");
    expect(mockResolveAgentRuntimeConfig).not.toHaveBeenCalled();
  });

  it("perspective user outside the tenant → invalid_selection", async () => {
    rowsQueue.push([{ id: AGENT_ID }]); // agent
    rowsQueue.push([]); // user lookup empty
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID, perspectiveUserId: USER_X },
      ctx,
    );
    expect(res.state).toBe("invalid_selection");
  });

  it("no agentId → resolves the tenant platform default agent (R4)", async () => {
    stageHappyPath({ agentArg: false });
    const res = await capabilityInspector(null, { tenantId: TENANT_ID }, ctx);
    expect(res.state).toBe("ok");
    expect(res.agentId).toBe(AGENT_ID);
  });
});

describe("perspective semantics (KTD-4)", () => {
  it("no perspective user → noUserBaseline, resolver called with no currentUserId", async () => {
    stageHappyPath();
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID },
      ctx,
    );
    expect(res.noUserBaseline).toBe(true);
    expect(mockResolveAgentRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        currentUserId: undefined,
        collectDiagnostics: true,
        mcpTokenMode: "probe",
      }),
    );
  });

  it("perspective user → validated and passed through as currentUserId", async () => {
    rowsQueue.push([{ id: AGENT_ID }]); // agent
    rowsQueue.push([{ id: USER_X }]); // user
    rowsQueue.push([]); // catalog
    rowsQueue.push([]); // mcp inventory
    rowsQueue.push([]); // plugin installs
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID, perspectiveUserId: USER_X },
      ctx,
    );
    expect(res.noUserBaseline).toBe(false);
    expect(mockResolveAgentRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ currentUserId: USER_X }),
    );
    expect(mockResolvePluginGate).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      requesterUserId: USER_X,
    });
  });
});

describe("item assembly", () => {
  it("active items carry provenance; drops render verbatim reasons; inventory diff adds not_installed", async () => {
    mockResolveAgentRuntimeConfig.mockResolvedValue(
      baseConfig({
        capabilityDiagnostics: [
          {
            capabilityClass: "agent_profile",
            capabilityId: "research",
            displayName: "Research",
            reason: "shadowed_by_space_local",
            detail: "central profile shadowed",
          },
          {
            capabilityClass: "pi_extension",
            capabilityId: "assignment-9",
            reason: "extension_validation_failed",
            detail: "verification artifact hash is stale",
          },
        ],
      }),
    );
    stageHappyPath();
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID },
      ctx,
    );
    const items = res.predicted?.items ?? [];

    const skill = items.find((i) => i.capabilityId === "approve-receipt");
    expect(skill).toMatchObject({
      capabilityClass: "skill",
      active: true,
      provenance: "agent: workspace folder",
    });
    const spaceSkill = items.find((i) => i.capabilityId === "ratio-review");
    expect(spaceSkill?.provenance).toBe("space: skills folder");
    const builtin = items.find((i) => i.capabilityId === "web-search");
    expect(builtin?.capabilityClass).toBe("builtin_tool");

    const mcp = items.find((i) => i.capabilityId === "github");
    expect(mcp).toMatchObject({ active: true, tokenStatus: "active" });

    expect(items).toContainEqual(
      expect.objectContaining({
        capabilityId: "research",
        active: false,
        reason: "shadowed_by_space_local",
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        capabilityId: "assignment-9",
        reason: "extension_validation_failed",
        detail: "verification artifact hash is stale",
      }),
    );

    // AE1: never-installed catalog skill surfaces via the inventory diff.
    expect(items).toContainEqual(
      expect.objectContaining({
        capabilityId: "never-installed",
        active: false,
        reason: "not_installed",
      }),
    );
    // Unapproved registry server surfaces with its status.
    expect(items).toContainEqual(
      expect.objectContaining({
        capabilityId: "pending-crm",
        active: false,
        reason: "not_installed",
        detail: expect.stringContaining("pending"),
      }),
    );
  });

  it("workspace MCP policy marks blocked servers blocked_by_policy (space selection)", async () => {
    mockRenderWorkspaceTuple.mockResolvedValue({
      effectivePolicy: {
        blockedTools: [],
        allowedTools: null,
        mcpBlockedServers: ["prod-db"],
        mcpAllowedServers: null,
        modelRouting: [],
        diagnostics: [],
      },
    });
    stageHappyPath({ spaceArg: true });
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID, spaceId: SPACE_ID },
      ctx,
    );
    expect(mockRenderWorkspaceTuple).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: SPACE_ID }),
      { persist: false },
    );
    const prodDb = res.predicted?.items.find(
      (i) => i.capabilityId === "prod-db",
    );
    expect(prodDb).toMatchObject({
      active: false,
      reason: "blocked_by_policy",
    });
  });

  it("plugin gate exclusions render as inactive plugin rows", async () => {
    mockResolvePluginGate.mockResolvedValue({
      hasPluginInstalls: true,
      allowedInstallIds: new Set<string>(),
      blockedInstallIds: new Set(["install-1"]),
      blockedSkillFolderPrefixes: ["skills/lastmile--crm-basics/"],
      blockAllNamespacedPluginFolders: false,
    });
    stageHappyPath();
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID },
      ctx,
    );
    expect(res.predicted?.items).toContainEqual(
      expect.objectContaining({
        capabilityClass: "plugin",
        capabilityId: "skills/lastmile--crm-basics/",
        active: false,
        reason: "plugin_activation_missing",
      }),
    );
  });
});

describe("profile selection", () => {
  function stageProfileSelection() {
    rowsQueue.push([{ id: AGENT_ID }]); // agent
    rowsQueue.push([{ id: PROFILE_ID, slug: "coding", name: "Coding" }]); // profile
    rowsQueue.push([]); // catalog
    rowsQueue.push([]); // mcp inventory
    rowsQueue.push([]); // plugin installs
  }

  it("active profile → the profile's granted subset with per-item provenance", async () => {
    stageProfileSelection();
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID, agentProfileId: PROFILE_ID },
      ctx,
    );
    expect(res.state).toBe("ok");
    const items = res.predicted?.items ?? [];
    expect(items).toContainEqual(
      expect.objectContaining({
        capabilityClass: "builtin_tool",
        capabilityId: "bash",
        provenance: "agent profile coding: tool_policy",
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        capabilityClass: "mcp_server",
        capabilityId: "github",
        detail: expect.stringContaining("search_issues"),
      }),
    );
    // Subset-constraint honesty: a skill_policy slug the agent lacks is inactive.
    expect(items).toContainEqual(
      expect.objectContaining({
        capabilityClass: "skill",
        capabilityId: "not-on-agent",
        active: false,
        reason: "not_installed",
      }),
    );
  });

  it("dropped profile → its drop-reason rows only", async () => {
    mockResolveAgentRuntimeConfig.mockResolvedValue(
      baseConfig({
        agentProfilesConfig: [],
        capabilityDiagnostics: [
          {
            capabilityClass: "agent_profile",
            capabilityId: "coding",
            displayName: "Coding",
            reason: "profile_disabled",
          },
        ],
      }),
    );
    stageProfileSelection();
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID, agentProfileId: PROFILE_ID },
      ctx,
    );
    expect(res.state).toBe("ok");
    expect(res.predicted?.items).toEqual([
      expect.objectContaining({
        capabilityId: "coding",
        active: false,
        reason: "profile_disabled",
      }),
    ]);
  });

  it("profile neither active nor dropped → invalid_selection", async () => {
    mockResolveAgentRuntimeConfig.mockResolvedValue(
      baseConfig({ agentProfilesConfig: [], capabilityDiagnostics: [] }),
    );
    rowsQueue.push([{ id: AGENT_ID }]); // agent
    rowsQueue.push([{ id: PROFILE_ID, slug: "coding", name: "Coding" }]); // profile
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID, agentProfileId: PROFILE_ID },
      ctx,
    );
    expect(res.state).toBe("invalid_selection");
  });
});

describe("fingerprint + fault states", () => {
  it("same fixture twice → identical configFingerprint; config change → different", async () => {
    stageHappyPath();
    const first = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID },
      ctx,
    );
    stageHappyPath();
    const second = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID },
      ctx,
    );
    expect(first.predicted?.configFingerprint).toBe(
      second.predicted?.configFingerprint,
    );

    mockResolveAgentRuntimeConfig.mockResolvedValue(
      baseConfig({ blockedTools: ["artifacts"] }),
    );
    stageHappyPath();
    const third = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID },
      ctx,
    );
    expect(third.predicted?.configFingerprint).not.toBe(
      first.predicted?.configFingerprint,
    );
  });

  it("resolver throw → resolution_fault state, not a 500", async () => {
    rowsQueue.push([{ id: AGENT_ID }]); // agent
    mockResolveAgentRuntimeConfig.mockRejectedValue(
      new Error("db unavailable"),
    );
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID },
      ctx,
    );
    expect(res.state).toBe("resolution_fault");
    expect(res.stateDetail).toContain("db unavailable");
    expect(res.predicted).toBeNull();
  });

  it("render failure degrades to a policy-unavailable diagnostic, not a fault", async () => {
    mockRenderWorkspaceTuple.mockRejectedValue(new Error("no baseline"));
    stageHappyPath({ spaceArg: true });
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID, spaceId: SPACE_ID },
      ctx,
    );
    expect(res.state).toBe("ok");
    expect(res.predicted?.items).toContainEqual(
      expect.objectContaining({
        capabilityClass: "context",
        capabilityId: "workspace-policy",
        reason: "resolution_fault",
      }),
    );
  });
});

describe("observed set + divergence (U13)", () => {
  function manifestRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "rcm-1",
      created_at: new Date("2026-07-02T12:00:00.000Z"),
      config_fingerprint: "unknown",
      manifest_json: {
        schema_version: 2,
        loaded: {
          skills: ["approve-receipt", "ratio-review"],
          builtInTools: ["bash"],
          mcpServers: ["github", "prod-db"],
          piExtensions: ["assignment-1"],
        },
        gated: [
          {
            capabilityClass: "pi_extension",
            capabilityId: "assignment-9",
            reason: "unavailable_provider",
            detail: "container will skip",
          },
        ],
      },
      ...overrides,
    };
  }

  async function learnFingerprint(): Promise<string> {
    stageHappyPath();
    rowsQueue.push([]); // manifest lookup — none yet
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID },
      ctx,
    );
    return res.predicted!.configFingerprint;
  }

  it("no manifest rows → no_manifest_yet, observed null", async () => {
    stageHappyPath();
    rowsQueue.push([]); // manifest lookup
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID },
      ctx,
    );
    expect(res.divergence).toEqual({ state: "no_manifest_yet" });
    expect(res.observed).toBeNull();
  });

  it("fingerprint mismatch → config_changed_since_turn, never divergent", async () => {
    stageHappyPath();
    rowsQueue.push([manifestRow({ config_fingerprint: "stale-fp" })]);
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID },
      ctx,
    );
    expect(res.divergence?.state).toBe("config_changed_since_turn");
    expect(res.observed?.variant).toBe("OBSERVED");
    // Observed gated entries render with their container reasons verbatim.
    expect(res.observed?.items).toContainEqual(
      expect.objectContaining({
        capabilityId: "assignment-9",
        active: false,
        reason: "unavailable_provider",
      }),
    );
  });

  it("fingerprint match + identical sets → in_sync", async () => {
    const fingerprint = await learnFingerprint();
    stageHappyPath();
    rowsQueue.push([manifestRow({ config_fingerprint: fingerprint })]);
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID },
      ctx,
    );
    expect(res.divergence?.state).toBe("in_sync");
    expect(res.divergence?.deltas ?? null).toBeNull();
  });

  it("covers AE4: fingerprint match + skill missing from loaded → divergent naming the skill", async () => {
    const fingerprint = await learnFingerprint();
    stageHappyPath();
    const row = manifestRow({ config_fingerprint: fingerprint });
    (row.manifest_json as Record<string, any>).loaded.skills = [
      "approve-receipt",
    ];
    rowsQueue.push([row]);
    const res = await capabilityInspector(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID },
      ctx,
    );
    expect(res.divergence?.state).toBe("divergent");
    expect(res.divergence?.deltas).toContainEqual({
      capabilityClass: "skill",
      capabilityId: "ratio-review",
      kind: "missing_in_observed",
    });
  });
});
