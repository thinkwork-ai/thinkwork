/**
 * Unit tests for resolveAgentRuntimeConfig (packages/api/src/lib/resolve-agent-runtime-config.ts).
 *
 * Exercises the DB-boundary contract without hitting a real database.
 * The drizzle chain is mocked via `vi.mock("@thinkwork/database-pg")` with
 * a shape-keyed store (precedent: chat-agent-invoke.setup-parallel.test.ts):
 * each test stages rows under a logical key derived from the selected
 * columns' table + field names — NOT call order — so the resolver's
 * parallelized await groups (U2 setup diet) cannot desync the staging.
 * Repeated same-shape queries consume staged entries FIFO.
 *
 * Plan: docs/plans/2026-04-24-008-feat-skill-run-dispatcher-plan.md §U1.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  stagedRows,
  takeStagedRows,
  logicalKeyFromFields,
  whereCalls,
  mockBuildSkillEnvOverrides,
  mockLoadTenantBuiltinTools,
  mockLoadTenantWebExtractConfig,
  mockBuildMcpConfigs,
  mockListTenantModelCatalogByIds,
  mockS3Send,
} = vi.hoisted(() => {
  const stagedRows = new Map<string, Array<unknown[] | Error>>();
  /**
   * Derive the logical staging key for a `db.select(fields)` call. The
   * mocked schema exports plain objects whose column values are strings
   * like "agents.id", so the owning table falls out of the first selected
   * column. Tables the resolver reads with more than one shape get a
   * field-key discriminator suffix.
   */
  const logicalKeyFromFields = (fields?: Record<string, unknown>): string => {
    const values = Object.values(fields ?? {});
    const first = values.find((v): v is string => typeof v === "string") ?? "";
    const table = first.split(".")[0] || "unknown";
    const keys = fields ? Object.keys(fields) : [];
    if (table === "users") {
      return keys.includes("email") ? "users:email" : "users:name";
    }
    if (table === "spaces") {
      return keys.includes("model_override")
        ? "spaces:overrides"
        : "spaces:folder";
    }
    if (table === "guardrails") {
      // Tenant-default lookup selects `id`; agent-assigned and Space
      // override lookups select only the bedrock columns.
      return keys.includes("id") ? "guardrails:default" : "guardrails:by-id";
    }
    return table;
  };
  const takeStagedRows = (key: string): unknown[] => {
    const next = stagedRows.get(key)?.shift();
    if (next instanceof Error) throw next;
    return next ?? [];
  };
  return {
    stagedRows,
    takeStagedRows,
    logicalKeyFromFields,
    whereCalls: [] as unknown[],
    mockBuildSkillEnvOverrides: vi.fn(),
    mockLoadTenantBuiltinTools: vi.fn(),
    mockLoadTenantWebExtractConfig: vi.fn(),
    mockBuildMcpConfigs: vi.fn(),
    mockListTenantModelCatalogByIds: vi.fn(),
    mockS3Send: vi.fn(),
  };
});

/** Stage one result set (or an Error rejection) for a logical query shape. */
function stage(key: string, rows: unknown[] | Error) {
  const queue = stagedRows.get(key) ?? [];
  queue.push(rows);
  stagedRows.set(key, queue);
}

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: (fields?: Record<string, unknown>) => {
      const key = logicalKeyFromFields(fields);
      const rows = () => {
        try {
          return Promise.resolve(takeStagedRows(key));
        } catch (err) {
          return Promise.reject(err);
        }
      };
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        from: () => chain,
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: (pred: unknown) => {
          whereCalls.push(pred);
          return chain;
        },
        limit: () => chain,
        then: (
          resolve: (rowsValue: unknown[]) => unknown,
          reject?: (err: unknown) => unknown,
        ) => rows().then(resolve, reject),
      });
      return chain;
    },
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agents: {
    id: "agents.id",
    tenant_id: "agents.tenant_id",
    runtime: "agents.runtime",
    system_prompt: "agents.system_prompt",
    model: "agents.model",
    guardrail_id: "agents.guardrail_id",
    budget_monthly_cents: "agents.budget_monthly_cents",
    budget_paused: "agents.budget_paused",
    blocked_tools: "agents.blocked_tools",
    sandbox: "agents.sandbox",
    browser: "agents.browser",
    web_search: "agents.web_search",
    web_extract: "agents.web_extract",
    send_email: "agents.send_email",
    context_engine: "agents.context_engine",
  },
  agentCapabilities: {
    agent_id: "agentCapabilities.agent_id",
    tenant_id: "agentCapabilities.tenant_id",
    capability: "agentCapabilities.capability",
    enabled: "agentCapabilities.enabled",
    config: "agentCapabilities.config",
  },
  agentTemplates: {
    id: "agentTemplates.id",
    runtime: "agentTemplates.runtime",
    web_search: "agentTemplates.web_search",
    send_email: "agentTemplates.send_email",
    context_engine: "agentTemplates.context_engine",
  },
  agentSkills: {
    agent_id: "agentSkills.agent_id",
    skill_id: "agentSkills.skill_id",
    config: "agentSkills.config",
  },
  skillCatalog: {
    tenant_id: "skillCatalog.tenant_id",
    slug: "skillCatalog.slug",
    content_sha: "skillCatalog.content_sha",
    trust_report: "skillCatalog.trust_report",
    trust_report_content_sha: "skillCatalog.trust_report_content_sha",
    trust_report_pipeline_version: "skillCatalog.trust_report_pipeline_version",
  },
  tenants: { id: "tenants.id", slug: "tenants.slug" },
  tenantContextProviderSettings: {
    tenant_id: "tenantContextProviderSettings.tenant_id",
    provider_id: "tenantContextProviderSettings.provider_id",
    family: "tenantContextProviderSettings.family",
    enabled: "tenantContextProviderSettings.enabled",
    default_enabled: "tenantContextProviderSettings.default_enabled",
    config: "tenantContextProviderSettings.config",
    last_tested_at: "tenantContextProviderSettings.last_tested_at",
    last_test_state: "tenantContextProviderSettings.last_test_state",
    last_test_latency_ms: "tenantContextProviderSettings.last_test_latency_ms",
    last_test_error: "tenantContextProviderSettings.last_test_error",
  },
  users: {
    id: "users.id",
    tenant_id: "users.tenant_id",
    email: "users.email",
    name: "users.name",
  },
  guardrails: {
    id: "guardrails.id",
    tenant_id: "guardrails.tenant_id",
    is_default: "guardrails.is_default",
    bedrock_guardrail_id: "guardrails.bedrock_guardrail_id",
    bedrock_version: "guardrails.bedrock_version",
  },
  spaces: {
    id: "spaces.id",
    tenant_id: "spaces.tenant_id",
    slug: "spaces.slug",
    workspace_folder_name: "spaces.workspace_folder_name",
    model_override: "spaces.model_override",
    guardrail_id_override: "spaces.guardrail_id_override",
    budget_monthly_cents_override: "spaces.budget_monthly_cents_override",
    budget_paused_override: "spaces.budget_paused_override",
    sandbox_override: "spaces.sandbox_override",
  },
  agentProfiles: {
    id: "agentProfiles.id",
    tenant_id: "agentProfiles.tenant_id",
    slug: "agentProfiles.slug",
    name: "agentProfiles.name",
    description: "agentProfiles.description",
    routing_guidance: "agentProfiles.routing_guidance",
    instructions: "agentProfiles.instructions",
    model_id: "agentProfiles.model_id",
    enabled: "agentProfiles.enabled",
    built_in_key: "agentProfiles.built_in_key",
    tool_policy: "agentProfiles.tool_policy",
    skill_policy: "agentProfiles.skill_policy",
    execution_controls: "agentProfiles.execution_controls",
    source_space_id: "agentProfiles.source_space_id",
  },
  agentProfileSpaceAssignments: {
    profile_id: "agentProfileSpaceAssignments.profile_id",
    tenant_id: "agentProfileSpaceAssignments.tenant_id",
    space_id: "agentProfileSpaceAssignments.space_id",
  },
  modelCatalog: {
    model_id: "modelCatalog.model_id",
    is_available: "modelCatalog.is_available",
  },
  userModelApprovals: {
    tenant_id: "userModelApprovals.tenant_id",
    user_id: "userModelApprovals.user_id",
    model_id: "userModelApprovals.model_id",
  },
  tenantMcpServers: {
    id: "tenantMcpServers.id",
    tenant_id: "tenantMcpServers.tenant_id",
    slug: "tenantMcpServers.slug",
    name: "tenantMcpServers.name",
    tools: "tenantMcpServers.tools",
    status: "tenantMcpServers.status",
    enabled: "tenantMcpServers.enabled",
  },
  piExtensionAssignments: {
    id: "piExtensionAssignments.id",
    tenant_id: "piExtensionAssignments.tenant_id",
    version_id: "piExtensionAssignments.version_id",
    target_type: "piExtensionAssignments.target_type",
    agent_profile_id: "piExtensionAssignments.agent_profile_id",
    enabled: "piExtensionAssignments.enabled",
    granted_permissions: "piExtensionAssignments.granted_permissions",
  },
  piExtensionVersions: {
    id: "piExtensionVersions.id",
    tenant_id: "piExtensionVersions.tenant_id",
    source_id: "piExtensionVersions.source_id",
    display_name: "piExtensionVersions.display_name",
    description: "piExtensionVersions.description",
    source_ref: "piExtensionVersions.source_ref",
    commit_sha: "piExtensionVersions.commit_sha",
    manifest_hash: "piExtensionVersions.manifest_hash",
    artifact_hash: "piExtensionVersions.artifact_hash",
    artifact_uri: "piExtensionVersions.artifact_uri",
    runtime_target: "piExtensionVersions.runtime_target",
    status: "piExtensionVersions.status",
    manifest: "piExtensionVersions.manifest",
    tool_names: "piExtensionVersions.tool_names",
    lifecycle_hooks: "piExtensionVersions.lifecycle_hooks",
    permission_classes: "piExtensionVersions.permission_classes",
    verification_report: "piExtensionVersions.verification_report",
  },
  piExtensionSources: {
    id: "piExtensionSources.id",
    tenant_id: "piExtensionSources.tenant_id",
    repository_url: "piExtensionSources.repository_url",
    repository_owner: "piExtensionSources.repository_owner",
    repository_name: "piExtensionSources.repository_name",
    display_name: "piExtensionSources.display_name",
  },
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = mockS3Send;
  },
  ListObjectsV2Command: class {
    constructor(public readonly input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public readonly input: unknown) {}
  },
}));

