/**
 * PRD-09 Batch 3: Turn loop + workspace isolation tests.
 *
 * Tests workflow config resolution for turn loop and workspace configs,
 * and verifies workspace prefix generation logic.
 *
 * Uses vi.mock() for database — no real DB connection needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

const mockDeleteWhere = vi.fn().mockReturnThis();
const mockDeleteReturning = vi.fn().mockResolvedValue([]);
const mockDelete = vi.fn().mockReturnValue({
	where: mockDeleteWhere,
});
mockDeleteWhere.mockReturnValue({ returning: mockDeleteReturning });

const mockDb = {
	execute: mockExecute,
	insert: mockInsert,
	update: mockUpdate,
	select: mockSelect,
	delete: mockDelete,
};

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => mockDb,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
	threads: { id: "id", tenant_id: "tenant_id", status: "status" },
	threadDependencies: { id: "id" },
	threadComments: { id: "id" },
	agentWakeupRequests: { id: "id" },
	agents: { id: "id" },
}));

// ─── Reset mocks before each test ──────────────────────────────────────────

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
// 1. TURN LOOP CONFIG RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveWorkflowConfig — turn loop", () => {
	let resolveWorkflowConfig: typeof import("../lib/orchestration/workflow-config.js").resolveWorkflowConfig;

	beforeEach(async () => {
		const mod = await import("../lib/orchestration/workflow-config.js");
		resolveWorkflowConfig = mod.resolveWorkflowConfig;
	});

	it("returns turn loop defaults when no config exists", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const config = await resolveWorkflowConfig("tenant-1");

		expect(config.turnLoop.enabled).toBe(false);
		expect(config.turnLoop.maxTurns).toBe(1);
		expect(config.turnLoop.continueOnToolUse).toBe(false);
	});

	it("merges turn loop config from tenant override", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{
				turn_loop: { enabled: true, maxTurns: 5 },
				hive_id: null,
			}],
		});

		const config = await resolveWorkflowConfig("tenant-1");

		expect(config.turnLoop.enabled).toBe(true);
		expect(config.turnLoop.maxTurns).toBe(5);
		expect(config.turnLoop.continueOnToolUse).toBe(false); // default preserved
	});

	it("applies hive override on top of tenant turn loop config", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [
				{ turn_loop: { enabled: true, maxTurns: 5 }, hive_id: null },
				{ turn_loop: { maxTurns: 10, continueOnToolUse: true }, hive_id: "hive-1" },
			],
		});

		const config = await resolveWorkflowConfig("tenant-1", "hive-1");

		expect(config.turnLoop.enabled).toBe(true); // from tenant
		expect(config.turnLoop.maxTurns).toBe(10); // hive override
		expect(config.turnLoop.continueOnToolUse).toBe(true); // hive override
	});

	it("handles database error with turn loop defaults", async () => {
		mockExecute.mockRejectedValueOnce(new Error("DB down"));

		const config = await resolveWorkflowConfig("tenant-1");

		expect(config.turnLoop.enabled).toBe(false);
		expect(config.turnLoop.maxTurns).toBe(1);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. WORKSPACE CONFIG RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveWorkflowConfig — workspace", () => {
	let resolveWorkflowConfig: typeof import("../lib/orchestration/workflow-config.js").resolveWorkflowConfig;

	beforeEach(async () => {
		const mod = await import("../lib/orchestration/workflow-config.js");
		resolveWorkflowConfig = mod.resolveWorkflowConfig;
	});

	it("returns workspace defaults when no config exists", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const config = await resolveWorkflowConfig("tenant-1");

		expect(config.workspace.isolateByThread).toBe(false);
		expect(config.workspace.prefixTemplate).toBe("tenants/{tenantSlug}/agents/{agentSlug}/workspace/");
	});

	it("merges workspace config from tenant override", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{
				workspace: { isolateByThread: true },
				hive_id: null,
			}],
		});

		const config = await resolveWorkflowConfig("tenant-1");

		expect(config.workspace.isolateByThread).toBe(true);
		expect(config.workspace.prefixTemplate).toBe("tenants/{tenantSlug}/agents/{agentSlug}/workspace/"); // default preserved
	});

	it("applies custom prefix template from config", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{
				workspace: {
					isolateByThread: false,
					prefixTemplate: "custom/{tenantSlug}/{agentSlug}/files/",
				},
				hive_id: null,
			}],
		});

		const config = await resolveWorkflowConfig("tenant-1");

		expect(config.workspace.prefixTemplate).toBe("custom/{tenantSlug}/{agentSlug}/files/");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. WORKSPACE PREFIX GENERATION
// ═══════════════════════════════════════════════════════════════════════════

describe("workspace prefix generation", () => {
	// Test the prefix logic as extracted from wakeup-processor
	function buildWorkspacePrefix(
		workflowConfig: { workspace: { isolateByThread: boolean; prefixTemplate: string } },
		tenantSlug: string,
		agentSlug: string,
		threadId?: string,
	): string {
		let workspacePrefix = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
		if (workflowConfig.workspace.isolateByThread && threadId) {
			workspacePrefix = `tenants/${tenantSlug}/agents/${agentSlug}/threads/${threadId}/`;
		} else if (workflowConfig.workspace.prefixTemplate) {
			workspacePrefix = workflowConfig.workspace.prefixTemplate
				.replace("{tenantSlug}", tenantSlug)
				.replace("{agentSlug}", agentSlug);
		}
		return workspacePrefix;
	}

	it("uses default agent workspace path when isolation disabled", () => {
		const prefix = buildWorkspacePrefix(
			{ workspace: { isolateByThread: false, prefixTemplate: "tenants/{tenantSlug}/agents/{agentSlug}/workspace/" } },
			"acme",
			"researcher",
			"thread-123",
		);

		expect(prefix).toBe("tenants/acme/agents/researcher/workspace/");
	});

	it("uses per-thread path when isolateByThread enabled", () => {
		const prefix = buildWorkspacePrefix(
			{ workspace: { isolateByThread: true, prefixTemplate: "" } },
			"acme",
			"researcher",
			"thread-123",
		);

		expect(prefix).toBe("tenants/acme/agents/researcher/threads/thread-123/");
	});

	it("falls back to default when isolateByThread enabled but no threadId", () => {
		const prefix = buildWorkspacePrefix(
			{ workspace: { isolateByThread: true, prefixTemplate: "tenants/{tenantSlug}/agents/{agentSlug}/workspace/" } },
			"acme",
			"researcher",
		);

		// No thread ID → falls through to prefixTemplate
		expect(prefix).toBe("tenants/acme/agents/researcher/workspace/");
	});

	it("applies custom prefix template with slug interpolation", () => {
		const prefix = buildWorkspacePrefix(
			{ workspace: { isolateByThread: false, prefixTemplate: "orgs/{tenantSlug}/bots/{agentSlug}/data/" } },
			"acme",
			"coder",
		);

		expect(prefix).toBe("orgs/acme/bots/coder/data/");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. TURN LOOP GATE CONDITIONS
// ═══════════════════════════════════════════════════════════════════════════

describe("turn loop gate conditions", () => {
	// Test the gate logic extracted from wakeup-processor
	function shouldEnterTurnLoop(
		turnLoopConfig: { enabled: boolean; maxTurns: number },
		threadId: string | undefined,
		signal: string,
	): boolean {
		return (
			turnLoopConfig.enabled &&
			!!threadId &&
			signal === "continue" &&
			turnLoopConfig.maxTurns > 1
		);
	}

	it("enters loop when enabled, has thread, signal is continue, maxTurns > 1", () => {
		expect(shouldEnterTurnLoop(
			{ enabled: true, maxTurns: 5 },
			"thread-1",
			"continue",
		)).toBe(true);
	});

	it("skips loop when disabled", () => {
		expect(shouldEnterTurnLoop(
			{ enabled: false, maxTurns: 5 },
			"thread-1",
			"continue",
		)).toBe(false);
	});

	it("skips loop when no thread", () => {
		expect(shouldEnterTurnLoop(
			{ enabled: true, maxTurns: 5 },
			undefined,
			"continue",
		)).toBe(false);
	});

	it("skips loop when signal is not continue", () => {
		expect(shouldEnterTurnLoop(
			{ enabled: true, maxTurns: 5 },
			"thread-1",
			"done",
		)).toBe(false);
	});

	it("skips loop when maxTurns is 1 (single-shot)", () => {
		expect(shouldEnterTurnLoop(
			{ enabled: true, maxTurns: 1 },
			"thread-1",
			"continue",
		)).toBe(false);
	});

	it("skips loop for blocked signal even when enabled", () => {
		expect(shouldEnterTurnLoop(
			{ enabled: true, maxTurns: 10 },
			"thread-1",
			"blocked",
		)).toBe(false);
	});
});
