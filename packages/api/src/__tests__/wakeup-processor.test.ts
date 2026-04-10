/**
 * Wakeup Processor unit tests.
 *
 * Tests the main handler entry point and processWakeup logic including
 * claim loops, agent lookup, budget gating, dependency checks, concurrency
 * limits, AgentCore invocation, cost recording, signal dispatch, and turn loops.
 *
 * Uses vi.mock() for database — no real DB connection needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock drizzle-orm operators (broken symlink in dev) ─────────────────

vi.mock("drizzle-orm", () => ({
	eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
	and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
	sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join("?"), values })),
	asc: vi.fn((col: unknown) => ({ direction: "asc", column: col })),
}));

// ─── Database mocks (same pattern as orchestration.test.ts) ─────────────

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
const mockSelectOrderBy = vi.fn().mockReturnThis();
const mockSelectLimit = vi.fn().mockResolvedValue([]);

// mockSelectWhere must act as both a thenable (for simple queries) and return
// chainable methods like orderBy (for the queued wakeup query). We achieve this
// by making it return a "thenable-chainable" object.
const mockSelectWhere = vi.fn();
const mockSelect = vi.fn().mockReturnValue({
	from: mockSelectFrom,
});
mockSelectFrom.mockReturnValue({ where: mockSelectWhere });

function makeSelectWhereResult(resolvedValue: unknown[] = []) {
	const result = {
		orderBy: mockSelectOrderBy,
		returning: mockUpdateReturning,
		then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
			Promise.resolve(resolvedValue).then(resolve, reject),
	};
	return result;
}
mockSelectWhere.mockImplementation(() => makeSelectWhereResult([]));
mockSelectOrderBy.mockReturnValue({ limit: mockSelectLimit });

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
	agentWakeupRequests: {
		id: "id", tenant_id: "tenant_id", agent_id: "agent_id", status: "status",
		created_at: "created_at", run_id: "run_id",
	},
	threadTurns: {
		id: "id", tenant_id: "tenant_id", agent_id: "agent_id", status: "status",
		thread_id: "thread_id", turn_number: "turn_number",
	},
	threadTurnEvents: {
		id: "id", run_id: "run_id", tenant_id: "tenant_id", agent_id: "agent_id",
	},
	agents: {
		id: "id", adapter_type: "adapter_type", model: "model", name: "name",
		slug: "slug", human_pair_id: "human_pair_id", runtime_config: "runtime_config",
		budget_paused: "budget_paused", last_heartbeat_at: "last_heartbeat_at",
	},
	agentSkills: { id: "id", agent_id: "agent_id", skill_id: "skill_id", config: "config" },
	messages: { id: "id", thread_id: "thread_id", tenant_id: "tenant_id" },
	tenants: { id: "id", slug: "slug" },
	users: { id: "id", name: "name" },
	threads: {
		id: "id", identifier: "identifier", title: "title", description: "description",
		status: "status", priority: "priority", channel: "channel",
	},
	triggers: { id: "id", name: "name" },
	agentCapabilities: { agent_id: "agent_id", capability: "capability", config: "config" },
}));

// ─── Lib mocks ──────────────────────────────────────────────────────────

const mockExtractUsage = vi.fn().mockReturnValue({
	inputTokens: 100, outputTokens: 50, cachedReadTokens: 0, model: "claude-sonnet-4-20250514",
});
const mockRecordCostEvents = vi.fn().mockResolvedValue({ totalUsd: 0.001 });
const mockCheckBudgetAndPause = vi.fn().mockResolvedValue(undefined);
const mockNotifyCostRecorded = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/cost-recording.js", () => ({
	extractUsage: (...args: unknown[]) => mockExtractUsage(...args),
	recordCostEvents: (...args: unknown[]) => mockRecordCostEvents(...args),
	checkBudgetAndPause: (...args: unknown[]) => mockCheckBudgetAndPause(...args),
	notifyCostRecorded: (...args: unknown[]) => mockNotifyCostRecorded(...args),
}));

const mockBuildSkillEnvOverrides = vi.fn().mockResolvedValue(null);
vi.mock("../lib/oauth-token.js", () => ({
	buildSkillEnvOverrides: (...args: unknown[]) => mockBuildSkillEnvOverrides(...args),
}));

const mockEnsureThreadForWork = vi.fn().mockResolvedValue({ threadId: "thread-auto" });
vi.mock("../lib/thread-helpers.js", () => ({
	ensureThreadForWork: (...args: unknown[]) => mockEnsureThreadForWork(...args),
}));

const mockIsThreadBlocked = vi.fn().mockResolvedValue(false);
const mockCheckConcurrencyLimits = vi.fn().mockResolvedValue({ allowed: true });
vi.mock("../lib/thread-dispatch.js", () => ({
	isThreadBlocked: (...args: unknown[]) => mockIsThreadBlocked(...args),
	checkConcurrencyLimits: (...args: unknown[]) => mockCheckConcurrencyLimits(...args),
}));

const mockPromoteNextDeferredWakeup = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/wakeup-defer.js", () => ({
	promoteNextDeferredWakeup: (...args: unknown[]) => mockPromoteNextDeferredWakeup(...args),
}));

const mockParseSignal = vi.fn().mockReturnValue({
	signal: "continue", cleanResponse: "Agent response text", metadata: undefined,
});
const mockProcessSignal = vi.fn().mockResolvedValue(undefined);
const mockResolveWorkflowConfig = vi.fn().mockResolvedValue({
	turnLoop: { enabled: false, maxTurns: 1 },
	workspace: { isolateByThread: false },
	promptTemplate: null,
});
const mockRenderPromptTemplate = vi.fn().mockReturnValue(null);

vi.mock("../lib/orchestration/index.js", () => ({
	parseSignal: (...args: unknown[]) => mockParseSignal(...args),
	processSignal: (...args: unknown[]) => mockProcessSignal(...args),
	resolveWorkflowConfig: (...args: unknown[]) => mockResolveWorkflowConfig(...args),
	renderPromptTemplate: (...args: unknown[]) => mockRenderPromptTemplate(...args),
}));

// ─── Global fetch mock ──────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Import handler after mocks ─────────────────────────────────────────

let handler: () => Promise<{ processed: number; errors: number }>;

// ─── Helpers ────────────────────────────────────────────────────────────

function makeWakeup(overrides: Record<string, unknown> = {}) {
	return {
		id: "wakeup-1",
		tenant_id: "tenant-1",
		agent_id: "agent-1",
		source: "chat_message",
		trigger_detail: null,
		reason: "test",
		payload: { threadId: "thread-1", userMessage: "Hello agent" },
		status: "queued",
		...overrides,
	};
}

function makeAgent(overrides: Record<string, unknown> = {}) {
	return {
		adapter_type: "sdk",
		model: "claude-sonnet-4-20250514",
		name: "Test Agent",
		slug: "test-agent",
		human_pair_id: null,
		runtime_config: {},
		budget_paused: false,
		...overrides,
	};
}

function makeAgentCoreResponse(text: string, usage = {}) {
	return {
		response: text,
		usage: {
			input_tokens: 100,
			output_tokens: 50,
			...usage,
		},
	};
}

/**
 * Set up the standard mock chain for a successful wakeup processing flow.
 * This configures the sequence of DB calls:
 * 1. select().from().where().orderBy().limit() — fetch queued wakeups
 * 2. update().set().where().returning() — claim wakeup
 * 3. select().from().where() — agent lookup
 * 4. select().from().where() — tenant lookup
 * 5. select().from().where() — skills lookup (resolves via mockSelectWhere)
 * 6. select().from().where() — turn count
 * 7. insert().values().returning() — create thread turn
 * 8. update().set().where() — link run_id
 * etc.
 */
