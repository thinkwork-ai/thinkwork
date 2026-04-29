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

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rowsQueue,
  whereCalls,
  mockBuildSkillEnvOverrides,
  mockLoadTenantBuiltinTools,
  mockBuildMcpConfigs,
} = vi.hoisted(() => ({
  rowsQueue: [] as unknown[][],
  whereCalls: [] as unknown[],
  mockBuildSkillEnvOverrides: vi.fn(),
  mockLoadTenantBuiltinTools: vi.fn(),
  mockBuildMcpConfigs: vi.fn(),
}));

function takeRows(): unknown[] {
  const next = rowsQueue.shift();
  if (next === undefined) return [];
  return next;
}

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (pred: unknown) => ({
          __capture: whereCalls.push(pred),
          then: (fn: (rows: unknown[]) => unknown) =>
            Promise.resolve(fn(takeRows())),
          leftJoin: () => ({
            where: () => ({
              then: (fn: (rows: unknown[]) => unknown) =>
                Promise.resolve(fn(takeRows())),
            }),
          }),
          innerJoin: () => ({
            where: () => ({
              then: (fn: (rows: unknown[]) => unknown) =>
                Promise.resolve(fn(takeRows())),
            }),
          }),
          // Allow direct-await forms too (for chained calls that don't use .then).
        }),
        innerJoin: () => ({
          where: () => ({
            then: (fn: (rows: unknown[]) => unknown) =>
              Promise.resolve(fn(takeRows())),
          }),
        }),
        leftJoin: () => ({
          where: () => ({
            then: (fn: (rows: unknown[]) => unknown) =>
              Promise.resolve(fn(takeRows())),
          }),
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
  },
  tenants: { id: "tenants.id" },
  tenantSkills: {
    tenant_id: "tenantSkills.tenant_id",
    skill_id: "tenantSkills.skill_id",
  },
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
}));

vi.mock("drizzle-orm", () => ({
  // Return tagged objects so the test can inspect which column/value
  // pairs were passed into each `.where(...)` — required to verify the
  // tenant predicate is applied on users lookups.
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
}));

vi.mock("../oauth-token.js", () => ({
  buildSkillEnvOverrides: mockBuildSkillEnvOverrides,
}));

vi.mock("../mcp-configs.js", () => ({
  buildMcpConfigs: mockBuildMcpConfigs,
}));

vi.mock("../../handlers/skills.js", () => ({
  loadTenantBuiltinTools: mockLoadTenantBuiltinTools,
}));

import {
  AgentNotFoundError,
  AgentTemplateNotFoundError,
  resolveAgentRuntimeConfig,
} from "../resolve-agent-runtime-config.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const TEMPLATE_ID = "33333333-3333-3333-3333-333333333333";

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
      ...overrides,
    },
  ]);
}

function stageTemplateRow(overrides?: Record<string, unknown>) {
  rowsQueue.push([
    {
      model: "us.anthropic.claude-sonnet-4-6",
      guardrail_id: null,
      blocked_tools: null,
      sandbox: null,
      browser: null,
      web_search: { enabled: true },
      send_email: { enabled: true },
      context_engine: { enabled: true },
      runtime: "strands",
      ...overrides,
    },
  ]);
}

function stageTenantSlug(slug = "acme") {
  rowsQueue.push([{ slug }]);
}

