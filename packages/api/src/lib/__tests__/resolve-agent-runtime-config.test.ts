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

const { rowsQueue, mockBuildSkillEnvOverrides, mockLoadTenantBuiltinTools, mockBuildMcpConfigs } =
	vi.hoisted(() => ({
		rowsQueue: [] as unknown[][],
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
				where: () => ({
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
	agents: { id: "agents.id", tenant_id: "agents.tenant_id" },
	agentTemplates: { id: "agentTemplates.id" },
	agentSkills: { agent_id: "agentSkills.agent_id", skill_id: "agentSkills.skill_id" },
	tenants: { id: "tenants.id" },
	tenantSkills: {
		tenant_id: "tenantSkills.tenant_id",
		skill_id: "tenantSkills.skill_id",
	},
	users: { id: "users.id" },
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
	eq: () => ({}),
	and: () => ({}),
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

function stageAgentRow() {
	rowsQueue.push([
		{
			id: AGENT_ID,
			name: "Ada",
			slug: "ada",
			human_pair_id: null,
			template_id: TEMPLATE_ID,
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
			...overrides,
		},
	]);
}

function stageTenantSlug(slug = "acme") {
	rowsQueue.push([{ slug }]);
}

beforeEach(() => {
	rowsQueue.length = 0;
	vi.clearAllMocks();
	mockBuildSkillEnvOverrides.mockResolvedValue(null);
	mockLoadTenantBuiltinTools.mockResolvedValue([]);
	mockBuildMcpConfigs.mockResolvedValue([]);
});

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
		expect(cfg.runtimeType).toBe("strands");
		expect(cfg.templateModel).toBe("us.anthropic.claude-sonnet-4-6");
		expect(cfg.guardrailId).toBeNull();
		expect(cfg.guardrailConfig).toBeUndefined();
		expect(cfg.knowledgeBasesConfig).toBeUndefined();
		expect(cfg.mcpConfigs).toEqual([]);
		// Default skills must always be present (agent-email-send + defaults).
		const slugs = cfg.skillsConfig.map((s) => s.skillId);
		expect(slugs).toContain("agent-email-send");
		expect(slugs).toContain("agent-thread-management");
		expect(slugs).toContain("artifacts");
		expect(slugs).toContain("workspace-memory");
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
		expect(slugs).toContain("agent-email-send");
		expect(slugs).toContain("agent-thread-management");
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

	it("injects tenant built-in tools when loadTenantBuiltinTools returns rows", async () => {
		stageAgentRow();
		stageTemplateRow();
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