function setupStandardFlow(wakeup = makeWakeup(), agent = makeAgent()) {
	const runRecord = { id: "run-1", thread_id: wakeup.payload?.threadId || null };

	// select().from().where().orderBy().limit() — queued wakeups
	// The .where() call here returns the default thenable-chainable with orderBy;
	// the actual data comes from .limit()
	mockSelectLimit.mockResolvedValueOnce([wakeup]);

	// update().set().where().returning() — claim
	mockUpdateReturning.mockResolvedValueOnce([wakeup]);

	// select().from().where() — agent lookup
	// NOTE: We must skip past the .where() call from the queued-wakeup query
	// above (which uses .orderBy().limit()), so we queue TWO mockReturnValueOnce
	// calls — first for the queued-wakeup .where(), second for the agent lookup.
	mockSelectWhere
		.mockReturnValueOnce(makeSelectWhereResult([]))  // queued-wakeup .where() (data comes from .limit())
		.mockReturnValueOnce(makeSelectWhereResult([agent]));  // agent lookup

	// select().from().where() — tenant lookup
	mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([{ slug: "test-tenant" }]));

	// select().from().where() — skills lookup
	mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([]));

	// select().from().where() — turn count for thread
	mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([{ count: 0 }]));

	// insert().values().returning() — create thread_turn
	mockInsertReturning.mockResolvedValueOnce([runRecord]);

	// update().set().where() — link run_id to wakeup (no returning needed)
	// Subsequent update/insert calls use the default mock chain

	// fetch — AgentCore invoke (AppSync notifications are skipped because
	// APPSYNC_ENDPOINT is empty in test env)
	mockFetch.mockResolvedValueOnce({
		ok: true,
		json: async () => makeAgentCoreResponse("Agent response text"),
		text: async () => "Agent response text",
	});

	// insert assistant message returning
	mockInsertReturning.mockResolvedValueOnce([{ id: "msg-1" }]);

	return { runRecord };
}