vi.mock("drizzle-orm", () => ({
  // Return tagged objects so the test can inspect which column/value
  // pairs were passed into each `.where(...)` — required to verify the
  // tenant predicate is applied on users lookups.
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  inArray: (col: unknown, vals: unknown[]) => ({ op: "inArray", col, vals }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
}));

// KTD-8 (plan U9): the assignment-state workspace file store has its own
// suite; here it is mocked so its prefix lookup (db) and file reads (S3)
// never consume this harness's queued rows/responses. Default = no files,
// which keeps every pre-existing test on the agent_skills fallback path.
const { mockReadAssignmentStates, mockResolveWorkspacePrefix } = vi.hoisted(
  () => ({
    mockReadAssignmentStates: vi.fn(),
    mockResolveWorkspacePrefix: vi.fn(),
  }),
);
vi.mock("../skills/assignment-state.js", () => ({
  readSkillAssignmentStates: mockReadAssignmentStates,
  resolveAgentWorkspacePrefix: mockResolveWorkspacePrefix,
}));

vi.mock("../oauth-token.js", () => ({
  buildSkillEnvOverrides: mockBuildSkillEnvOverrides,
}));

vi.mock("../mcp-configs.js", () => ({
  buildMcpConfigs: mockBuildMcpConfigs,
}));

vi.mock("../model-catalog/tenant-catalog.js", () => ({
  listTenantModelCatalogByIds: mockListTenantModelCatalogByIds,
}));

vi.mock("../../handlers/skills.js", () => ({
  loadTenantBuiltinTools: mockLoadTenantBuiltinTools,
}));

vi.mock("../builtin-tools/web-extract.js", () => ({
  loadTenantWebExtractConfig: mockLoadTenantWebExtractConfig,
}));

import {
  AgentNotFoundError,
  resolveAgentRuntimeConfig,
} from "../resolve-agent-runtime-config.js";
import {
  buildPiExtensionArtifactDescriptor,
  piExtensionArtifactHash,
  piExtensionArtifactUri,
} from "../pi-extensions/artifacts.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const TEMPLATE_ID = "33333333-3333-3333-3333-333333333333";
const USER_ID = "44444444-4444-4444-4444-444444444444";
const SPACE_ID = "55555555-5555-5555-5555-555555555555";
const TRUST_PIPELINE_VERSION = "thinkwork-skill-trust-v1";
const DEFAULT_RUNTIME_SKILL_IDS = [
  "agent-thread-management",
  "artifacts",
  "workspace-memory",
];

function stageAgentRow(overrides?: Record<string, unknown>) {
  stage("agents", [
    {
      id: AGENT_ID,
      name: "Ada",
      slug: "ada",
      system_prompt: "You are Ada.",
      human_pair_id: null,
      template_id: TEMPLATE_ID,
      runtime: "strands",
      model: "us.anthropic.claude-sonnet-4-6",
      guardrail_id: null,
      budget_monthly_cents: 10_000,
      budget_paused: false,
      blocked_tools: null,
      sandbox: null,
      browser: null,
      web_search: { enabled: true },
      web_extract: null,
      send_email: { enabled: true },
      context_engine: { enabled: true },
      json_render_ui: null,
      ...overrides,
    },
  ]);
}

function stageTemplateRow(overrides?: Record<string, unknown>) {
  const agentQueue = stagedRows.get("agents");
  const lastRows = agentQueue?.[agentQueue.length - 1];
  const stagedAgent = Array.isArray(lastRows)
    ? (lastRows[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!stagedAgent) return;
  const { runtime: _runtime, ...agentOverrides } = overrides ?? {};
  Object.assign(stagedAgent, agentOverrides);
}

function stageTenantSlug(slug = "acme") {
  stage("tenants", [{ slug }]);
}

function trustedSkillRow(
  slug: string,
  overrides: Record<string, unknown> = {},
) {
  const contentSha = `${slug}-sha`;
  return {
    slug,
    content_sha: contentSha,
    trust_report: {
      status: "passed",
      spec: { status: "passed" },
      scanner: { status: "completed" },
      evidence: {
        skillCard: "starter_generated",
        evalDataset: "starter_generated",
        benchmark: "starter_generated",
        signature: "verified",
      },
    },
    trust_report_content_sha: contentSha,
    trust_report_pipeline_version: TRUST_PIPELINE_VERSION,
    ...overrides,
  };
}

function stageTrustedRuntimeSkillRows(...additionalSkillIds: string[]) {
  stage(
    "skillCatalog",
    [...new Set([...DEFAULT_RUNTIME_SKILL_IDS, ...additionalSkillIds])].map(
      (slug) => trustedSkillRow(slug),
    ),
  );
}

function piExtensionRuntimeRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const sourceId = String(overrides.source_id ?? "extension-source-1");
  const versionId = String(overrides.version_id ?? "extension-version-1");
  const commitSha = String(overrides.commit_sha ?? "abc123def456");
  const manifest = {
    schemaVersion: 1,
    name: "github_tools",
    displayName: "GitHub Tools",
    description: "GitHub extension",
    runtimeTarget: "agentcore-pi",
    entrypoint: "dist/index.js",
    tools: [{ name: "search_issues" }],
    lifecycleHooks: [],
    permissionClasses: ["network"],
  };
  const descriptor = buildPiExtensionArtifactDescriptor({
    repositoryUrl: "https://github.com/acme/github-tools",
    owner: "acme",
    repo: "github-tools",
    commitSha,
    sourceRef: "main",
    manifestPath: "pi-extension.json",
    manifest,
  });
  const row = {
    assignment_id: "assignment-1",
    assignment_tenant_id: TENANT_ID,
    target_type: "default_agent",
    agent_profile_id: null,
    enabled: true,
    granted_permissions: { permissionClasses: ["network"] },
    version_id: versionId,
    version_tenant_id: TENANT_ID,
    source_id: sourceId,
    display_name: "GitHub Tools",
    description: "GitHub extension",
    source_ref: "main",
    commit_sha: commitSha,
    manifest_hash: descriptor.manifestHash,
    artifact_hash: piExtensionArtifactHash(descriptor),
    artifact_uri: piExtensionArtifactUri(descriptor),
    runtime_target: "agentcore-pi",
    status: "approved",
    manifest,
    tool_names: ["search_issues"],
    lifecycle_hooks: [],
    permission_classes: ["network"],
    verification_report: { status: "passed", artifactDescriptor: descriptor },
    source_tenant_id: TENANT_ID,
    repository_url: "https://github.com/acme/github-tools",
    repository_owner: "acme",
    repository_name: "github-tools",
    source_display_name: "GitHub Tools",
  };
  return { ...row, ...overrides };
}

beforeEach(() => {
  mockResolveWorkspacePrefix.mockResolvedValue(null);
  mockReadAssignmentStates.mockResolvedValue(new Map());
  stagedRows.clear();
  whereCalls.length = 0;
  vi.clearAllMocks();
  mockListTenantModelCatalogByIds.mockReset();
  vi.stubEnv("WORKSPACE_BUCKET", "");
  mockBuildSkillEnvOverrides.mockResolvedValue(null);
  mockLoadTenantBuiltinTools.mockResolvedValue([]);
  mockLoadTenantWebExtractConfig.mockResolvedValue(null);
  mockBuildMcpConfigs.mockResolvedValue([]);
  mockListTenantModelCatalogByIds.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function collectEqPairs(pred: unknown): Array<{ col: unknown; val: unknown }> {
  const out: Array<{ col: unknown; val: unknown }> = [];
  function walk(p: unknown) {
    if (!p || typeof p !== "object") return;
    const anyP = p as {
      op?: string;
      col?: unknown;
      val?: unknown;
      preds?: unknown[];
    };
    if (anyP.op === "eq") out.push({ col: anyP.col, val: anyP.val });
    if (anyP.op === "and" && Array.isArray(anyP.preds))
      anyP.preds.forEach(walk);
  }
  walk(pred);
  return out;
}

describe("resolveAgentRuntimeConfig", () => {
  it("throws AgentNotFoundError when the agent lookup returns no rows", async () => {
    stage("agents", []); // empty agents lookup
    await expect(
      resolveAgentRuntimeConfig({ tenantId: TENANT_ID, agentId: AGENT_ID }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
  });

  it("does not require a Template row when the Agent owns runtime fields", async () => {
    stageAgentRow({ template_id: null });
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
    stage("agentSkills", []); // agent_skills metadata overlay

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.templateId).toBeNull();
    expect(cfg.templateModel).toBe("us.anthropic.claude-sonnet-4-6");
  });

  it("returns the expected shape on the happy path with no skills/MCPs", async () => {
    stageAgentRow();
    stageTemplateRow();
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail lookup (tenant_id + is_default=true)
    stageTrustedRuntimeSkillRows();
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.tenantId).toBe(TENANT_ID);
    expect(cfg.agentId).toBe(AGENT_ID);
    expect(cfg.tenantSlug).toBe("acme");
    expect(cfg.agentName).toBe("Ada");
    expect(cfg.agentSystemPrompt).toBe("You are Ada.");
    expect(cfg.runtimeType).toBe("pi");
    expect(cfg.templateModel).toBe("us.anthropic.claude-sonnet-4-6");
    expect(cfg.guardrailId).toBeNull();
    expect(cfg.guardrailConfig).toBeUndefined();
    expect(cfg.browserAutomationEnabled).toBe(false);
    // THINK-291: generated UI is a default-on platform-tool column.
    expect(cfg.threadJsonRenderUiEnabled).toBe(true);
    expect(cfg.contextEngineEnabled).toBe(false);
    expect(cfg.contextEngineConfig).toBeUndefined();
    expect(cfg.mcpConfigs).toEqual([]);
    // Default script skills stay present when they have passed the same trust gate.
    const slugs = cfg.skillsConfig.map((s) => s.skillId);
    expect(slugs).not.toContain("agent-email-send");
    expect(slugs).toContain("agent-thread-management");
    expect(slugs).toContain("artifacts");
    expect(slugs).toContain("workspace-memory");
    expect(cfg.sendEmailConfig).toMatchObject({
      agentId: AGENT_ID,
      tenantId: TENANT_ID,
    });
    expect(cfg.sendEmailConfig).not.toHaveProperty("agentEmailAddress");
  });

  it("filters default runtime skills that have not passed the trust pipeline", async () => {
    stageAgentRow();
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail lookup
    stage("skillCatalog", []); // skill trust gate

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.skillsConfig).toEqual([]);
    expect(cfg.trustedSkillIds).toEqual([]);
  });

  it("registers workspace skills from the workspace tree", async () => {
    vi.stubEnv("WORKSPACE_BUCKET", "workspace-bucket");
    mockS3Send.mockImplementation(async (command: { input?: any }) => {
      if (command.input?.Prefix) {
        return {
          Contents: [
            {
              Key: "tenants/acme/agents/ada/skills/approve-receipt/SKILL.md",
            },
            {
              Key: "tenants/acme/agents/ada/workspaces/finance/skills/tag-vendor/SKILL.md",
            },
            {
              Key: "tenants/acme/agents/ada/skills/web-search/SKILL.md",
            },
          ],
        };
      }
      const key = String(command.input?.Key ?? "");
      return {
        Body: {
          transformToString: async () =>
            key.includes("tag-vendor")
              ? "---\ndisplay_name: Tag Vendor\ndescription: Classify vendors\n---\n"
              : "---\ndisplay_name: Approve Receipt\n---\n",
        },
      };
    });
    stageAgentRow();
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail lookup
    stage("agentSkills", []); // agent_skills metadata overlay
    stageTrustedRuntimeSkillRows("approve-receipt", "tag-vendor");

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.skillsConfig).toEqual(
      expect.arrayContaining([
        {
          skillId: "approve-receipt",
          s3Key: "tenants/acme/agents/ada/skills/approve-receipt",
        },
        {
          skillId: "tag-vendor",
          s3Key: "tenants/acme/agents/ada/workspaces/finance/skills/tag-vendor",
        },
      ]),
    );
    expect(
      cfg.skillsConfig.some((skill) => skill.skillId === "web-search"),
    ).toBe(false);
  });

  it("registers active Space skills from the Space source tree", async () => {
    vi.stubEnv("WORKSPACE_BUCKET", "workspace-bucket");
    mockS3Send.mockImplementation(async (command: { input?: any }) => {
      const prefix = String(command.input?.Prefix ?? "");
      if (prefix) {
        return {
          Contents: prefix.includes("/spaces/customer/")
            ? [
                {
                  Key: "tenants/acme/spaces/customer/skills/ratio-review/SKILL.md",
                },
              ]
            : [],
        };
      }
      return {
        Body: {
          transformToString: async () => "---\nname: Ratio Review\n---\n",
        },
      };
    });
    stageAgentRow();
    stageTenantSlug("acme");
    stage("spaces:folder", [{ slug: "customer", workspace_folder_name: null }]);
    stage("guardrails:default", []); // default guardrail lookup
    stage("agentSkills", []); // agent_skills metadata overlay
    stageTrustedRuntimeSkillRows("ratio-review");

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      spaceId: SPACE_ID,
    });

    expect(cfg.skillsConfig).toEqual(
      expect.arrayContaining([
        {
          skillId: "ratio-review",
          s3Key: "tenants/acme/spaces/customer/skills/ratio-review",
        },
      ]),
    );
    expect(cfg.trustedSkillIds).toContain("ratio-review");
  });

  it("filters workspace skills that have not passed the current trust pipeline", async () => {
    vi.stubEnv("WORKSPACE_BUCKET", "workspace-bucket");
    mockS3Send.mockImplementation(async (command: { input?: any }) => {
      if (command.input?.Prefix) {
        return {
          Contents: [
            {
              Key: "tenants/acme/agents/ada/skills/trusted-skill/SKILL.md",
            },
            {
              Key: "tenants/acme/agents/ada/skills/stale-skill/SKILL.md",
            },
            {
              Key: "tenants/acme/agents/ada/skills/unscanned-skill/SKILL.md",
            },
          ],
        };
      }
      return {
        Body: {
          transformToString: async () => "---\nname: Test\n---\n",
        },
      };
    });
    stageAgentRow();
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail lookup
    stage("agentSkills", []); // agent_skills metadata overlay
    stage("skillCatalog", [
      ...DEFAULT_RUNTIME_SKILL_IDS.map((slug) => trustedSkillRow(slug)),
      trustedSkillRow("trusted-skill"),
      trustedSkillRow("stale-skill", {
        trust_report_content_sha: "old-sha",
      }),
    ]); // skill trust gate

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    const slugs = cfg.skillsConfig.map((skill) => skill.skillId);
    expect(slugs).toContain("trusted-skill");
    expect(slugs).not.toContain("stale-skill");
    expect(slugs).not.toContain("unscanned-skill");
    expect(cfg.trustedSkillIds).toContain("trusted-skill");
    expect(cfg.trustedSkillIds).not.toContain("stale-skill");
  });

  it("overlays agent_skills metadata onto workspace tree skills without making the table the source of truth", async () => {
    vi.stubEnv("WORKSPACE_BUCKET", "workspace-bucket");
    mockS3Send.mockImplementation(async (command: { input?: any }) => {
      if (command.input?.Prefix) {
        return {
          Contents: [
            {
              Key: "tenants/acme/agents/ada/skills/github-issues/SKILL.md",
            },
          ],
        };
      }
      return {
        Body: {
          transformToString: async () => "---\nname: GitHub Issues\n---\n",
        },
      };
    });
    mockBuildSkillEnvOverrides.mockResolvedValueOnce({ GITHUB_TOKEN: "token" });
    stageAgentRow();
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail lookup
    stage("agentSkills", [
      {
        skill_id: "github-issues",
        config: {
          secretRef: "secret/github",
          mcpServer: "github",
          oauthConnectionId: "conn-1",
        },
      },
      {
        skill_id: "not-in-workspace",
        config: { secretRef: "secret/ignored" },
      },
    ]); // agent_skills metadata overlay
    stageTrustedRuntimeSkillRows("github-issues");

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    const githubSkill = cfg.skillsConfig.find(
      (skill) => skill.skillId === "github-issues",
    );
    expect(githubSkill).toMatchObject({
      skillId: "github-issues",
      s3Key: "tenants/acme/agents/ada/skills/github-issues",
      secretRef: "secret/github",
      mcpServer: "github",
      envOverrides: { GITHUB_TOKEN: "token" },
    });
    expect(
      cfg.skillsConfig.some((skill) => skill.skillId === "not-in-workspace"),
    ).toBe(false);
  });

  it("prefers workspace assignment-state file config over the agent_skills row (plan U9, KTD-8)", async () => {
    vi.stubEnv("WORKSPACE_BUCKET", "workspace-bucket");
    mockS3Send.mockImplementation(async (command: { input?: any }) => {
      if (command.input?.Prefix) {
        return {
          Contents: [
            {
              Key: "tenants/acme/agents/ada/skills/github-issues/SKILL.md",
            },
          ],
        };
      }
      return {
        Body: {
          transformToString: async () => "---\nname: GitHub Issues\n---\n",
        },
      };
    });
    mockResolveWorkspacePrefix.mockResolvedValue("tenants/acme/agents/ada/");
    mockReadAssignmentStates.mockResolvedValue(
      new Map([
        [
          "github-issues",
          {
            slug: "github-issues",
            config: { secretRef: "secret/from-file", mcpServer: "gh-file" },
            updated_at: "2026-07-02T00:00:00.000Z",
          },
        ],
      ]),
    );
    mockBuildSkillEnvOverrides.mockResolvedValueOnce({});
    stageAgentRow();
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail lookup
    stage("agentSkills", [
      {
        skill_id: "github-issues",
        config: { secretRef: "secret/from-row", mcpServer: "gh-row" },
      },
    ]); // agent_skills metadata overlay (must lose to the file)
    stageTrustedRuntimeSkillRows("github-issues");

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(
      cfg.skillsConfig.find((skill) => skill.skillId === "github-issues"),
    ).toMatchObject({ secretRef: "secret/from-file", mcpServer: "gh-file" });
  });

  it("resolves per-skill env overrides concurrently (U2 N+1 diet)", async () => {
    vi.stubEnv("WORKSPACE_BUCKET", "workspace-bucket");
    mockS3Send.mockImplementation(async (command: { input?: any }) => {
      if (command.input?.Prefix) {
        return {
          Contents: [
            { Key: "tenants/acme/agents/ada/skills/skill-a/SKILL.md" },
            { Key: "tenants/acme/agents/ada/skills/skill-b/SKILL.md" },
          ],
        };
      }
      return {
        Body: { transformToString: async () => "---\nname: X\n---\n" },
      };
    });
    let inFlight = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => (release = resolve));
    mockBuildSkillEnvOverrides.mockImplementation(async () => {
      inFlight += 1;
      if (inFlight === 2) release();
      // Each call resolves only once BOTH are in flight — the previous
      // sequential per-skill loop would deadlock here and time out.
      await bothStarted;
      return null;
    });
    stageAgentRow();
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail lookup
    stage("agentSkills", [
      { skill_id: "skill-a", config: { oauthConnectionId: "c1" } },
      { skill_id: "skill-b", config: { oauthConnectionId: "c2" } },
    ]); // agent_skills metadata overlay
    stageTrustedRuntimeSkillRows("skill-a", "skill-b");

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(mockBuildSkillEnvOverrides).toHaveBeenCalledTimes(2);
    expect(cfg.skillsConfig.map((s) => s.skillId)).toEqual(
      expect.arrayContaining(["skill-a", "skill-b"]),
    );
  });

  it("uses the agent runtime selector when present", async () => {
    stageAgentRow({ runtime: "pi" });
    stageTemplateRow({ runtime: "strands" });
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.runtimeType).toBe("pi");
    expect(cfg.contextEngineEnabled).toBe(false);
    expect(cfg.contextEngineConfig).toBeUndefined();
  });

  it("uses pi when the Agent runtime selector is missing", async () => {
    stageAgentRow({ runtime: null });
    stageTemplateRow({ runtime: "pi" });
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.runtimeType).toBe("pi");
  });

  it("rejects unknown runtime values loudly instead of coercing to pi (THINK-311 R4)", async () => {
    stageAgentRow({ runtime: "unknown" });
    stageTemplateRow({ runtime: "pi" });
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
    await expect(
      resolveAgentRuntimeConfig({
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
      }),
    ).rejects.toThrow('Unknown agent runtime selector "unknown"');
  });

  it("resolves a legacy agentcore agent row to Pi (THINK-324)", async () => {
    stageAgentRow({ runtime: "agentcore" });
    stageTemplateRow({ runtime: "pi" });
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.runtimeType).toBe("pi");
    expect(cfg.contextEngineEnabled).toBe(false);
  });

  it("honors the template blocked_tools filter", async () => {
    stageAgentRow();
    stageTemplateRow({ blocked_tools: ["artifacts", "workspace-memory"] });
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    const slugs = cfg.skillsConfig.map((s) => s.skillId);
    expect(slugs).not.toContain("artifacts");
    expect(slugs).not.toContain("workspace-memory");
    // non-blocked defaults stay
    expect(slugs).toContain("agent-thread-management");
  });

  it("enables Browser Automation from template browser config", async () => {
    stageAgentRow();
    stageTemplateRow({ browser: { enabled: true } });
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.browserAutomationEnabled).toBe(true);
  });

  it("lets an agent capability row enable Browser Automation when the template is off", async () => {
    stageAgentRow();
    stageTemplateRow({ browser: null });
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    stage("agentCapabilities", [
      { capability: "browser_automation", enabled: true },
    ]); // agent_capabilities
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.browserAutomationEnabled).toBe(true);
  });

  it("lets an agent capability row disable template Browser Automation", async () => {
    stageAgentRow();
    stageTemplateRow({ browser: { enabled: true } });
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    stage("agentCapabilities", [
      { capability: "browser_automation", enabled: false },
    ]); // agent_capabilities
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.browserAutomationEnabled).toBe(false);
  });

  it("keeps Browser Automation disabled when template blocked_tools includes the slug", async () => {
    stageAgentRow();
    stageTemplateRow({
      browser: { enabled: true },
      blocked_tools: ["browser_automation"],
    });
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    stage("agentCapabilities", [
      { capability: "browser_automation", enabled: true },
    ]); // agent_capabilities
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.browserAutomationEnabled).toBe(false);
  });

  it("THINK-291: Thread json-render UI follows the agent json_render_ui column", async () => {
    stageAgentRow({ json_render_ui: { enabled: true } });
    stageTemplateRow();
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    stage("agentCapabilities", []); // agent_capabilities

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.threadJsonRenderUiEnabled).toBe(true);
  });

  it("THINK-291: an explicitly disabled json_render_ui column turns generated UI off", async () => {
    stageAgentRow({ json_render_ui: { enabled: false } });
    stageTemplateRow();
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    stage("agentCapabilities", []); // agent_capabilities

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.threadJsonRenderUiEnabled).toBe(false);
  });

  it("keeps Thread json-render UI disabled when the capability or tool is blocked", async () => {
    for (const blockedTool of [
      "thread-json-render-ui",
      "emit_json_render_ui",
    ]) {
      stagedRows.clear();
      stageAgentRow({
        blocked_tools: [blockedTool],
        json_render_ui: { enabled: true },
      });
      stageTemplateRow();
      stageTenantSlug();
      stage("guardrails:default", []); // default guardrail
      stageTrustedRuntimeSkillRows();
      stage("agentCapabilities", []); // agent_capabilities

      const cfg = await resolveAgentRuntimeConfig({
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
      });

      expect(cfg.threadJsonRenderUiEnabled).toBe(false);
    }
  });

  it("does not inject send_email when the template Send Email opt-in is null", async () => {
    stageAgentRow();
    stageTemplateRow({ send_email: null });
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.sendEmailConfig).toBeUndefined();
  });

  it("does not register Context Engine when the template opt-in is null", async () => {
    stageAgentRow();
    stageTemplateRow({ context_engine: null });
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.contextEngineEnabled).toBe(false);
    expect(cfg.contextEngineConfig).toBeUndefined();
  });

  it("does not return template Context Engine adapter configuration for Pi runtime", async () => {
    stageAgentRow();
    stageTemplateRow({
      context_engine: {
        enabled: true,
        providers: { ids: ["memory", "wiki"] },
        providerOptions: { memory: { queryMode: "reflect" } },
      },
    });
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    stage("agentCapabilities", []); // agent_capabilities
    stage("tenantContextProviderSettings", []); // tenant context provider settings
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.contextEngineEnabled).toBe(false);
    expect(cfg.contextEngineConfig).toBeUndefined();
  });

  it("does not resolve tenant Context Engine adapter overrides for Pi runtime", async () => {
    stageAgentRow();
    stageTemplateRow({
      context_engine: {
        enabled: true,
        providers: { ids: ["memory", "wiki"] },
        providerOptions: { memory: { queryMode: "reflect" } },
      },
    });
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    stage("agentCapabilities", []); // agent_capabilities
    stage("tenantContextProviderSettings", [
      {
        providerId: "memory",
        family: "memory",
        enabled: false,
        defaultEnabled: false,
        config: {},
      },
    ]); // tenant context provider settings
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.contextEngineEnabled).toBe(false);
    expect(cfg.contextEngineConfig).toBeUndefined();
  });

  it("does not register Context Engine when blocked_tools includes query_context", async () => {
    stageAgentRow();
    stageTemplateRow({
      context_engine: { enabled: true },
      blocked_tools: ["query_context"],
    });
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.contextEngineEnabled).toBe(false);
  });

  it("falls back to the tenant default guardrail when the template has none", async () => {
    stageAgentRow();
    stageTemplateRow({ guardrail_id: null });
    stageTenantSlug();
    stage("guardrails:default", [
      {
        id: "guard-id",
        bedrock_guardrail_id: "bg-123",
        bedrock_version: "1",
      },
    ]); // tenant-default guardrail row
    stageTrustedRuntimeSkillRows();
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.guardrailId).toBe("guard-id");
    expect(cfg.guardrailConfig).toEqual({
      guardrailIdentifier: "bg-123",
      guardrailVersion: "1",
    });
  });

  it("scopes the currentUserId email lookup to the calling tenant (P0-B)", async () => {
    // Regression: the service-auth REST endpoint accepts currentUserId
    // as a query param. Without a tenant predicate any holder of
    // API_AUTH_SECRET could enumerate cross-tenant emails. Assert both
    // predicates are applied to the users lookup.
    const OTHER_USER = "44444444-4444-4444-4444-444444444444";
    stageAgentRow();
    stageTemplateRow();
    stageTenantSlug();
    stage("guardrails:default", []); // guardrail
    stageTrustedRuntimeSkillRows();
    stage("users:email", []); // users lookup — empty because predicate rejects cross-tenant
    await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      currentUserId: OTHER_USER,
    });
    // Find the users lookup where-call: it's the one whose eq-pairs
    // include users.id = OTHER_USER.
    const usersWhere = whereCalls.find((w) =>
      collectEqPairs(w).some(
        (p) => p.col === "users.id" && p.val === OTHER_USER,
      ),
    );
    expect(usersWhere).toBeDefined();
    const pairs = collectEqPairs(usersWhere);
    expect(pairs).toContainEqual({ col: "users.id", val: OTHER_USER });
    expect(pairs).toContainEqual({ col: "users.tenant_id", val: TENANT_ID });
  });

  it("passes CURRENT_USER_EMAIL through to default-skill envOverrides", async () => {
    stageAgentRow();
    stageTemplateRow();
    stageTenantSlug();
    stage("guardrails:default", []); // guardrail
    stageTrustedRuntimeSkillRows();
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      currentUserEmail: "rep@acme.test",
    });
    const threadMgmt = cfg.skillsConfig.find(
      (s) => s.skillId === "agent-thread-management",
    );
    expect(threadMgmt?.envOverrides?.CURRENT_USER_EMAIL).toBe("rep@acme.test");
    expect(threadMgmt?.s3Key).toBe(
      "tenants/acme/skill-catalog/agent-thread-management",
    );
  });

  it("injects tenant built-in tools without requiring a catalog skill trust row", async () => {
    stageAgentRow();
    stageTemplateRow({ web_search: { enabled: true } });
    stageTenantSlug();
    stage("guardrails:default", []); // guardrail
    stageTrustedRuntimeSkillRows();
    mockLoadTenantBuiltinTools.mockResolvedValueOnce([
      {
        toolSlug: "web-search",
        provider: "exa",
        envOverrides: { WEB_SEARCH_PROVIDER: "exa", EXA_API_KEY: "abc" },
      },
    ]);
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    const webSearch = cfg.skillsConfig.find((s) => s.skillId === "web-search");
    expect(webSearch).toBeDefined();
    expect(webSearch?.s3Key).toBe("tenants/acme/skill-catalog/web-search");
    expect(webSearch?.envOverrides).toEqual({
      WEB_SEARCH_PROVIDER: "exa",
      EXA_API_KEY: "abc",
    });
    expect(cfg.webSearchConfig).toEqual({
      provider: "exa",
      apiKey: "abc",
    });
    expect(cfg.trustedSkillIds).toContain("web-search");
  });

  it("does not inject web-search when the template Web Search opt-in is null", async () => {
    stageAgentRow();
    stageTemplateRow({ web_search: null });
    stageTenantSlug();
    stage("guardrails:default", []); // guardrail
    stageTrustedRuntimeSkillRows();
    mockLoadTenantBuiltinTools.mockResolvedValueOnce([
      {
        toolSlug: "web-search",
        provider: "exa",
        envOverrides: { WEB_SEARCH_PROVIDER: "exa", EXA_API_KEY: "abc" },
      },
    ]);
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.skillsConfig.some((s) => s.skillId === "web-search")).toBe(
      false,
    );
  });

  it("resolves Web Extraction runtime config only when the template opt-in and tenant config are present", async () => {
    stageAgentRow({ web_extract: { enabled: true } });
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    mockLoadTenantWebExtractConfig.mockResolvedValueOnce({
      toolSlug: "web-extract",
      provider: "firecrawl",
      apiKey: "fc-test-key",
      config: { formats: ["markdown"] },
      secretRef: "secret/firecrawl",
    });

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(mockLoadTenantWebExtractConfig).toHaveBeenCalledWith(TENANT_ID);
    expect(cfg.webExtractConfig).toEqual({
      toolSlug: "web-extract",
      provider: "firecrawl",
      apiKey: "fc-test-key",
      config: { formats: ["markdown"] },
    });
  });

  it("does not resolve Web Extraction secrets when the template opt-in is null or blocked", async () => {
    stageAgentRow({ web_extract: null });
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();

    const disabledCfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(disabledCfg.webExtractConfig).toBeUndefined();
    expect(mockLoadTenantWebExtractConfig).not.toHaveBeenCalled();

    stagedRows.clear();
    stageAgentRow({
      web_extract: { enabled: true },
      blocked_tools: ["web_extract"],
    });
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();

    const blockedCfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(blockedCfg.webExtractConfig).toBeUndefined();
    expect(mockLoadTenantWebExtractConfig).not.toHaveBeenCalled();
  });

  it("delegates MCP config construction to buildMcpConfigs with the agent + human pair", async () => {
    stageAgentRow();
    stageTemplateRow();
    stageTenantSlug();
    stage("guardrails:default", []); // guardrail
    stageTrustedRuntimeSkillRows();
    mockBuildMcpConfigs.mockResolvedValueOnce([
      {
        name: "admin-ops",
        url: "https://example.test/mcp",
        recordLinkHints: {
          schemaVersion: 1,
          source: "plugin-manifest",
          browserBaseUrl: "https://example.test",
          routes: [
            {
              objectType: "opportunity",
              routeTemplate: "/object/opportunity/{id}",
              idFields: ["id"],
            },
          ],
        },
        resultTransforms: [
          {
            type: "scaled-integer-to-decimal",
            sourceField: "amountMicros",
            targetField: "value",
            scale: 6,
            removeSource: true,
          },
        ],
      },
    ]);
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.mcpConfigs).toEqual([
      {
        name: "admin-ops",
        url: "https://example.test/mcp",
        recordLinkHints: {
          schemaVersion: 1,
          source: "plugin-manifest",
          browserBaseUrl: "https://example.test",
          routes: [
            {
              objectType: "opportunity",
              routeTemplate: "/object/opportunity/{id}",
              idFields: ["id"],
            },
          ],
        },
        resultTransforms: [
          {
            type: "scaled-integer-to-decimal",
            sourceField: "amountMicros",
            targetField: "value",
            scale: 6,
            removeSource: true,
          },
        ],
      },
    ]);
    expect(mockBuildMcpConfigs).toHaveBeenCalledWith(
      AGENT_ID,
      { humanPairId: null, requesterUserId: null },
      expect.stringContaining("agent-runtime-config"),
      // Runtime path: no token-mode override, no diagnostics collector.
      {
        tokenMode: undefined,
        diagnostics: null,
        // THINK-173 U5: pre-render resolution defers folder-dispatch
        // agents; the dispatch handler rebuilds post-render.
        folderCapabilities: { defer: true },
      },
    );
  });

  it("resolves approved Default Agent Pi extensions into runtime config", async () => {
    stageAgentRow();
    stageTemplateRow();
    stageTenantSlug();
    stage("guardrails:default", []); // guardrail
    stageTrustedRuntimeSkillRows();
    stage("agentCapabilities", []); // agent_capabilities
    stage("piExtensionAssignments", [
      piExtensionRuntimeRow(),
      piExtensionRuntimeRow({
        assignment_id: "assignment-newer-unapproved",
        version_id: "extension-version-unapproved",
        status: "needs_review",
      }),
    ]);

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.piExtensions).toEqual([
      expect.objectContaining({
        extensionId: "extension-source-1",
        versionId: "extension-version-1",
        assignmentId: "assignment-1",
        displayName: "GitHub Tools",
        repositoryUrl: "https://github.com/acme/github-tools",
        commitSha: "abc123def456",
        runtimeTarget: "agentcore-pi",
        targetType: "default_agent",
        agentProfileId: null,
        toolNames: ["search_issues"],
        permissionClasses: ["network"],
        grantedPermissionClasses: ["network"],
      }),
    ]);
  });

  it("filters non-executable Pi extension assignments without crashing", async () => {
    const stale = piExtensionRuntimeRow({
      assignment_id: "assignment-stale",
    });
    stale.artifact_hash = "stale-artifact-hash";
    const descriptorRuntimeMismatch = piExtensionRuntimeRow({
      assignment_id: "assignment-descriptor-runtime-mismatch",
    });
    const descriptor = {
      ...((
        descriptorRuntimeMismatch.verification_report as Record<string, unknown>
      ).artifactDescriptor as Record<string, unknown>),
      runtimeTarget: "browser",
    };
    descriptorRuntimeMismatch.verification_report = {
      status: "passed",
      artifactDescriptor: descriptor,
    };
    descriptorRuntimeMismatch.artifact_hash = piExtensionArtifactHash(
      descriptor as Parameters<typeof piExtensionArtifactHash>[0],
    );

    stageAgentRow();
    stageTenantSlug();
    stage("spaces:folder", [
      { slug: "engineering", workspace_folder_name: null },
    ]);
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    stage("agentCapabilities", []); // agent_capabilities
    stage("piExtensionAssignments", [
      piExtensionRuntimeRow({
        assignment_id: "assignment-disabled",
        enabled: false,
      }),
      piExtensionRuntimeRow({
        assignment_id: "assignment-rejected",
        status: "rejected",
      }),
      piExtensionRuntimeRow({
        assignment_id: "assignment-wrong-tenant",
        version_tenant_id: "tenant-other",
      }),
      piExtensionRuntimeRow({
        assignment_id: "assignment-unsupported-runtime",
        runtime_target: "browser",
      }),
      piExtensionRuntimeRow({
        assignment_id: "assignment-missing-runtime",
        runtime_target: null,
      }),
      descriptorRuntimeMismatch,
      stale,
      piExtensionRuntimeRow({
        assignment_id: "assignment-missing-artifact",
        artifact_hash: null,
      }),
      piExtensionRuntimeRow({
        assignment_id: "assignment-failed-verification",
        verification_report: { status: "failed" },
      }),
    ]);

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.piExtensions).toEqual([]);
  });

  it("keeps chat runtime config available when Pi extension loading fails", async () => {
    stageAgentRow();
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    stage("agentCapabilities", []); // agent_capabilities
    stage(
      "piExtensionAssignments",
      new Error("pi extension table unavailable"),
    );

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.piExtensions).toEqual([]);
    expect(cfg.agentProfilesConfig).toEqual([]);
  });

  it("overlays Space runtime overrides when spaceId is provided", async () => {
    stageAgentRow({ sandbox: { environment: "default-public" } });
    stageTenantSlug();
    stage("spaces:folder", [{ slug: "finance", workspace_folder_name: null }]);
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    stage("agentCapabilities", []); // agent_capabilities
    stage("spaces:overrides", [
      {
        model_override: "us.anthropic.claude-opus-4-7",
        guardrail_id_override: "guardrail-finance",
        budget_monthly_cents_override: 25_000,
        budget_paused_override: true,
        sandbox_override: false,
      },
    ]); // Space overrides
    stage("guardrails:by-id", [
      {
        bedrock_guardrail_id: "bg-finance",
        bedrock_version: "2",
      },
    ]); // override guardrail

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      spaceId: "space-finance",
    });

    expect(cfg.templateModel).toBe("us.anthropic.claude-opus-4-7");
    expect(cfg.guardrailId).toBe("guardrail-finance");
    expect(cfg.guardrailConfig).toEqual({
      guardrailIdentifier: "bg-finance",
      guardrailVersion: "2",
    });
    expect(cfg.budgetMonthlyCents).toBe(25_000);
    expect(cfg.budgetPaused).toBe(true);
    expect(cfg.sandboxTemplate).toBeNull();
  });
});

