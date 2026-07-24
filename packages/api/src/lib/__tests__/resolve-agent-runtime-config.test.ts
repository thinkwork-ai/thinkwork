/**
 * Unit tests for resolveAgentRuntimeConfig (packages/api/src/lib/resolve-agent-runtime-config.ts).
 *
 * Exercises the DB-boundary contract without hitting a real database.
 * The drizzle chain is mocked via `vi.mock("@thinkwork/database-pg")` with
 * a scriptable queue — each test stages the rows each `select().from(...)`
 * call will receive in order.
 *
 * Plan: docs/plans/2026-04-24-008-feat-skill-run-dispatcher-plan.md §U1.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  rowsQueue,
  whereCalls,
  mockBuildSkillEnvOverrides,
  mockLoadTenantBuiltinTools,
  mockLoadTenantWebExtractConfig,
  mockBuildMcpConfigs,
  mockListTenantModelCatalogByIds,
  mockS3Send,
} = vi.hoisted(() => ({
  rowsQueue: [] as Array<unknown[] | Error>,
  whereCalls: [] as unknown[],
  mockBuildSkillEnvOverrides: vi.fn(),
  mockLoadTenantBuiltinTools: vi.fn(),
  mockLoadTenantWebExtractConfig: vi.fn(),
  mockBuildMcpConfigs: vi.fn(),
  mockListTenantModelCatalogByIds: vi.fn(),
  mockS3Send: vi.fn(),
}));

function takeRows(): unknown[] {
  const next = rowsQueue.shift();
  if (next instanceof Error) throw next;
  if (next === undefined) return [];
  return next;
}

function rowsResult() {
  return {
    then: (
      fn: (rows: unknown[]) => unknown,
      reject?: (err: unknown) => unknown,
    ) => {
      try {
        return Promise.resolve(fn(takeRows()));
      } catch (err) {
        return reject ? Promise.resolve(reject(err)) : Promise.reject(err);
      }
    },
    limit: () => rowsResult(),
  };
}

function joinableRowsResult() {
  return {
    ...rowsResult(),
    innerJoin: () => joinableRowsResult(),
    leftJoin: () => joinableRowsResult(),
    where: () => rowsResult(),
  };
}

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (pred: unknown) => ({
          __capture: whereCalls.push(pred),
          ...rowsResult(),
          leftJoin: () => ({
            where: () => rowsResult(),
          }),
          innerJoin: () => ({
            where: () => rowsResult(),
          }),
          // Allow direct-await forms too (for chained calls that don't use .then).
        }),
        innerJoin: () => joinableRowsResult(),
        leftJoin: () => joinableRowsResult(),
      }),
    }),
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
  tenants: { id: "tenants.id" },
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
  users: { id: "users.id", tenant_id: "users.tenant_id" },
  agentKnowledgeBases: {
    agent_id: "agentKnowledgeBases.agent_id",
    enabled: "agentKnowledgeBases.enabled",
    knowledge_base_id: "agentKnowledgeBases.knowledge_base_id",
  },
  knowledgeBases: { id: "knowledgeBases.id" },
  spaceKnowledgeBases: {
    space_id: "spaceKnowledgeBases.space_id",
    tenant_id: "spaceKnowledgeBases.tenant_id",
    enabled: "spaceKnowledgeBases.enabled",
    knowledge_base_id: "spaceKnowledgeBases.knowledge_base_id",
  },
  guardrails: {
    id: "guardrails.id",
    tenant_id: "guardrails.tenant_id",
    is_default: "guardrails.is_default",
  },
  spaces: {
    id: "spaces.id",
    tenant_id: "spaces.tenant_id",
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
  rowsQueue.push([
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
  const lastRows = rowsQueue[rowsQueue.length - 1];
  const stagedAgent = Array.isArray(lastRows)
    ? (lastRows[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!stagedAgent) return;
  const { runtime: _runtime, ...agentOverrides } = overrides ?? {};
  Object.assign(stagedAgent, agentOverrides);
}

function stageTenantSlug(slug = "acme") {
  rowsQueue.push([{ slug }]);
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
  rowsQueue.push(
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
  rowsQueue.length = 0;
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
    rowsQueue.push([]); // empty agents lookup
    await expect(
      resolveAgentRuntimeConfig({ tenantId: TENANT_ID, agentId: AGENT_ID }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
  });

  it("does not require a Template row when the Agent owns runtime fields", async () => {
    stageAgentRow({ template_id: null });
    stageTenantSlug("acme");
    rowsQueue.push([]); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_skills metadata overlay

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.templateId).toBeNull();
    expect(cfg.templateModel).toBe("us.anthropic.claude-sonnet-4-6");
  });

  it("returns the expected shape on the happy path with no skills/KBs/MCPs", async () => {
    stageAgentRow();
    stageTemplateRow();
    stageTenantSlug("acme");
    rowsQueue.push([]); // default guardrail lookup (tenant_id + is_default=true)
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    expect(cfg.knowledgeBasesConfig).toBeUndefined();
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

  it("suppresses legacy native Bedrock KB payloads unless explicitly enabled", async () => {
    stageAgentRow();
    stageTemplateRow();
    stageTenantSlug("acme");
    rowsQueue.push([]); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([
      {
        aws_kb_id: "aws-kb-1",
        name: "Policies",
        description: "Legacy AWS KB",
        search_config: { topK: 4 },
      },
    ]);

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.knowledgeBasesConfig).toBeUndefined();
  });

  it("keeps legacy native Bedrock KB payloads available behind an opt-in flag", async () => {
    vi.stubEnv("ENABLE_LEGACY_AGENT_KNOWLEDGE_BASES", "true");
    stageAgentRow();
    stageTemplateRow();
    stageTenantSlug("acme");
    rowsQueue.push([]); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([
      {
        aws_kb_id: "aws-kb-1",
        name: "Policies",
        description: "Legacy AWS KB",
        search_config: { topK: 4 },
      },
    ]);

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.knowledgeBasesConfig).toEqual([
      {
        awsKbId: "aws-kb-1",
        name: "Policies",
        description: "Legacy AWS KB",
        searchConfig: { topK: 4 },
      },
    ]);
  });

  it("filters default runtime skills that have not passed the trust pipeline", async () => {
    stageAgentRow();
    stageTenantSlug("acme");
    rowsQueue.push([]); // default guardrail lookup
    rowsQueue.push([]); // skill trust gate
    rowsQueue.push([]); // kbs

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
    rowsQueue.push([]); // default guardrail lookup
    rowsQueue.push([]); // agent_skills metadata overlay
    stageTrustedRuntimeSkillRows("approve-receipt", "tag-vendor");
    rowsQueue.push([]); // kbs

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
    rowsQueue.push([{ slug: "customer", workspace_folder_name: null }]);
    rowsQueue.push([]); // default guardrail lookup
    rowsQueue.push([]); // agent_skills metadata overlay
    stageTrustedRuntimeSkillRows("ratio-review");
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // space-bound kbs (U7)

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
    rowsQueue.push([]); // default guardrail lookup
    rowsQueue.push([]); // agent_skills metadata overlay
    rowsQueue.push([
      ...DEFAULT_RUNTIME_SKILL_IDS.map((slug) => trustedSkillRow(slug)),
      trustedSkillRow("trusted-skill"),
      trustedSkillRow("stale-skill", {
        trust_report_content_sha: "old-sha",
      }),
    ]); // skill trust gate
    rowsQueue.push([]); // kbs

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
    rowsQueue.push([]); // default guardrail lookup
    rowsQueue.push([
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
    rowsQueue.push([]); // kbs

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
    rowsQueue.push([]); // default guardrail lookup
    rowsQueue.push([
      {
        skill_id: "github-issues",
        config: { secretRef: "secret/from-row", mcpServer: "gh-row" },
      },
    ]); // agent_skills metadata overlay (must lose to the file)
    stageTrustedRuntimeSkillRows("github-issues");
    rowsQueue.push([]); // kbs

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(
      cfg.skillsConfig.find((skill) => skill.skillId === "github-issues"),
    ).toMatchObject({ secretRef: "secret/from-file", mcpServer: "gh-file" });
  });

  it("uses the agent runtime selector when present", async () => {
    stageAgentRow({ runtime: "pi" });
    stageTemplateRow({ runtime: "strands" });
    stageTenantSlug("acme");
    rowsQueue.push([]); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([{ capability: "browser_automation", enabled: true }]); // agent_capabilities
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([{ capability: "browser_automation", enabled: false }]); // agent_capabilities
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([{ capability: "browser_automation", enabled: true }]); // agent_capabilities
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities

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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities

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
      rowsQueue.length = 0;
      stageAgentRow({
        blocked_tools: [blockedTool],
        json_render_ui: { enabled: true },
      });
      stageTemplateRow();
      stageTenantSlug();
      rowsQueue.push([]); // default guardrail
      stageTrustedRuntimeSkillRows();
      rowsQueue.push([]); // kbs
      rowsQueue.push([]); // agent_capabilities

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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities
    rowsQueue.push([]); // tenant context provider settings
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities
    rowsQueue.push([
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([
      {
        id: "guard-id",
        bedrock_guardrail_id: "bg-123",
        bedrock_version: "1",
      },
    ]); // tenant-default guardrail row
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // users lookup — empty because predicate rejects cross-tenant
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
    rowsQueue.push([]); // guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs

    const disabledCfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(disabledCfg.webExtractConfig).toBeUndefined();
    expect(mockLoadTenantWebExtractConfig).not.toHaveBeenCalled();

    rowsQueue.length = 0;
    stageAgentRow({
      web_extract: { enabled: true },
      blocked_tools: ["web_extract"],
    });
    stageTenantSlug();
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs

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
    rowsQueue.push([]); // guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities
    rowsQueue.push([
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
    rowsQueue.push([{ slug: "engineering", workspace_folder_name: null }]);
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities
    rowsQueue.push([
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities
    rowsQueue.push(new Error("pi extension table unavailable"));

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
    rowsQueue.push([{ slug: "finance", workspace_folder_name: null }]);
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // space-bound kbs (U7)
    rowsQueue.push([]); // agent_capabilities
    rowsQueue.push([
      {
        model_override: "us.anthropic.claude-opus-4-7",
        guardrail_id_override: "guardrail-finance",
        budget_monthly_cents_override: 25_000,
        budget_paused_override: true,
        sandbox_override: false,
      },
    ]); // Space overrides
    rowsQueue.push([
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
// to today's output and issue no additional queries (the scriptable rowsQueue
// enforces the query count — an unconditional new select would desync every
// staged test above).

describe("capability diagnostics channel (U1)", () => {
  function stageHappyPath() {
    stageAgentRow();
    stageTemplateRow();
    stageTenantSlug("acme");
    rowsQueue.push([]); // default guardrail lookup
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // default guardrail
    rowsQueue.push([]); // skill trust gate — nothing trusted
    rowsQueue.push([]); // kbs
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities
    const stale = piExtensionRuntimeRow({
      assignment_id: "assignment-stale",
      artifact_hash: "stale-artifact-hash",
    });
    rowsQueue.push([
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
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities
    rowsQueue.push(new Error("pi extension table unavailable"));

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