// ─── Reset mocks ────────────────────────────────────────────────────────

beforeEach(async () => {
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
	mockSelectWhere.mockImplementation(() => makeSelectWhereResult([]));
	mockSelectOrderBy.mockReturnValue({ limit: mockSelectLimit });
	mockSelectLimit.mockResolvedValue([]);
	mockExecute.mockResolvedValue({ rows: [] });

	// Reset lib mocks to defaults
	mockExtractUsage.mockReturnValue({
		inputTokens: 100, outputTokens: 50, cachedReadTokens: 0, model: "claude-sonnet-4-20250514",
	});
	mockRecordCostEvents.mockResolvedValue({ totalUsd: 0.001 });
	mockCheckBudgetAndPause.mockResolvedValue(undefined);
	mockNotifyCostRecorded.mockResolvedValue(undefined);
	mockBuildSkillEnvOverrides.mockResolvedValue(null);
	mockIsThreadBlocked.mockResolvedValue(false);
	mockCheckConcurrencyLimits.mockResolvedValue({ allowed: true });
	mockPromoteNextDeferredWakeup.mockResolvedValue(undefined);
	mockParseSignal.mockReturnValue({
		signal: "continue", cleanResponse: "Agent response text", metadata: undefined,
	});
	mockProcessSignal.mockResolvedValue(undefined);
	mockResolveWorkflowConfig.mockResolvedValue({
		turnLoop: { enabled: false, maxTurns: 1 },
		workspace: { isolateByThread: false },
		promptTemplate: null,
	});
	mockRenderPromptTemplate.mockReturnValue(null);
	mockFetch.mockReset();

	// Dynamically import handler to pick up mocks
	const mod = await import("../handlers/wakeup-processor.js");
	handler = mod.handler;
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. EMPTY QUEUE
// ═══════════════════════════════════════════════════════════════════════════

describe("handler — empty queue", () => {
	it("returns early with {processed: 0, errors: 0} when no queued wakeups", async () => {
		// select().from().where().orderBy().limit() returns empty
		mockSelectLimit.mockResolvedValueOnce([]);

		const result = await handler();

		expect(result).toEqual({ processed: 0, errors: 0 });
		expect(mockSelect).toHaveBeenCalled();
		// Should not attempt any updates
		expect(mockFetch).not.toHaveBeenCalled();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CLAIM LOOP
// ═══════════════════════════════════════════════════════════════════════════

describe("handler — claim loop", () => {
	it("fetches queued wakeups and claims atomically via update", async () => {
		setupStandardFlow();

		await handler();

		// Verify select was called (fetch queued wakeups)
		expect(mockSelect).toHaveBeenCalled();
		expect(mockSelectFrom).toHaveBeenCalled();

		// Verify update was called for claiming (set status=claimed)
		expect(mockUpdate).toHaveBeenCalled();
		const firstUpdateSetArgs = mockUpdateSet.mock.calls[0][0];
		expect(firstUpdateSetArgs.status).toBe("claimed");
		expect(firstUpdateSetArgs.claimed_at).toBeInstanceOf(Date);
	});

	it("skips wakeup if already claimed by another processor", async () => {
		const wakeup = makeWakeup();
		mockSelectLimit.mockResolvedValueOnce([wakeup]);

		// claim returns empty — another processor got it
		mockUpdateReturning.mockResolvedValueOnce([]);

		const result = await handler();

		// Should count as processed (no error thrown), skipped silently
		expect(result.processed).toBe(1);
		expect(result.errors).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. AGENT NOT FOUND
// ═══════════════════════════════════════════════════════════════════════════

describe("handler — agent not found", () => {
	it("marks wakeup as failed when agent not found", async () => {
		const wakeup = makeWakeup();
		mockSelectLimit.mockResolvedValueOnce([wakeup]);

		// claim succeeds
		mockUpdateReturning.mockResolvedValueOnce([wakeup]);

		// agent lookup returns empty
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([]));

		const result = await handler();

		expect(result.processed).toBe(1);
		// failWakeup called — update with status=failed
		const failCalls = mockUpdateSet.mock.calls.filter(
			(call) => call[0].status === "failed",
		);
		expect(failCalls.length).toBeGreaterThanOrEqual(1);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. BUDGET PAUSED
// ═══════════════════════════════════════════════════════════════════════════

describe("handler — budget paused", () => {
	it("skips wakeup and marks as failed when agent is budget-paused", async () => {
		const wakeup = makeWakeup();
		const agent = makeAgent({ budget_paused: true });
		mockSelectLimit.mockResolvedValueOnce([wakeup]);
		mockUpdateReturning.mockResolvedValueOnce([wakeup]);
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([agent]));

		const result = await handler();

		expect(result.processed).toBe(1);
		const failCalls = mockUpdateSet.mock.calls.filter(
			(call) => call[0].status === "failed",
		);
		expect(failCalls.length).toBeGreaterThanOrEqual(1);
		// Should not invoke AgentCore
		expect(mockFetch).not.toHaveBeenCalled();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. DEPENDENCY GATE
// ═══════════════════════════════════════════════════════════════════════════

describe("handler — dependency gate", () => {
	it("skips wakeup when thread is blocked by dependencies", async () => {
		const wakeup = makeWakeup();
		const agent = makeAgent();
		mockSelectLimit.mockResolvedValueOnce([wakeup]);
		mockUpdateReturning.mockResolvedValueOnce([wakeup]);
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([agent]));
		// tenant lookup
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([{ slug: "test-tenant" }]));
		// skills
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([]));
		// turn count
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([{ count: 0 }]));

		mockIsThreadBlocked.mockResolvedValueOnce(true);

		const result = await handler();

		expect(result.processed).toBe(1);
		expect(mockIsThreadBlocked).toHaveBeenCalledWith("thread-1");

		// Should insert a skipped thread_turn
		const insertCalls = mockInsertValues.mock.calls;
		const skippedInsert = insertCalls.find(
			(call) => call[0].status === "skipped" && call[0].error === "blocked_by_dependencies",
		);
		expect(skippedInsert).toBeDefined();

		// Should not invoke AgentCore
		expect(mockFetch).not.toHaveBeenCalled();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. CONCURRENCY GATE
// ═══════════════════════════════════════════════════════════════════════════

describe("handler — concurrency gate", () => {
	it("skips wakeup when concurrency limit reached for thread_assignment source", async () => {
		const wakeup = makeWakeup({ source: "thread_assignment" });
		const agent = makeAgent();
		mockSelectLimit.mockResolvedValueOnce([wakeup]);
		mockUpdateReturning.mockResolvedValueOnce([wakeup]);
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([agent]));
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([{ slug: "test-tenant" }]));
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([]));
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([{ count: 0 }]));

		mockIsThreadBlocked.mockResolvedValueOnce(false);
		mockCheckConcurrencyLimits.mockResolvedValueOnce({
			allowed: false,
			reason: "agent at max concurrent threads",
		});

		const result = await handler();

		expect(result.processed).toBe(1);
		expect(mockCheckConcurrencyLimits).toHaveBeenCalledWith("tenant-1", "agent-1");

		// Should insert a skipped thread_turn with concurrency error
		const insertCalls = mockInsertValues.mock.calls;
		const skippedInsert = insertCalls.find(
			(call) =>
				call[0].status === "skipped" &&
				typeof call[0].error === "string" &&
				call[0].error.includes("concurrency_limit"),
		);
		expect(skippedInsert).toBeDefined();

		// Should not invoke AgentCore
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("does not check concurrency for chat_message source", async () => {
		setupStandardFlow();

		await handler();

		// chat_message source should NOT trigger concurrency check
		expect(mockCheckConcurrencyLimits).not.toHaveBeenCalled();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. SUCCESSFUL INVOCATION
// ═══════════════════════════════════════════════════════════════════════════

describe("handler — successful invocation", () => {
	it("invokes AgentCore, inserts message, and records cost on success", async () => {
		setupStandardFlow();

		const result = await handler();

		expect(result.processed).toBe(1);
		expect(result.errors).toBe(0);

		// Verify AgentCore was called
		expect(mockFetch).toHaveBeenCalled();
		const fetchCall = mockFetch.mock.calls[0];
		expect(fetchCall[1].method).toBe("POST");
		const body = JSON.parse(fetchCall[1].body);
		expect(body.tenant_id).toBe("tenant-1");
		expect(body.assistant_id).toBe("agent-1");
		expect(body.message).toContain("Hello agent");

		// Verify message was inserted
		expect(mockInsert).toHaveBeenCalled();

		// Verify cost recording
		expect(mockRecordCostEvents).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: "tenant-1",
				agentId: "agent-1",
				requestId: "wakeup-1",
			}),
		);

		// Verify budget check
		expect(mockCheckBudgetAndPause).toHaveBeenCalledWith("tenant-1", "agent-1");
	});

	it("marks wakeup as completed after success", async () => {
		setupStandardFlow();

		await handler();

		// Find the update call that sets status=completed on the wakeup
		const completedCalls = mockUpdateSet.mock.calls.filter(
			(call) => call[0].status === "completed",
		);
		expect(completedCalls.length).toBeGreaterThanOrEqual(1);
	});

	it("promotes next deferred wakeup after completion", async () => {
		setupStandardFlow();

		await handler();

		expect(mockPromoteNextDeferredWakeup).toHaveBeenCalledWith("tenant-1", "thread-1");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. AGENTCORE FAILURE
// ═══════════════════════════════════════════════════════════════════════════

describe("handler — AgentCore failure", () => {
	it("records error when AgentCore returns non-200", async () => {
		const wakeup = makeWakeup();
		const agent = makeAgent();
		const runRecord = { id: "run-1", thread_id: "thread-1" };

		mockSelectLimit.mockResolvedValueOnce([wakeup]);
		mockUpdateReturning.mockResolvedValueOnce([wakeup]);
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([agent]));
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([{ slug: "test-tenant" }]));
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([]));
		mockSelectWhere.mockReturnValueOnce(makeSelectWhereResult([{ count: 0 }]));
		mockInsertReturning.mockResolvedValueOnce([runRecord]);

		// AgentCore returns 500 (AppSync notifications are skipped because
		// APPSYNC_ENDPOINT is empty in test env)
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			text: async () => "Internal Server Error",
		});

		// Error reply message insert
		mockInsertReturning.mockResolvedValueOnce([{ id: "err-msg-1" }]);

		const result = await handler();

		// processWakeup handles the error internally (does not re-throw),
		// so the outer handler counts it as processed, not errored
		expect(result.processed).toBe(1);
		expect(result.errors).toBe(0);

		// Verify thread_turn was marked failed
		const failedCalls = mockUpdateSet.mock.calls.filter(
			(call) => call[0].status === "failed" && call[0].error,
		);
		expect(failedCalls.length).toBeGreaterThanOrEqual(1);
		expect(failedCalls[0][0].error).toContain("AgentCore invoke failed");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. SIGNAL DISPATCH
// ═══════════════════════════════════════════════════════════════════════════

describe("handler — signal dispatch", () => {
	it("calls processSignal when parseSignal returns non-continue signal", async () => {
		mockParseSignal.mockReturnValue({
			signal: "done",
			cleanResponse: "Task completed.",
			metadata: { reason: "All work finished" },
		});

		setupStandardFlow();

		await handler();

		expect(mockProcessSignal).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "done",
				threadId: "thread-1",
				agentId: "agent-1",
				tenantId: "tenant-1",
				turnId: "run-1",
			}),
		);
	});

	it("does not call processSignal for continue signal", async () => {
		mockParseSignal.mockReturnValue({
			signal: "continue",
			cleanResponse: "Still working...",
			metadata: undefined,
		});

		setupStandardFlow();

		await handler();

		expect(mockProcessSignal).not.toHaveBeenCalled();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. TURN LOOP
// ═══════════════════════════════════════════════════════════════════════════

describe("handler — turn loop", () => {
	it("re-invokes on continue signal when turn loop is enabled", async () => {
		mockResolveWorkflowConfig.mockResolvedValue({
			turnLoop: { enabled: true, maxTurns: 3 },
			workspace: { isolateByThread: false },
			promptTemplate: null,
		});

		// First invocation returns continue, second returns done
		let callCount = 0;
		mockParseSignal.mockImplementation(() => {
			callCount++;
			if (callCount <= 2) {
				return { signal: "continue", cleanResponse: "Still working...", metadata: undefined };
			}
			return { signal: "done", cleanResponse: "Done!", metadata: undefined };
		});

		setupStandardFlow();

		// Second AgentCore invocation (turn loop iteration 2)
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => makeAgentCoreResponse("Still working..."),
			text: async () => "Still working...",
		});

		// Third AgentCore invocation (turn loop iteration 3 — maxTurns)
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => makeAgentCoreResponse("Done!"),
			text: async () => "Done!",
		});

		// Extra AppSync calls for loop iterations
		mockFetch.mockResolvedValue({
			ok: true,
			text: async () => '{"data":{}}',
		});

		await handler();

		// AgentCore should be called at least twice (initial + loop iterations)
		const agentCoreCalls = mockFetch.mock.calls.filter(
			(call) => call[1]?.method === "POST" && typeof call[1]?.body === "string" && call[1].body.includes("assistant_id"),
		);
		expect(agentCoreCalls.length).toBeGreaterThanOrEqual(2);
	});

	it("stops at maxTurns even if signal is still continue", async () => {
		mockResolveWorkflowConfig.mockResolvedValue({
			turnLoop: { enabled: true, maxTurns: 2 },
			workspace: { isolateByThread: false },
			promptTemplate: null,
		});

		mockParseSignal.mockReturnValue({
			signal: "continue",
			cleanResponse: "Still working...",
			metadata: undefined,
		});

		setupStandardFlow();

		// One additional AgentCore call for turn 2
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => makeAgentCoreResponse("Still working..."),
			text: async () => "Still working...",
		});

		// Extra AppSync calls
		mockFetch.mockResolvedValue({
			ok: true,
			text: async () => '{"data":{}}',
		});

		await handler();

		// Should have exactly 2 AgentCore invocations (initial + 1 loop)
		const agentCoreCalls = mockFetch.mock.calls.filter(
			(call) => call[1]?.method === "POST" && typeof call[1]?.body === "string" && call[1].body.includes("assistant_id"),
		);
		expect(agentCoreCalls.length).toBe(2);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. COST RECORDING
// ═══════════════════════════════════════════════════════════════════════════

describe("handler — cost recording", () => {
	it("calls recordCostEvents with usage data after success", async () => {
		mockExtractUsage.mockReturnValue({
			inputTokens: 200,
			outputTokens: 100,
			cachedReadTokens: 50,
			model: "claude-sonnet-4-20250514",
		});

		setupStandardFlow();

		await handler();

		expect(mockExtractUsage).toHaveBeenCalled();
		expect(mockRecordCostEvents).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: "tenant-1",
				agentId: "agent-1",
				requestId: "wakeup-1",
				model: "claude-sonnet-4-20250514",
				inputTokens: 200,
				outputTokens: 100,
				cachedReadTokens: 50,
				threadId: "thread-1",
			}),
		);
	});

	it("calls notifyCostRecorded when totalUsd > 0", async () => {
		mockRecordCostEvents.mockResolvedValue({ totalUsd: 0.05 });

		setupStandardFlow();

		await handler();

		expect(mockNotifyCostRecorded).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: "tenant-1",
				agentId: "agent-1",
				agentName: "Test Agent",
				eventType: "invocation",
				amountUsd: 0.05,
			}),
		);
	});

	it("does not fail the wakeup if cost recording throws", async () => {
		mockRecordCostEvents.mockRejectedValueOnce(new Error("cost DB down"));

		setupStandardFlow();

		const result = await handler();

		// Should still succeed — cost errors are non-fatal
		expect(result.processed).toBe(1);
		expect(result.errors).toBe(0);
	});
});