beforeEach(() => {
  rowsQueue.length = 0;
  whereCalls.length = 0;
  vi.clearAllMocks();
  mockBuildSkillEnvOverrides.mockResolvedValue(null);
  mockLoadTenantBuiltinTools.mockResolvedValue([]);
  mockBuildMcpConfigs.mockResolvedValue([]);
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

  it("throws AgentTemplateNotFoundError when the template lookup returns no rows", async () => {
    stageAgentRow();
    rowsQueue.push([]); // empty template lookup
    await expect(
      resolveAgentRuntimeConfig({ tenantId: TENANT_ID, agentId: AGENT_ID }),
    ).rejects.toBeInstanceOf(AgentTemplateNotFoundError);
  });

  it("returns the expected shape on the happy path with no skills/KBs/MCPs", async () => {
    stageAgentRow();
    stageTemplateRow();
    stageTenantSlug("acme");
    rowsQueue.push([]); // default guardrail lookup (tenant_id + is_default=true)
    rowsQueue.push([]); // skills
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
    expect(cfg.runtimeType).toBe("strands");
    expect(cfg.templateModel).toBe("us.anthropic.claude-sonnet-4-6");
    expect(cfg.guardrailId).toBeNull();
    expect(cfg.guardrailConfig).toBeUndefined();
    expect(cfg.browserAutomationEnabled).toBe(false);
    expect(cfg.contextEngineEnabled).toBe(true);
    expect(cfg.contextEngineConfig).toEqual({ enabled: true });
    expect(cfg.knowledgeBasesConfig).toBeUndefined();
    expect(cfg.mcpConfigs).toEqual([]);
    // Default script skills stay present; send_email is injected as a direct tool.
    const slugs = cfg.skillsConfig.map((s) => s.skillId);
    expect(slugs).not.toContain("agent-email-send");
    expect(slugs).toContain("agent-thread-management");
    expect(slugs).toContain("artifacts");
    expect(slugs).toContain("workspace-memory");
    expect(cfg.sendEmailConfig).toMatchObject({
      agentId: AGENT_ID,
      tenantId: TENANT_ID,
      agentEmailAddress: "ada@agents.thinkwork.ai",
    });
  });

  it("uses the agent runtime selector when present", async () => {
    stageAgentRow({ runtime: "pi" });
    stageTemplateRow({ runtime: "strands" });
    stageTenantSlug("acme");
    rowsQueue.push([]); // default guardrail lookup
    rowsQueue.push([]); // skills
    rowsQueue.push([]); // kbs
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.runtimeType).toBe("pi");
  });

  it("falls back to the template runtime before defaulting to Strands", async () => {
    stageAgentRow({ runtime: null });
    stageTemplateRow({ runtime: "pi" });
    stageTenantSlug("acme");
    rowsQueue.push([]); // default guardrail lookup
    rowsQueue.push([]); // skills
    rowsQueue.push([]); // kbs
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.runtimeType).toBe("pi");
  });

  it("defaults unknown runtime values to Strands", async () => {
    stageAgentRow({ runtime: "unknown" });
    stageTemplateRow({ runtime: "pi" });
    stageTenantSlug("acme");
    rowsQueue.push([]); // default guardrail lookup
    rowsQueue.push([]); // skills
    rowsQueue.push([]); // kbs
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.runtimeType).toBe("strands");
  });

  it("honors the template blocked_tools filter", async () => {
    stageAgentRow();
    stageTemplateRow({ blocked_tools: ["artifacts", "workspace-memory"] });
    stageTenantSlug();
    rowsQueue.push([]); // default guardrail
    rowsQueue.push([]); // skills
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
    rowsQueue.push([]); // skills
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
    rowsQueue.push([]); // skills
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
    rowsQueue.push([]); // skills
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
    rowsQueue.push([]); // skills
    rowsQueue.push([]); // kbs
    rowsQueue.push([{ capability: "browser_automation", enabled: true }]); // agent_capabilities
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.browserAutomationEnabled).toBe(false);
  });

  it("does not inject send_email when the template Send Email opt-in is null", async () => {
    stageAgentRow();
    stageTemplateRow({ send_email: null });
    stageTenantSlug();
    rowsQueue.push([]); // default guardrail
    rowsQueue.push([]); // skills
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
    rowsQueue.push([]); // skills
    rowsQueue.push([]); // kbs
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.contextEngineEnabled).toBe(false);
    expect(cfg.contextEngineConfig).toBeUndefined();
  });

  it("returns template Context Engine adapter configuration", async () => {
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
    rowsQueue.push([]); // skills
    rowsQueue.push([]); // kbs
    rowsQueue.push([]); // agent_capabilities
    rowsQueue.push([]); // tenant context provider settings
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.contextEngineConfig).toEqual({
      enabled: true,
      providers: { ids: ["memory", "wiki"] },
      providerOptions: { memory: { queryMode: "reflect" } },
    });
  });

  it("removes tenant-disabled Context Engine adapters from runtime overrides", async () => {
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
    rowsQueue.push([]); // skills
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
    expect(cfg.contextEngineConfig).toEqual({
      enabled: true,
      providers: { ids: ["wiki"] },
    });
  });

  it("does not register Context Engine when blocked_tools includes query_context", async () => {
    stageAgentRow();
    stageTemplateRow({
      context_engine: { enabled: true },
      blocked_tools: ["query_context"],
    });
    stageTenantSlug();
    rowsQueue.push([]); // default guardrail
    rowsQueue.push([]); // skills
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
    rowsQueue.push([]); // skills
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
    rowsQueue.push([]); // skills
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
    rowsQueue.push([]); // skills
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
  });

  it("injects tenant built-in tools when template Web Search is enabled", async () => {
    stageAgentRow();
    stageTemplateRow({ web_search: { enabled: true } });
    stageTenantSlug();
    rowsQueue.push([]); // guardrail
    rowsQueue.push([]); // skills
    rowsQueue.push([]); // kbs
    mockLoadTenantBuiltinTools.mockResolvedValueOnce([
      {
        toolSlug: "web-search",
        provider: "serper",
        envOverrides: { SERPER_API_KEY: "abc" },
      },
    ]);
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    const webSearch = cfg.skillsConfig.find((s) => s.skillId === "web-search");
    expect(webSearch).toBeDefined();
    expect(webSearch?.envOverrides).toEqual({ SERPER_API_KEY: "abc" });
  });

  it("does not inject web-search when the template Web Search opt-in is null", async () => {
    stageAgentRow();
    stageTemplateRow({ web_search: null });
    stageTenantSlug();
    rowsQueue.push([]); // guardrail
    rowsQueue.push([]); // skills
    rowsQueue.push([]); // kbs
    mockLoadTenantBuiltinTools.mockResolvedValueOnce([
      {
        toolSlug: "web-search",
        provider: "serper",
        envOverrides: { SERPER_API_KEY: "abc" },
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

  it("delegates MCP config construction to buildMcpConfigs with the agent + human pair", async () => {
    stageAgentRow();
    stageTemplateRow();
    stageTenantSlug();
    rowsQueue.push([]); // guardrail
    rowsQueue.push([]); // skills
    rowsQueue.push([]); // kbs
    mockBuildMcpConfigs.mockResolvedValueOnce([
      { name: "admin-ops", url: "https://example.test/mcp" },
    ]);
    const cfg = await resolveAgentRuntimeConfig({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
    });
    expect(cfg.mcpConfigs).toEqual([
      { name: "admin-ops", url: "https://example.test/mcp" },
    ]);
    expect(mockBuildMcpConfigs).toHaveBeenCalledWith(
      AGENT_ID,
      null,
      expect.stringContaining("agent-runtime-config"),
    );
  });
});
