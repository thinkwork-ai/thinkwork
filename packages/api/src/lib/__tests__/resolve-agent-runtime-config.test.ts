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
  rowsQueue: [] as unknown[][],
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
  if (next === undefined) return [];
  return next;
}

function rowsResult() {
  return {
    then: (fn: (rows: unknown[]) => unknown) => Promise.resolve(fn(takeRows())),
    limit: () => rowsResult(),
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
        innerJoin: () => ({
          where: () => rowsResult(),
        }),
        leftJoin: () => ({
          where: () => rowsResult(),
        }),
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
  loadAgentProfileRuntimeConfigs,
  resolveAgentRuntimeConfig,
} from "../resolve-agent-runtime-config.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const TEMPLATE_ID = "33333333-3333-3333-3333-333333333333";
const USER_ID = "44444444-4444-4444-4444-444444444444";
const PROFILE_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
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
      ...overrides,
    },
  ]);
}

function stageTemplateRow(overrides?: Record<string, unknown>) {
  const stagedAgent = rowsQueue[rowsQueue.length - 1]?.[0] as
    | Record<string, unknown>
    | undefined;
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

function stageProfileRows(rows: Array<Record<string, unknown>>) {
  rowsQueue.push(rows);
  if (rows.length === 0) return;
  mockListTenantModelCatalogByIds.mockResolvedValueOnce([
    { modelId: PROFILE_MODEL_ID },
  ]);
}

beforeEach(() => {
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
    expect(cfg.threadJsonRenderUiEnabled).toBe(false);
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
          s3Key:
            "tenants/acme/agents/ada/workspaces/finance/skills/tag-vendor",
        },
      ]),
    );
    expect(
      cfg.skillsConfig.some((skill) => skill.skillId === "web-search"),
    ).toBe(false);
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

  it("defaults unknown runtime values to pi", async () => {
    stageAgentRow({ runtime: "unknown" });
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

  it("enables Thread json-render UI only from an explicit agent capability", async () => {
    stageAgentRow();
    stageTemplateRow();
    stageTenantSlug();
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([{ capability: "thread-json-render-ui", enabled: true }]); // agent_capabilities

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.threadJsonRenderUiEnabled).toBe(true);
  });

  it("keeps Thread json-render UI disabled when the capability or tool is blocked", async () => {
    for (const blockedTool of [
      "thread-json-render-ui",
      "emit_json_render_ui",
    ]) {
      rowsQueue.length = 0;
      stageAgentRow({ blocked_tools: [blockedTool] });
      stageTemplateRow();
      stageTenantSlug();
      rowsQueue.push([]); // default guardrail
      stageTrustedRuntimeSkillRows();
      rowsQueue.push([]); // kbs
      rowsQueue.push([{ capability: "thread-json-render-ui", enabled: true }]); // agent_capabilities

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
      },
    ]);
    expect(mockBuildMcpConfigs).toHaveBeenCalledWith(
      AGENT_ID,
      { humanPairId: null, requesterUserId: null },
      expect.stringContaining("agent-runtime-config"),
    );
  });

  it("includes an enabled global Research profile in the runtime config", async () => {
    stageAgentRow();
    stageTenantSlug();
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities
    stageProfileRows([
      {
        id: "profile-research",
        slug: "research",
        name: "Research",
        description: "Find sources.",
        routing_guidance: "Use for cited research.",
        instructions: "Research and cite sources.",
        model_id: PROFILE_MODEL_ID,
        enabled: true,
        built_in_key: "research",
        tool_policy: { builtInTools: ["web-search", "web-extract"] },
        skill_policy: { skillSlugs: [] },
        execution_controls: {
          clarify: false,
          maxRuntimeMs: 30_000,
          reviewGate: true,
          maxReviewLoops: 2,
          loopPolicy: {
            mode: "closed",
            enabled: true,
            maxIterations: 2,
            maxReviewLoops: 2,
            reviewGate: true,
            externalReviewerPolicy: "profile_required",
            failBehavior: "best_effort_with_warning",
          },
        },
      },
    ]);
    rowsQueue.push([]); // space assignments
    rowsQueue.push([]); // MCP server catalog

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.agentProfilesConfig).toEqual([
      expect.objectContaining({
        slug: "research",
        modelId: PROFILE_MODEL_ID,
        availability: { scope: "global", spaceIds: [] },
        builtInTools: ["web-search", "web-extract"],
        executionControls: expect.objectContaining({
          foreground: true,
          clarify: false,
          maxSubagentDepth: 0,
          maxRuntimeMs: 30_000,
          reviewGate: true,
          maxReviewLoops: 2,
          loopPolicy: {
            mode: "closed",
            enabled: true,
            maxIterations: 2,
            maxReviewLoops: 2,
            reviewGate: true,
            externalReviewerPolicy: "profile_required",
            failBehavior: "best_effort_with_warning",
            maxRuntimeMs: 30_000,
          },
        }),
      }),
    ]);
  });

  it("excludes a Space-restricted Coding profile when the invocation Space is not assigned", async () => {
    stageAgentRow();
    stageTenantSlug();
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities
    rowsQueue.push([]); // Space overrides lookup
    stageProfileRows([
      {
        id: "profile-coding",
        slug: "coding",
        name: "Coding",
        description: null,
        routing_guidance: null,
        instructions: "Code carefully.",
        model_id: PROFILE_MODEL_ID,
        enabled: true,
        built_in_key: "coding",
        tool_policy: { builtInTools: ["bash"] },
        skill_policy: { skillSlugs: [] },
        execution_controls: {},
      },
    ]);
    rowsQueue.push([
      { profile_id: "profile-coding", space_id: "space-engineering" },
    ]); // space assignments
    rowsQueue.push([]); // MCP server catalog

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      spaceId: "space-finance",
    });

    expect(cfg.agentProfilesConfig).toEqual([]);
  });

  it("includes a Space-restricted Coding profile when the invocation Space is assigned", async () => {
    stageAgentRow();
    stageTenantSlug();
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities
    rowsQueue.push([]); // Space overrides lookup
    stageProfileRows([
      {
        id: "profile-coding",
        slug: "coding",
        name: "Coding",
        description: null,
        routing_guidance: null,
        instructions: "Code carefully.",
        model_id: PROFILE_MODEL_ID,
        enabled: true,
        built_in_key: "coding",
        tool_policy: { builtInTools: ["bash", "execute_code"] },
        skill_policy: { skillSlugs: ["repo-review"] },
        execution_controls: {},
      },
    ]);
    rowsQueue.push([
      { profile_id: "profile-coding", space_id: "space-engineering" },
    ]); // space assignments
    rowsQueue.push([]); // MCP server catalog

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      spaceId: "space-engineering",
    });

    expect(cfg.agentProfilesConfig).toEqual([
      expect.objectContaining({
        slug: "coding",
        builtInTools: ["bash", "execute_code"],
        skillSlugs: ["repo-review"],
        availability: {
          scope: "space_restricted",
          spaceIds: ["space-engineering"],
        },
      }),
    ]);
  });

  it("compiles profile MCP server access into server display data and operation allowlists", async () => {
    stageAgentRow();
    stageTenantSlug();
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities
    mockBuildMcpConfigs.mockResolvedValueOnce([
      {
        name: "twenty-crm",
        url: "https://twenty.example/mcp",
        availableTools: ["find_many_opportunities", "search_accounts"],
        tools: ["find_many_opportunities"],
      },
    ]);
    stageProfileRows([
      {
        id: "profile-analyst",
        slug: "analyst",
        name: "Analyst",
        description: null,
        routing_guidance: "Use for CRM analysis.",
        instructions: "Analyze the CRM data.",
        model_id: PROFILE_MODEL_ID,
        enabled: true,
        built_in_key: "analyst",
        tool_policy: { builtInTools: [], mcpServers: ["twenty-crm"] },
        skill_policy: { skillSlugs: [] },
        execution_controls: {},
      },
    ]);
    mockListTenantModelCatalogByIds.mockImplementation(async () => [
      { modelId: PROFILE_MODEL_ID },
    ]);
    rowsQueue.push([]); // space assignments
    rowsQueue.push([
      {
        id: "mcp-twenty",
        slug: "twenty-crm",
        name: "Twenty CRM",
        tools: [
          { name: "find_many_opportunities" },
          { name: "search_accounts" },
        ],
      },
    ]); // MCP server catalog

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });

    expect(cfg.agentProfilesConfig[0]?.mcpServers).toEqual([
      {
        id: "mcp-twenty",
        slug: "twenty-crm",
        name: "Twenty CRM",
        availableTools: ["find_many_opportunities", "search_accounts"],
        allowedTools: ["find_many_opportunities"],
      },
    ]);
    expect(cfg.agentProfilesConfig[0]?.mcpToolAllowlist).toEqual({
      "twenty-crm": ["find_many_opportunities"],
    });
  });

  it("excludes disabled profiles and profiles with unavailable models only", async () => {
    stageAgentRow();
    stageTenantSlug();
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities
    rowsQueue.push([
      {
        id: "profile-disabled",
        slug: "disabled",
        name: "Disabled",
        description: null,
        routing_guidance: null,
        instructions: "Nope.",
        model_id: PROFILE_MODEL_ID,
        enabled: false,
        built_in_key: null,
        tool_policy: {},
        skill_policy: {},
        execution_controls: {},
      },
      {
        id: "profile-missing-model",
        slug: "missing-model",
        name: "Missing Model",
        description: null,
        routing_guidance: null,
        instructions: "No model.",
        model_id: "missing-model",
        enabled: true,
        built_in_key: null,
        tool_policy: {},
        skill_policy: {},
        execution_controls: {},
      },
      {
        id: "profile-specialized",
        slug: "specialized",
        name: "Specialized",
        description: null,
        routing_guidance: null,
        instructions: "Use the tenant-configured profile model.",
        model_id: PROFILE_MODEL_ID,
        enabled: true,
        built_in_key: null,
        tool_policy: {},
        skill_policy: {},
        execution_controls: {},
      },
    ]);
    mockListTenantModelCatalogByIds.mockResolvedValueOnce([
      { modelId: PROFILE_MODEL_ID },
    ]);
    rowsQueue.push([]); // space assignments
    rowsQueue.push([]); // MCP server catalog

    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      currentUserId: USER_ID,
      currentUserEmail: "rep@acme.test",
    });

    expect(cfg.agentProfilesConfig).toEqual([
      expect.objectContaining({
        slug: "specialized",
        modelId: PROFILE_MODEL_ID,
      }),
    ]);
  });

  it("overlays Space runtime overrides when spaceId is provided", async () => {
    stageAgentRow({ sandbox: { environment: "default-public" } });
    stageTenantSlug();
    rowsQueue.push([]); // default guardrail
    stageTrustedRuntimeSkillRows();
    rowsQueue.push([]); // kbs
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

// ─── Space-local profiles + shadowing (plan 2026-06-12-002 U7) ──────────────
// Exercised through loadAgentProfileRuntimeConfigs directly (exported for the
// wakeup dispatch path); staging order per call: profiles select → model
// catalog mock → assignments select → MCP catalog select.

describe("loadAgentProfileRuntimeConfigs space-local profiles (U7)", () => {
  const SPACE_A = "space-aaaa";
  const SPACE_B = "space-bbbb";

  function centralResearchRow(overrides?: Record<string, unknown>) {
    return {
      id: "profile-central-research",
      slug: "research",
      name: "Research (central)",
      description: null,
      routing_guidance: null,
      instructions: "Central research instructions.",
      model_id: PROFILE_MODEL_ID,
      enabled: true,
      built_in_key: null,
      source_space_id: null,
      tool_policy: {},
      skill_policy: {},
      execution_controls: {},
      ...overrides,
    };
  }

  function spaceLocalResearchRow(overrides?: Record<string, unknown>) {
    return {
      id: "profile-space-research",
      slug: "research",
      name: "Research (space B)",
      description: null,
      routing_guidance: null,
      instructions: "Space B research instructions.",
      model_id: PROFILE_MODEL_ID,
      enabled: true,
      built_in_key: null,
      source_space_id: SPACE_B,
      tool_policy: {},
      skill_policy: {},
      execution_controls: {},
      ...overrides,
    };
  }

  function stageLoad(
    profiles: Array<Record<string, unknown>>,
    assignments: Array<Record<string, unknown>> = [],
  ) {
    rowsQueue.push(profiles);
    mockListTenantModelCatalogByIds.mockResolvedValueOnce([
      { modelId: PROFILE_MODEL_ID },
    ]);
    rowsQueue.push(assignments);
    rowsQueue.push([]); // MCP server catalog
  }

  async function load(spaceId: string | null) {
    return loadAgentProfileRuntimeConfigs({
      tenantId: TENANT_ID,
      spaceId,
      mcpConfigs: [],
      logPrefix: "[test]",
    });
  }

  it("covers AE4: a Space B local profile resolves for Space B threads and is absent for Space A threads", async () => {
    const spaceProfile = spaceLocalResearchRow({
      slug: "deal-desk",
      id: "profile-space-deal-desk",
    });
    const assignment = {
      profile_id: "profile-space-deal-desk",
      space_id: SPACE_B,
    };

    stageLoad([spaceProfile], [assignment]);
    const spaceBConfigs = await load(SPACE_B);
    expect(spaceBConfigs).toEqual([
      expect.objectContaining({
        id: "profile-space-deal-desk",
        slug: "deal-desk",
        sourceSpaceId: SPACE_B,
        shadowedCentralProfileId: null,
        availability: {
          scope: "space_restricted",
          spaceIds: [SPACE_B],
        },
      }),
    ]);

    stageLoad([spaceProfile], [assignment]);
    const spaceAConfigs = await load(SPACE_A);
    expect(spaceAConfigs).toEqual([]);

    stageLoad([spaceProfile], [assignment]);
    const noSpaceConfigs = await load(null);
    expect(noSpaceConfigs).toEqual([]);
  });

  it("space-local profile shadows the central slug while its Space is active; central resolves elsewhere", async () => {
    const rows = [centralResearchRow(), spaceLocalResearchRow()];
    const assignments = [
      { profile_id: "profile-space-research", space_id: SPACE_B },
    ];

    stageLoad(rows, assignments);
    const spaceBConfigs = await load(SPACE_B);
    expect(spaceBConfigs).toHaveLength(1);
    expect(spaceBConfigs[0]).toMatchObject({
      id: "profile-space-research",
      slug: "research",
      sourceSpaceId: SPACE_B,
      // Shadowing fact surfaced on the winning space-local config.
      shadowedCentralProfileId: "profile-central-research",
    });

    stageLoad(rows, assignments);
    const spaceAConfigs = await load(SPACE_A);
    expect(spaceAConfigs).toHaveLength(1);
    expect(spaceAConfigs[0]).toMatchObject({
      id: "profile-central-research",
      sourceSpaceId: null,
      shadowedCentralProfileId: null,
    });

    stageLoad(rows, assignments);
    const noSpaceConfigs = await load(null);
    expect(noSpaceConfigs).toHaveLength(1);
    expect(noSpaceConfigs[0]).toMatchObject({
      id: "profile-central-research",
    });
  });

  it("does not shadow central when the space-local profile is skipped for an unavailable model", async () => {
    const rows = [
      centralResearchRow(),
      spaceLocalResearchRow({ model_id: "missing-model" }),
    ];
    const assignments = [
      { profile_id: "profile-space-research", space_id: SPACE_B },
    ];

    stageLoad(rows, assignments);
    const configs = await load(SPACE_B);
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      id: "profile-central-research",
      sourceSpaceId: null,
    });
  });

  it("central profiles keep resolving unchanged when no space-local rows exist (regression)", async () => {
    stageLoad([centralResearchRow()], []);
    const configs = await load(SPACE_A);
    expect(configs).toEqual([
      expect.objectContaining({
        id: "profile-central-research",
        slug: "research",
        sourceSpaceId: null,
        shadowedCentralProfileId: null,
        availability: { scope: "global", spaceIds: [] },
      }),
    ]);
  });
});
