/**
 * PRD-09 Batch 1+2: Orchestration unit tests.
 *
 * Tests signal parsing, signal processing, split/delegate handlers,
 * thread release with unblock cascade, and workflow config resolution.
 *
 * Uses vi.mock() for database — no real DB connection needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// PRD-22: Signal parser and types removed — tests for signal parsing/processing
// are no longer needed. Remaining tests cover thread release, unblock cascade,
// workflow config, and dispatch helpers.

// ─── Database mocks ─────────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockInsertValues = vi.fn().mockReturnThis();
const mockInsertReturning = vi.fn().mockResolvedValue([]);
const mockInsert = vi.fn().mockReturnValue({
	values: mockInsertValues,
	returning: mockInsertReturning,
});
// Chain for insert().values().returning()
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
	ensureThreadForWork: vi.fn(),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
	threads: { id: "id", tenant_id: "tenant_id", status: "status", channel: "channel", agent_id: "agent_id", identifier: "identifier", number: "number", assignee_type: "assignee_type", assignee_id: "assignee_id", parent_id: "parent_id", checkout_run_id: "checkout_run_id" },
	threadDependencies: { id: "id", tenant_id: "tenant_id", thread_id: "thread_id", blocked_by_thread_id: "blocked_by_thread_id" },
	threadComments: { id: "id", thread_id: "thread_id", tenant_id: "tenant_id" },
	agentWakeupRequests: { id: "id", tenant_id: "tenant_id", agent_id: "agent_id" },
	agents: { id: "id", reports_to: "reports_to" },
}));

// ─── Reset mocks before each test ──────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	// Re-establish mock chains after clear
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
// 1. SIGNAL PARSER — REMOVED (PRD-22: signal protocol deleted)
// ═══════════════════════════════════════════════════════════════════════════

describe.skip("parseSignal (removed)", () => {
	it("returns continue for plain text with no signal block", () => {
		const result = parseSignal("I completed the task successfully.");
		expect(result.signal).toBe("continue");
		expect(result.cleanResponse).toBe("I completed the task successfully.");
		expect(result.metadata).toBeUndefined();
	});

	it("extracts done signal from fenced block at end", () => {
		const text = `I've finished the analysis.\n\n\`\`\`thinkwork-signal\n{"signal": "done"}\n\`\`\``;
		const result = parseSignal(text);
		expect(result.signal).toBe("done");
		expect(result.cleanResponse).toBe("I've finished the analysis.");
	});

	it("extracts split signal with subThreads metadata", () => {
		const subThreads = [
			{ title: "Research", description: "Research the topic", priority: "high" },
			{ title: "Write", description: "Write the report", dependencies: [0] },
		];
		const text = `Breaking this into sub-tasks.\n\n\`\`\`thinkwork-signal\n${JSON.stringify({ signal: "split", subThreads })}\n\`\`\``;
		const result = parseSignal(text);
		expect(result.signal).toBe("split");
		expect(result.metadata?.subThreads).toHaveLength(2);
		expect(result.metadata!.subThreads![0].title).toBe("Research");
		expect(result.metadata!.subThreads![1].dependencies).toEqual([0]);
		expect(result.cleanResponse).toBe("Breaking this into sub-tasks.");
	});

	it("extracts delegate signal with assigneeId and reason", () => {
		const text = `This needs a specialist.\n\n\`\`\`thinkwork-signal\n{"signal":"delegate","assigneeId":"agent-uuid-123","reason":"needs ML expertise"}\n\`\`\``;
		const result = parseSignal(text);
		expect(result.signal).toBe("delegate");
		expect(result.metadata?.assigneeId).toBe("agent-uuid-123");
		expect(result.metadata?.reason).toBe("needs ML expertise");
	});

	it("extracts escalate signal with reason", () => {
		const text = `I need supervisor approval.\n\n\`\`\`thinkwork-signal\n{"signal":"escalate","reason":"budget approval needed"}\n\`\`\``;
		const result = parseSignal(text);
		expect(result.signal).toBe("escalate");
		expect(result.metadata?.reason).toBe("budget approval needed");
	});

	it("extracts needs_review signal", () => {
		const text = `Work complete, pending review.\n\n\`\`\`thinkwork-signal\n{"signal":"needs_review"}\n\`\`\``;
		const result = parseSignal(text);
		expect(result.signal).toBe("needs_review");
	});

	it("extracts blocked signal", () => {
		const text = `Cannot proceed.\n\n\`\`\`thinkwork-signal\n{"signal":"blocked","reason":"waiting for API access"}\n\`\`\``;
		const result = parseSignal(text);
		expect(result.signal).toBe("blocked");
		expect(result.metadata?.reason).toBe("waiting for API access");
	});

	it("falls back to continue for invalid JSON in signal block", () => {
		const text = `Here's my response.\n\n\`\`\`thinkwork-signal\n{invalid json}\n\`\`\``;
		const result = parseSignal(text);
		expect(result.signal).toBe("continue");
		expect(result.cleanResponse).toBe(text);
	});

	it("falls back to continue for unknown signal type", () => {
		const text = `Done.\n\n\`\`\`thinkwork-signal\n{"signal":"unknown_signal"}\n\`\`\``;
		const result = parseSignal(text);
		expect(result.signal).toBe("continue");
	});

	it("falls back to continue for missing signal field", () => {
		const text = `Done.\n\n\`\`\`thinkwork-signal\n{"reason":"test"}\n\`\`\``;
		const result = parseSignal(text);
		expect(result.signal).toBe("continue");
	});

	it("ignores signal block not at end of response", () => {
		const text = `\`\`\`thinkwork-signal\n{"signal":"done"}\n\`\`\`\n\nSome text after.`;
		const result = parseSignal(text);
		expect(result.signal).toBe("continue");
	});

	it("handles signal block with trailing whitespace", () => {
		const text = `Done.\n\n\`\`\`thinkwork-signal\n{"signal":"done"}\n\`\`\`  \n`;
		const result = parseSignal(text);
		expect(result.signal).toBe("done");
		expect(result.cleanResponse).toBe("Done.");
	});

	it("strips signal block cleanly from multiline response", () => {
		const text = [
			"# Analysis Results",
			"",
			"1. Found 5 issues",
			"2. Fixed 3 automatically",
			"3. 2 need manual review",
			"",
			"```thinkwork-signal",
			'{"signal":"needs_review","reason":"2 issues need manual attention"}',
			"```",
		].join("\n");
		const result = parseSignal(text);
		expect(result.signal).toBe("needs_review");
		expect(result.cleanResponse).toContain("# Analysis Results");
		expect(result.cleanResponse).toContain("2 need manual review");
		expect(result.cleanResponse).not.toContain("thinkwork-signal");
	});

	it("handles empty response text", () => {
		const result = parseSignal("");
		expect(result.signal).toBe("continue");
		expect(result.cleanResponse).toBe("");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THREAD RELEASE + UNBLOCK CASCADE
// ═══════════════════════════════════════════════════════════════════════════

describe("releaseThreadWithSignal", () => {
	// Import after mocks are registered
	let releaseThreadWithSignal: typeof import("../lib/orchestration/thread-release.js").releaseThreadWithSignal;
	let checkAndFireUnblockWakeups: typeof import("../lib/orchestration/thread-release.js").checkAndFireUnblockWakeups;

	beforeEach(async () => {
		const mod = await import("../lib/orchestration/thread-release.js");
		releaseThreadWithSignal = mod.releaseThreadWithSignal;
		checkAndFireUnblockWakeups = mod.checkAndFireUnblockWakeups;
	});

	it("sets status to done and clears checkout_run_id", async () => {
		await releaseThreadWithSignal("thread-1", "turn-1", "done", "tenant-1");

		expect(mockUpdate).toHaveBeenCalled();
		const setArgs = mockUpdateSet.mock.calls[0][0];
		expect(setArgs.checkout_run_id).toBeNull();
		expect(setArgs.status).toBe("done");
		expect(setArgs.completed_at).toBeInstanceOf(Date);
		expect(setArgs.closed_at).toBeInstanceOf(Date);
	});

	it("sets lifecycle timestamps for cancelled status", async () => {
		await releaseThreadWithSignal("thread-1", "turn-1", "cancelled", "tenant-1");

		const setArgs = mockUpdateSet.mock.calls[0][0];
		expect(setArgs.status).toBe("cancelled");
		expect(setArgs.cancelled_at).toBeInstanceOf(Date);
	});

	it("sets started_at for in_progress status", async () => {
		await releaseThreadWithSignal("thread-1", "turn-1", "in_progress", "tenant-1");

		const setArgs = mockUpdateSet.mock.calls[0][0];
		expect(setArgs.status).toBe("in_progress");
		expect(setArgs.started_at).toBeInstanceOf(Date);
	});

	it("sets blocked status without lifecycle timestamps", async () => {
		await releaseThreadWithSignal("thread-1", "turn-1", "blocked", "tenant-1");

		const setArgs = mockUpdateSet.mock.calls[0][0];
		expect(setArgs.status).toBe("blocked");
		expect(setArgs.completed_at).toBeUndefined();
		expect(setArgs.cancelled_at).toBeUndefined();
	});
});

describe("checkAndFireUnblockWakeups", () => {
	let checkAndFireUnblockWakeups: typeof import("../lib/orchestration/thread-release.js").checkAndFireUnblockWakeups;

	beforeEach(async () => {
		const mod = await import("../lib/orchestration/thread-release.js");
		checkAndFireUnblockWakeups = mod.checkAndFireUnblockWakeups;
	});

	it("fires wakeup when all blockers are resolved", async () => {
		// Setup: thread-2 depends on thread-1 (which just finished)
		mockSelectWhere.mockResolvedValueOnce([{ thread_id: "thread-2" }]);

		// All blockers resolved (count = 0)
		mockExecute.mockResolvedValueOnce({ rows: [{ count: 0 }] });

		// Dependent thread details
		mockSelectWhere.mockResolvedValueOnce([{
			assignee_type: "agent",
			assignee_id: "agent-1",
			agent_id: "agent-1",
			identifier: "CHAT-5",
			number: 5,
			status: "blocked",
		}]);

		await checkAndFireUnblockWakeups("thread-1", "tenant-1");

		// Should auto-transition blocked → todo
		expect(mockUpdate).toHaveBeenCalled();

		// Should insert wakeup request
		expect(mockInsert).toHaveBeenCalled();
	});

	it("does not fire wakeup when blockers remain unresolved", async () => {
		mockSelectWhere.mockResolvedValueOnce([{ thread_id: "thread-2" }]);
		mockExecute.mockResolvedValueOnce({ rows: [{ count: 1 }] });

		await checkAndFireUnblockWakeups("thread-1", "tenant-1");

		// Should NOT insert wakeup (still has unresolved deps)
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it("handles thread with no dependents gracefully", async () => {
		mockSelectWhere.mockResolvedValueOnce([]); // No dependents

		await checkAndFireUnblockWakeups("thread-1", "tenant-1");

		expect(mockInsert).not.toHaveBeenCalled();
	});

	it("fires wakeups for multiple unblocked dependents", async () => {
		// Two threads depend on the completed thread
		mockSelectWhere.mockResolvedValueOnce([
			{ thread_id: "thread-2" },
			{ thread_id: "thread-3" },
		]);

		// Both fully unblocked
		mockExecute.mockResolvedValueOnce({ rows: [{ count: 0 }] });
		mockSelectWhere.mockResolvedValueOnce([{
			assignee_type: "agent", assignee_id: "agent-1",
			agent_id: "agent-1", identifier: "CHAT-2", number: 2, status: "blocked",
		}]);

		mockExecute.mockResolvedValueOnce({ rows: [{ count: 0 }] });
		mockSelectWhere.mockResolvedValueOnce([{
			assignee_type: "agent", assignee_id: "agent-2",
			agent_id: "agent-2", identifier: "CHAT-3", number: 3, status: "blocked",
		}]);

		await checkAndFireUnblockWakeups("thread-1", "tenant-1");

		// Two wakeups + two status updates
		expect(mockInsert).toHaveBeenCalledTimes(2);
		expect(mockUpdate).toHaveBeenCalledTimes(2);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. SIGNAL PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════

describe.skip("processSignal (removed)", () => {
	let processSignal: typeof import("../lib/orchestration/signal-processor.js").processSignal;

	beforeEach(async () => {
		const mod = await import("../lib/orchestration/signal-processor.js");
		processSignal = mod.processSignal;
	});

	it("processes done signal → releases thread as done", async () => {
		await processSignal({
			signal: "done",
			threadId: "thread-1",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
		});

		const setArgs = mockUpdateSet.mock.calls[0][0];
		expect(setArgs.status).toBe("done");
		expect(setArgs.checkout_run_id).toBeNull();
	});

	it("processes needs_review signal → releases as in_review", async () => {
		await processSignal({
			signal: "needs_review",
			threadId: "thread-1",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
		});

		const setArgs = mockUpdateSet.mock.calls[0][0];
		expect(setArgs.status).toBe("in_review");
	});

	it("processes blocked signal → releases as blocked", async () => {
		await processSignal({
			signal: "blocked",
			threadId: "thread-1",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
		});

		const setArgs = mockUpdateSet.mock.calls[0][0];
		expect(setArgs.status).toBe("blocked");
	});

	it("processes escalate signal → releases as todo + fires supervisor wakeup", async () => {
		// Agent has a supervisor
		mockSelectWhere.mockResolvedValueOnce([{ reports_to: "supervisor-1" }]);

		await processSignal({
			signal: "escalate",
			signalMetadata: { reason: "needs budget approval" },
			threadId: "thread-1",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
		});

		// Should release as todo
		const setArgs = mockUpdateSet.mock.calls[0][0];
		expect(setArgs.status).toBe("todo");

		// Should insert wakeup for supervisor
		expect(mockInsert).toHaveBeenCalled();
		const insertArgs = mockInsertValues.mock.calls[0][0];
		expect(insertArgs.agent_id).toBe("supervisor-1");
		expect(insertArgs.source).toBe("automation");
		expect(insertArgs.reason).toContain("Escalation");
		expect(insertArgs.reason).toContain("needs budget approval");
	});

	it("processes escalate signal gracefully when no supervisor exists", async () => {
		mockSelectWhere.mockResolvedValueOnce([{ reports_to: null }]);

		await processSignal({
			signal: "escalate",
			threadId: "thread-1",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
		});

		// Should release as todo but NOT insert wakeup
		const setArgs = mockUpdateSet.mock.calls[0][0];
		expect(setArgs.status).toBe("todo");
		// Only the update for release, no insert for wakeup
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it("processes continue signal → no-op", async () => {
		await processSignal({
			signal: "continue",
			threadId: "thread-1",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
		});

		expect(mockUpdate).not.toHaveBeenCalled();
		expect(mockInsert).not.toHaveBeenCalled();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. DELEGATE HANDLER
// ═══════════════════════════════════════════════════════════════════════════

describe.skip("handleDelegateSignal (removed)", () => {
	let handleDelegateSignal: typeof import("../lib/orchestration/delegate-handler.js").handleDelegateSignal;

	beforeEach(async () => {
		const mod = await import("../lib/orchestration/delegate-handler.js");
		handleDelegateSignal = mod.handleDelegateSignal;
	});

	it("releases thread, reassigns, inserts comment, and fires wakeup", async () => {
		await handleDelegateSignal({
			threadId: "thread-1",
			turnId: "turn-1",
			tenantId: "tenant-1",
			currentAgentId: "agent-1",
			newAssigneeId: "agent-2",
			reason: "needs frontend expertise",
		});

		// 1. Release as todo (update #1 — releaseThreadWithSignal)
		const releaseSetArgs = mockUpdateSet.mock.calls[0][0];
		expect(releaseSetArgs.status).toBe("todo");
		expect(releaseSetArgs.checkout_run_id).toBeNull();

		// 2. Reassign (update #2)
		const reassignSetArgs = mockUpdateSet.mock.calls[1][0];
		expect(reassignSetArgs.assignee_type).toBe("agent");
		expect(reassignSetArgs.assignee_id).toBe("agent-2");

		// 3. System comment (insert #1)
		const commentArgs = mockInsertValues.mock.calls[0][0];
		expect(commentArgs.thread_id).toBe("thread-1");
		expect(commentArgs.author_type).toBe("system");
		expect(commentArgs.content).toContain("Delegated from agent agent-1 to agent agent-2");
		expect(commentArgs.content).toContain("needs frontend expertise");

		// 4. Wakeup for new assignee (insert #2)
		const wakeupArgs = mockInsertValues.mock.calls[1][0];
		expect(wakeupArgs.agent_id).toBe("agent-2");
		expect(wakeupArgs.source).toBe("thread_assignment");
		expect(wakeupArgs.payload).toEqual({ threadId: "thread-1" });
	});

	it("works without reason", async () => {
		await handleDelegateSignal({
			threadId: "thread-1",
			turnId: "turn-1",
			tenantId: "tenant-1",
			currentAgentId: "agent-1",
			newAssigneeId: "agent-2",
		});

		const commentArgs = mockInsertValues.mock.calls[0][0];
		expect(commentArgs.content).toBe("Delegated from agent agent-1 to agent agent-2");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. SPLIT HANDLER
// ═══════════════════════════════════════════════════════════════════════════

describe.skip("handleSplitSignal (removed)", () => {
	let handleSplitSignal: typeof import("../lib/orchestration/split-handler.js").handleSplitSignal;
	let mockEnsureThreadForWork: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		// Get the mocked ensureThreadForWork
		const dbPkg = await import("@thinkwork/database-pg");
		mockEnsureThreadForWork = dbPkg.ensureThreadForWork as ReturnType<typeof vi.fn>;

		const mod = await import("../lib/orchestration/split-handler.js");
		handleSplitSignal = mod.handleSplitSignal;
	});

	it("creates sub-threads, deps, and fires wakeups", async () => {
		// Parent thread
		mockSelectWhere.mockResolvedValueOnce([{
			channel: "manual",
			agent_id: "agent-1",
			identifier: "TICK-1",
			tenant_id: "tenant-1",
		}]);

		// Workflow config query (resolveWorkflowConfig) — returns empty (use defaults)
		mockExecute.mockResolvedValueOnce({ rows: [] });

		// Depth check
		mockExecute.mockResolvedValueOnce({ rows: [{ max_depth: 1 }] });

		// ensureThreadForWork returns created sub-thread IDs
		mockEnsureThreadForWork
			.mockResolvedValueOnce({ threadId: "sub-1", identifier: "TICK-2", number: 2 })
			.mockResolvedValueOnce({ threadId: "sub-2", identifier: "TICK-3", number: 3 });

		await handleSplitSignal({
			threadId: "thread-1",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
			subThreads: [
				{ title: "Research", description: "Research the topic" },
				{ title: "Write", description: "Write the report" },
			],
		});

		// ensureThreadForWork called for each sub-thread
		expect(mockEnsureThreadForWork).toHaveBeenCalledTimes(2);

		// Updates for sub-thread details (parent_id, description, etc.)
		expect(mockUpdate).toHaveBeenCalled();

		// Inserts: 2 blocking deps (parent ← sub) + 2 wakeups + release update
		expect(mockInsert).toHaveBeenCalled();
	});

	it("respects maxSubThreads from workflow config", async () => {
		mockSelectWhere.mockResolvedValueOnce([{
			channel: "manual", agent_id: "agent-1",
			identifier: "TICK-1", tenant_id: "tenant-1",
		}]);

		// Config with maxSubThreads: 2
		mockExecute.mockResolvedValueOnce({
			rows: [{ orchestration: { maxSubThreads: 2 }, hive_id: null }],
		});

		// Depth check
		mockExecute.mockResolvedValueOnce({ rows: [{ max_depth: 1 }] });

		mockEnsureThreadForWork
			.mockResolvedValueOnce({ threadId: "sub-1", identifier: "TICK-2", number: 2 })
			.mockResolvedValueOnce({ threadId: "sub-2", identifier: "TICK-3", number: 3 });

		await handleSplitSignal({
			threadId: "thread-1",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
			subThreads: [
				{ title: "A", description: "a" },
				{ title: "B", description: "b" },
				{ title: "C", description: "c" }, // This should be truncated
			],
		});

		// Only 2 sub-threads created (maxSubThreads=2)
		expect(mockEnsureThreadForWork).toHaveBeenCalledTimes(2);
	});

	it("rejects split at max depth", async () => {
		mockSelectWhere.mockResolvedValueOnce([{
			channel: "manual", agent_id: "agent-1",
			identifier: "TICK-1", tenant_id: "tenant-1",
		}]);

		// Default config (maxDepth: 3)
		mockExecute.mockResolvedValueOnce({ rows: [] });

		// Already at depth 3
		mockExecute.mockResolvedValueOnce({ rows: [{ max_depth: 3 }] });

		await handleSplitSignal({
			threadId: "thread-1",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
			subThreads: [{ title: "A", description: "a" }],
		});

		// Should NOT create any sub-threads
		expect(mockEnsureThreadForWork).not.toHaveBeenCalled();
	});

	it("adds inter-sub-thread dependencies from spec", async () => {
		mockSelectWhere.mockResolvedValueOnce([{
			channel: "manual", agent_id: "agent-1",
			identifier: "TICK-1", tenant_id: "tenant-1",
		}]);
		mockExecute.mockResolvedValueOnce({ rows: [] }); // config
		mockExecute.mockResolvedValueOnce({ rows: [{ max_depth: 1 }] }); // depth

		mockEnsureThreadForWork
			.mockResolvedValueOnce({ threadId: "sub-1", identifier: "TICK-2", number: 2 })
			.mockResolvedValueOnce({ threadId: "sub-2", identifier: "TICK-3", number: 3 });

		await handleSplitSignal({
			threadId: "thread-1",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
			subThreads: [
				{ title: "Research", description: "First" },
				{ title: "Write", description: "Depends on research", dependencies: [0] },
			],
		});

		// Should insert: 2 parent←sub deps + 1 inter-sub dep = 3 dep inserts
		// Plus 2 sub-thread updates + 1 release update
		// Plus wakeup for sub-1 (sub-2 has deps so no wakeup)
		const insertCalls = mockInsertValues.mock.calls;

		// Find the inter-sub dep: sub-2 blocked by sub-1
		const depInserts = insertCalls.filter(
			(call: unknown[]) => (call[0] as Record<string, unknown>).blocked_by_thread_id !== undefined,
		);
		expect(depInserts.length).toBe(3); // 2 parent deps + 1 inter-sub dep

		// Find wakeup inserts
		const wakeupInserts = insertCalls.filter(
			(call: unknown[]) => (call[0] as Record<string, unknown>).source === "thread_assignment",
		);
		// Only sub-1 gets a wakeup (sub-2 has dependencies)
		expect(wakeupInserts.length).toBe(1);
	});

	it("returns early if parent thread not found", async () => {
		mockSelectWhere.mockResolvedValueOnce([]); // No parent

		await handleSplitSignal({
			threadId: "thread-missing",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
			subThreads: [{ title: "A", description: "a" }],
		});

		expect(mockEnsureThreadForWork).not.toHaveBeenCalled();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. WORKFLOW CONFIG RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveWorkflowConfig", () => {
	let resolveWorkflowConfig: typeof import("../lib/orchestration/workflow-config.js").resolveWorkflowConfig;

	beforeEach(async () => {
		const mod = await import("../lib/orchestration/workflow-config.js");
		resolveWorkflowConfig = mod.resolveWorkflowConfig;
	});

	it("returns defaults when no config rows exist", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const config = await resolveWorkflowConfig("tenant-1");

		expect(config.orchestration.maxSubThreads).toBe(20);
		expect(config.orchestration.maxDepth).toBe(3);
		expect(config.orchestration.allowSplit).toBe(true);
		expect(config.orchestration.allowDelegate).toBe(true);
		expect(config.retry.maxAttempts).toBe(5);
		expect(config.retry.baseDelay).toBe(10);
		expect(config.stallDetection.timeoutMinutes).toBe(5);
	});

	it("merges tenant-level overrides with defaults", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{
				orchestration: { maxSubThreads: 10, maxDepth: 5 },
				retry: { maxAttempts: 3 },
				hive_id: null,
			}],
		});

		const config = await resolveWorkflowConfig("tenant-1");

		expect(config.orchestration.maxSubThreads).toBe(10);
		expect(config.orchestration.maxDepth).toBe(5);
		expect(config.orchestration.allowSplit).toBe(true); // default preserved
		expect(config.retry.maxAttempts).toBe(3);
		expect(config.retry.baseDelay).toBe(10); // default preserved
	});

	it("applies hive override on top of tenant config", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [
				// Tenant default (hive_id NULL sorts first)
				{
					orchestration: { maxSubThreads: 10 },
					retry: { maxAttempts: 3 },
					hive_id: null,
				},
				// Hive override
				{
					orchestration: { maxSubThreads: 5 },
					hive_id: "hive-1",
				},
			],
		});

		const config = await resolveWorkflowConfig("tenant-1", "hive-1");

		// Hive override wins for maxSubThreads
		expect(config.orchestration.maxSubThreads).toBe(5);
		// Tenant config still applies for retry
		expect(config.retry.maxAttempts).toBe(3);
	});

	it("handles database error gracefully with defaults", async () => {
		mockExecute.mockRejectedValueOnce(new Error("Connection failed"));

		const config = await resolveWorkflowConfig("tenant-1");

		expect(config.orchestration.maxSubThreads).toBe(20);
		expect(config.retry.maxAttempts).toBe(5);
	});

	it("applies prompt_template from config", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{
				prompt_template: "You are a specialized agent for {{tenant}}.",
				hive_id: null,
			}],
		});

		const config = await resolveWorkflowConfig("tenant-1");

		expect(config.promptTemplate).toBe("You are a specialized agent for {{tenant}}.");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. THREAD DISPATCH (Batch 1) — isThreadBlocked + concurrency
// ═══════════════════════════════════════════════════════════════════════════

describe("isThreadBlocked", () => {
	let isThreadBlocked: typeof import("../lib/thread-dispatch.js").isThreadBlocked;

	beforeEach(async () => {
		const mod = await import("../lib/thread-dispatch.js");
		isThreadBlocked = mod.isThreadBlocked;
	});

	it("returns true when thread has unresolved dependencies", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [{ blocked: true }] });

		const result = await isThreadBlocked("thread-1");
		expect(result).toBe(true);
	});

	it("returns false when all dependencies are resolved", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [{ blocked: false }] });

		const result = await isThreadBlocked("thread-2");
		expect(result).toBe(false);
	});

	it("returns false when thread has no dependencies", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [{ blocked: false }] });

		const result = await isThreadBlocked("thread-3");
		expect(result).toBe(false);
	});
});

describe("checkConcurrencyLimits", () => {
	let checkConcurrencyLimits: typeof import("../lib/thread-dispatch.js").checkConcurrencyLimits;

	beforeEach(async () => {
		const mod = await import("../lib/thread-dispatch.js");
		checkConcurrencyLimits = mod.checkConcurrencyLimits;
	});

	it("allows when no hive metadata exists", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [] });

		const result = await checkConcurrencyLimits("tenant-1", "agent-1");
		expect(result.allowed).toBe(true);
	});

	it("allows when under maxPerAgent limit", async () => {
		mockExecute
			.mockResolvedValueOnce({
				rows: [{ metadata: { concurrency: { maxPerAgent: 3 } } }],
			})
			.mockResolvedValueOnce({ rows: [{ count: 2 }] });

		const result = await checkConcurrencyLimits("tenant-1", "agent-1");
		expect(result.allowed).toBe(true);
	});

	it("blocks when at maxPerAgent limit", async () => {
		mockExecute
			.mockResolvedValueOnce({
				rows: [{ metadata: { concurrency: { maxPerAgent: 3 } } }],
			})
			.mockResolvedValueOnce({ rows: [{ count: 3 }] });

		const result = await checkConcurrencyLimits("tenant-1", "agent-1");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("agent_limit_reached");
	});

	it("blocks when at maxConcurrentAgents limit", async () => {
		mockExecute
			.mockResolvedValueOnce({
				rows: [{ metadata: { concurrency: { maxConcurrentAgents: 2 } } }],
			})
			.mockResolvedValueOnce({ rows: [{ count: 2 }] });

		const result = await checkConcurrencyLimits("tenant-1", "agent-1");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("global_agent_limit_reached");
	});

	it("blocks when per-status limit is reached", async () => {
		mockExecute
			.mockResolvedValueOnce({
				rows: [{ metadata: { concurrency: { maxByStatus: { in_progress: 5 } } } }],
			})
			.mockResolvedValueOnce({ rows: [{ count: 5 }] });

		const result = await checkConcurrencyLimits("tenant-1", "agent-1");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("status_limit_reached");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. END-TO-END SIGNAL FLOW
// ═══════════════════════════════════════════════════════════════════════════

describe.skip("end-to-end signal flow (removed)", () => {
	it("parseSignal → processSignal(done) → release + unblock cascade", async () => {
		const { processSignal } = await import("../lib/orchestration/signal-processor.js");

		// Simulate agent response with done signal
		const agentResponse = [
			"I've completed the data analysis. Here are the findings:",
			"- Revenue up 15%",
			"- Costs down 3%",
			"",
			"```thinkwork-signal",
			'{"signal":"done"}',
			"```",
		].join("\n");

		// 1. Parse signal
		const parsed = parseSignal(agentResponse);
		expect(parsed.signal).toBe("done");
		expect(parsed.cleanResponse).toContain("Revenue up 15%");
		expect(parsed.cleanResponse).not.toContain("thinkwork-signal");

		// 2. Process signal — releases thread as done
		await processSignal({
			signal: parsed.signal,
			signalMetadata: parsed.metadata,
			threadId: "thread-1",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
		});

		const setArgs = mockUpdateSet.mock.calls[0][0];
		expect(setArgs.status).toBe("done");
		expect(setArgs.checkout_run_id).toBeNull();
	});

	it("parseSignal → processSignal(split) → sub-threads + deps + wakeups", async () => {
		const { processSignal } = await import("../lib/orchestration/signal-processor.js");
		const { ensureThreadForWork } = await import("@thinkwork/database-pg");
		const mockEnsure = ensureThreadForWork as ReturnType<typeof vi.fn>;

		const subThreads = [
			{ title: "Part A", description: "First part" },
			{ title: "Part B", description: "Second part", dependencies: [0] },
		];

		const agentResponse = `Splitting task.\n\n\`\`\`thinkwork-signal\n${JSON.stringify({ signal: "split", subThreads })}\n\`\`\``;

		const parsed = parseSignal(agentResponse);
		expect(parsed.signal).toBe("split");
		expect(parsed.metadata?.subThreads).toHaveLength(2);

		// Mock parent thread
		mockSelectWhere.mockResolvedValueOnce([{
			channel: "manual", agent_id: "agent-1",
			identifier: "TICK-1", tenant_id: "tenant-1",
		}]);
		mockExecute.mockResolvedValueOnce({ rows: [] }); // config
		mockExecute.mockResolvedValueOnce({ rows: [{ max_depth: 1 }] }); // depth
		mockEnsure
			.mockResolvedValueOnce({ threadId: "sub-1", identifier: "TICK-2", number: 2 })
			.mockResolvedValueOnce({ threadId: "sub-2", identifier: "TICK-3", number: 3 });

		await processSignal({
			signal: parsed.signal,
			signalMetadata: parsed.metadata,
			threadId: "thread-1",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
		});

		expect(mockEnsure).toHaveBeenCalledTimes(2);
		expect(mockInsert).toHaveBeenCalled();
	});

	it("parseSignal → processSignal(delegate) → reassign + wakeup", async () => {
		const { processSignal } = await import("../lib/orchestration/signal-processor.js");

		const agentResponse = `This needs a different agent.\n\n\`\`\`thinkwork-signal\n{"signal":"delegate","assigneeId":"agent-2","reason":"needs DevOps"}\n\`\`\``;

		const parsed = parseSignal(agentResponse);
		expect(parsed.signal).toBe("delegate");

		await processSignal({
			signal: parsed.signal,
			signalMetadata: parsed.metadata,
			threadId: "thread-1",
			turnId: "turn-1",
			agentId: "agent-1",
			tenantId: "tenant-1",
		});

		// Reassign update
		const reassignCalls = mockUpdateSet.mock.calls.filter(
			(call: unknown[]) => (call[0] as Record<string, unknown>).assignee_id === "agent-2",
		);
		expect(reassignCalls.length).toBe(1);

		// Wakeup for new agent
		const wakeupCalls = mockInsertValues.mock.calls.filter(
			(call: unknown[]) => (call[0] as Record<string, unknown>).source === "thread_assignment",
		);
		expect(wakeupCalls.length).toBe(1);
		expect((wakeupCalls[0][0] as Record<string, unknown>).agent_id).toBe("agent-2");
	});
});