// ─── Capability diagnostics channel (capability-mapping plan U1) ────────────
// Opt-in via `collectDiagnostics`; the flag-off path must be byte-identical
// to today's output (asserted directly below by comparing flag-off and
// flag-on resolutions of the same staged shapes).

describe("capability diagnostics channel (U1)", () => {
  function stageHappyPath() {
    stageAgentRow();
    stageTemplateRow();
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
  }

  it("flag off: output carries no capabilityDiagnostics key and is unchanged", async () => {
    stageHappyPath();
    const flagOff = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect("capabilityDiagnostics" in flagOff).toBe(false);

    stageHappyPath();
    const flagOn = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      collectDiagnostics: true,
    });
    const { capabilityDiagnostics, ...flagOnRest } = flagOn;
    expect(capabilityDiagnostics).toEqual([]);
    expect(flagOnRest).toEqual(flagOff);
  });

  it("happy path with active capabilities yields an empty drop list", async () => {
    stageHappyPath();
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      collectDiagnostics: true,
    });
    expect(cfg.capabilityDiagnostics).toEqual([]);
    expect(cfg.skillsConfig.length).toBeGreaterThan(0);
  });

  it("blocked-tools filter emits one blocked_by_policy row per removed skill", async () => {
    stageAgentRow({ blocked_tools: ["artifacts"] });
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      collectDiagnostics: true,
    });
    expect(cfg.skillsConfig.some((s) => s.skillId === "artifacts")).toBe(false);
    expect(cfg.capabilityDiagnostics).toEqual([
      {
        capabilityClass: "skill",
        capabilityId: "artifacts",
        reason: "blocked_by_policy",
        detail: "agent blocked_tools",
      },
    ]);
  });

  it("trust gate emits trust_gate rows for untrusted catalog skills", async () => {
    stageAgentRow();
    stageTenantSlug("acme");
    stage("guardrails:default", []); // default guardrail
    stage("skillCatalog", []); // skill trust gate — nothing trusted
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      collectDiagnostics: true,
    });
    expect(cfg.skillsConfig).toEqual([]);
    const reasons = cfg.capabilityDiagnostics ?? [];
    expect(reasons).toHaveLength(DEFAULT_RUNTIME_SKILL_IDS.length);
    for (const skillId of DEFAULT_RUNTIME_SKILL_IDS) {
      expect(reasons).toContainEqual(
        expect.objectContaining({
          capabilityClass: "skill",
          capabilityId: skillId,
          reason: "trust_gate",
        }),
      );
    }
  });

  it("extension diagnostics: disabled, not approved, validation failure, unavailable_provider prediction", async () => {
    stageAgentRow();
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    stage("agentCapabilities", []); // agent_capabilities
    const stale = piExtensionRuntimeRow({
      assignment_id: "assignment-stale",
      artifact_hash: "stale-artifact-hash",
    });
    stage("piExtensionAssignments", [
      piExtensionRuntimeRow(), // approved, granted ["network"] → unavailable_provider prediction
      piExtensionRuntimeRow({
        assignment_id: "assignment-disabled",
        enabled: false,
      }),
      piExtensionRuntimeRow({
        assignment_id: "assignment-unapproved",
        status: "needs_review",
      }),
      stale,
    ]);

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      collectDiagnostics: true,
    });

    // The approved extension still ships — the prediction is advisory.
    expect(cfg.piExtensions).toHaveLength(1);
    const drops = cfg.capabilityDiagnostics ?? [];
    expect(drops).toContainEqual(
      expect.objectContaining({
        capabilityClass: "pi_extension",
        capabilityId: "assignment-1",
        reason: "unavailable_provider",
      }),
    );
    expect(drops).toContainEqual(
      expect.objectContaining({
        capabilityId: "assignment-disabled",
        reason: "extension_disabled",
      }),
    );
    expect(drops).toContainEqual(
      expect.objectContaining({
        capabilityId: "assignment-unapproved",
        reason: "extension_not_approved",
        detail: expect.stringContaining("needs_review"),
      }),
    );
    expect(drops).toContainEqual(
      expect.objectContaining({
        capabilityId: "assignment-stale",
        reason: "extension_validation_failed",
        detail: expect.stringContaining("artifact hash is stale"),
      }),
    );
  });

  it("extension resolution fault degrades to empty extensions and carries resolution_fault", async () => {
    stageAgentRow();
    stageTenantSlug();
    stage("guardrails:default", []); // default guardrail
    stageTrustedRuntimeSkillRows();
    stage("agentCapabilities", []); // agent_capabilities
    stage(
      "piExtensionAssignments",
      new Error("pi extension table unavailable"),
    );

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      collectDiagnostics: true,
    });

    expect(cfg.piExtensions).toEqual([]);
    expect(cfg.capabilityDiagnostics).toEqual([
      expect.objectContaining({
        capabilityClass: "pi_extension",
        capabilityId: "*",
        reason: "resolution_fault",
        detail: expect.stringContaining("pi extension table unavailable"),
      }),
    ]);
  });
});
