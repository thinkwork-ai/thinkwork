/**
 * PRD-09 Batch 4: Prompt template rendering, session compaction config,
 * and deferred wakeup promotion tests.
 *
 * Uses vi.mock() for database — no real DB connection needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Prompt template (pure function — import directly) ───────────────────

import { renderPromptTemplate } from "../lib/orchestration/prompt-template.js";
import type { PromptTemplateContext } from "../lib/orchestration/prompt-template.js";

// ─── Database mocks ─────────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockInsertValues = vi.fn().mockReturnThis();
const mockInsertReturning = vi.fn().mockResolvedValue([]);
const mockInsert = vi.fn().mockReturnValue({
	values: mockInsertValues,
	returning: mockInsertReturning,
});
mockInsertValues.mockReturnValue({ returning: mockInsertReturning });

const mockUpdateSet = vi.fn().mockReturnThis();
const mockUpdateWhere = vi.fn().mockReturnThis();
const mockUpdateReturning = vi.fn().mockResolvedValue([]);
const mockUpdate = vi.fn().mockReturnValue({
	set: mockUpdateSet,
});
mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });

const mockSelectFrom = vi.fn().mockReturnThis();
const mockSelectWhere = vi.fn().mockResolvedValue([]);
const mockSelect = vi.fn().mockReturnValue({
	from: mockSelectFrom,
});
mockSelectFrom.mockReturnValue({ where: mockSelectWhere });

const mockDb = {
	execute: mockExecute,
	insert: mockInsert,
	update: mockUpdate,
	select: mockSelect,
};

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => mockDb,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
	threads: { id: "id", tenant_id: "tenant_id", checkout_run_id: "checkout_run_id" },
	agentWakeupRequests: { id: "id", tenant_id: "tenant_id", status: "status" },
}));

beforeEach(() => {
	vi.clearAllMocks();
	mockInsert.mockReturnValue({ values: mockInsertValues });
	mockInsertValues.mockReturnValue({ returning: mockInsertReturning });
	mockInsertReturning.mockResolvedValue([]);
	mockUpdate.mockReturnValue({ set: mockUpdateSet });
	mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
	mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
	mockUpdateReturning.mockResolvedValue([]);
	mockSelect.mockReturnValue({ from: mockSelectFrom });
	mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
	mockSelectWhere.mockResolvedValue([]);
	mockExecute.mockResolvedValue({ rows: [] });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. PROMPT TEMPLATE RENDERING
// ═══════════════════════════════════════════════════════════════════════════

describe("renderPromptTemplate", () => {
	it("returns null for null/undefined template", () => {
		expect(renderPromptTemplate(null, {})).toBeNull();
		expect(renderPromptTemplate(undefined, {})).toBeNull();
		expect(renderPromptTemplate("", {})).toBeNull();
	});

	it("returns template unchanged when no placeholders", () => {
		const result = renderPromptTemplate("You are a helpful assistant.", {});
		expect(result).toBe("You are a helpful assistant.");
	});

	it("interpolates simple top-level variables", () => {
		const result = renderPromptTemplate(
			"Source: {{source}}",
			{ source: "chat_message" },
		);
		expect(result).toBe("Source: chat_message");
	});

	it("interpolates nested dot-notation paths", () => {
		const ctx: PromptTemplateContext = {
			tenant: { id: "t-1", slug: "acme" },
			agent: { id: "a-1", slug: "researcher", name: "Research Agent" },
			thread: { id: "tk-1", title: "Analyze data", status: "in_progress", priority: "high" },
		};

		const result = renderPromptTemplate(
			"You are {{agent.name}} working for {{tenant.slug}}. Current thread: {{thread.title}} ({{thread.priority}})",
			ctx,
		);

		expect(result).toBe("You are Research Agent working for acme. Current thread: Analyze data (high)");
	});

	it("leaves unknown placeholders as-is", () => {
		const result = renderPromptTemplate(
			"Hello {{agent.name}}, your role is {{agent.role}}",
			{ agent: { name: "Bob" } },
		);

		expect(result).toBe("Hello Bob, your role is {{agent.role}}");
	});

	it("handles whitespace in placeholder names", () => {
		const result = renderPromptTemplate(
			"Agent: {{ agent.name }}",
			{ agent: { name: "Alice" } },
		);
		expect(result).toBe("Agent: Alice");
	});

	it("converts non-string values to string", () => {
		const result = renderPromptTemplate(
			"Count: {{count}}",
			{ count: 42 } as unknown as PromptTemplateContext,
		);
		expect(result).toBe("Count: 42");
	});

	it("leaves null/undefined values as placeholder", () => {
		const result = renderPromptTemplate(
			"Desc: {{thread.description}}",
			{ thread: { description: undefined } },
		);
		expect(result).toBe("Desc: {{thread.description}}");
	});

	it("handles complex multi-line templates", () => {
		const template = [
			"# {{agent.name}} — {{tenant.slug}}",
			"",
			"You are working on thread {{thread.identifier}}: {{thread.title}}",
			"Priority: {{thread.priority}}",
			"Channel: {{thread.channel}}",
		].join("\n");

		const result = renderPromptTemplate(template, {
			agent: { name: "Coder", slug: "coder" },
			tenant: { slug: "acme" },
			thread: {
				identifier: "CHAT-42",
				title: "Fix login bug",
				priority: "critical",
				channel: "manual",
			},
		});

		expect(result).toContain("# Coder — acme");
		expect(result).toContain("CHAT-42: Fix login bug");
		expect(result).toContain("Priority: critical");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. SESSION COMPACTION CONFIG RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveWorkflowConfig — session compaction", () => {
	let resolveWorkflowConfig: typeof import("../lib/orchestration/workflow-config.js").resolveWorkflowConfig;

	beforeEach(async () => {
		const mod = await import("../lib/orchestration/workflow-config.js");
		resolveWorkflowConfig = mod.resolveWorkflowConfig;
	});

	it("returns session compaction defaults when no config exists", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const config = await resolveWorkflowConfig("tenant-1");

		expect(config.sessionCompaction.enabled).toBe(true);
		expect(config.sessionCompaction.maxSessionRuns).toBe(200);
		expect(config.sessionCompaction.maxRawInputTokens).toBe(2_000_000);
		expect(config.sessionCompaction.maxSessionAgeHours).toBe(72);
	});

	it("merges session compaction overrides from tenant config", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{
				session_compaction: { maxSessionRuns: 100, maxSessionAgeHours: 24 },
				team_id: null,
			}],
		});

		const config = await resolveWorkflowConfig("tenant-1");

		expect(config.sessionCompaction.enabled).toBe(true); // default preserved
		expect(config.sessionCompaction.maxSessionRuns).toBe(100);
		expect(config.sessionCompaction.maxSessionAgeHours).toBe(24);
		expect(config.sessionCompaction.maxRawInputTokens).toBe(2_000_000); // default preserved
	});

	it("disables compaction via override", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{ session_compaction: { enabled: false }, team_id: null }],
		});

		const config = await resolveWorkflowConfig("tenant-1");

		expect(config.sessionCompaction.enabled).toBe(false);
		expect(config.sessionCompaction.maxSessionRuns).toBe(200); // default preserved
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. DEFERRED WAKEUP PROMOTION
// ═══════════════════════════════════════════════════════════════════════════

describe("shouldDeferWakeup", () => {
	let shouldDeferWakeup: typeof import("../lib/wakeup-defer.js").shouldDeferWakeup;

	beforeEach(async () => {
		const mod = await import("../lib/wakeup-defer.js");
		shouldDeferWakeup = mod.shouldDeferWakeup;
	});

	it("returns false for empty thread ID", async () => {
		const result = await shouldDeferWakeup("");
		expect(result).toBe(false);
	});

	it("returns true when thread has active checkout", async () => {
		mockSelectWhere.mockResolvedValueOnce([{ checkout_run_id: "run-123" }]);

		const result = await shouldDeferWakeup("thread-1");
		expect(result).toBe(true);
	});

	it("returns false when thread has no active checkout", async () => {
		mockSelectWhere.mockResolvedValueOnce([{ checkout_run_id: null }]);

		const result = await shouldDeferWakeup("thread-1");
		expect(result).toBe(false);
	});

	it("returns false when thread not found", async () => {
		mockSelectWhere.mockResolvedValueOnce([]);

		const result = await shouldDeferWakeup("thread-missing");
		expect(result).toBe(false);
	});
});

describe("promoteNextDeferredWakeup", () => {
	let promoteNextDeferredWakeup: typeof import("../lib/wakeup-defer.js").promoteNextDeferredWakeup;

	beforeEach(async () => {
		const mod = await import("../lib/wakeup-defer.js");
		promoteNextDeferredWakeup = mod.promoteNextDeferredWakeup;
	});

	it("returns null for empty thread ID", async () => {
		const result = await promoteNextDeferredWakeup("tenant-1", "");
		expect(result).toBeNull();
	});

	it("promotes oldest deferred wakeup", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{ id: "wakeup-deferred-1" }],
		});

		const result = await promoteNextDeferredWakeup("tenant-1", "thread-1");
		expect(result).toBe("wakeup-deferred-1");
	});

	it("returns null when no deferred wakeups exist", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const result = await promoteNextDeferredWakeup("tenant-1", "thread-1");
		expect(result).toBeNull();
	});

	it("handles database errors gracefully", async () => {
		mockExecute.mockRejectedValueOnce(new Error("DB error"));

		const result = await promoteNextDeferredWakeup("tenant-1", "thread-1");
		expect(result).toBeNull();
	});
});
