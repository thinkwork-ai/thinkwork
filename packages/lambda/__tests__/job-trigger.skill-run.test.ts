/**
 * Tests for the skill_run branch in packages/lambda/job-trigger.ts (Unit 6).
 *
 * Scenarios covered (per plan):
 *   * happy path: fires → skill_runs row inserted → AgentCore invoked
 *   * skill disabled → skipped_disabled row, no invoke
 *   * invoker deprovisioned → scheduled_jobs.enabled=false, no row
 *   * invalid binding → failed row with invalid_binding reason, no invoke
 *   * dedup hit: INSERT returns zero rows → no invoke
 *   * binding resolver: from_tenant_config / today_plus_N / literal / plain
 *
 * DB + Lambda client mocked at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
	mockSelect,
	mockInsert,
	mockUpdate,
	mockLambdaSend,
} = vi.hoisted(() => ({
	mockSelect: vi.fn(),
	mockInsert: vi.fn(),
	mockUpdate: vi.fn(),
	mockLambdaSend: vi.fn(),
}));

// Rows returned by `db.select().from().where()` — routed by a tag the caller
// sets via mockSelect.mockReturnValueOnce({ tag, rows }).
type Rows = Record<string, unknown>[];

const selectChain = (rows: Rows) => ({
	from: () => ({
		where: () => Promise.resolve(rows),
	}),
});

const insertChain = (rows: Rows) => ({
	values: () => ({
		returning: () => Promise.resolve(rows),
		onConflictDoNothing: () => ({
			returning: () => Promise.resolve(rows),
		}),
	}),
});

const updateChain = () => ({
	set: () => ({
		where: () => Promise.resolve(),
		returning: () => Promise.resolve([]),
	}),
});

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => ({
		select: () => selectChain((mockSelect() as Rows) ?? []),
		insert: () => insertChain((mockInsert() as Rows) ?? []),
		update: () => {
			mockUpdate();
			return updateChain();
		},
	}),
	ensureThreadForWork: vi.fn(),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
	agentWakeupRequests: { id: "agent_wakeup_requests.id" },
	agents: { id: "agents.id" },
	agentSkills: {
		id: "agent_skills.id",
		agent_id: "agent_skills.agent_id",
		skill_id: "agent_skills.skill_id",
		enabled: "agent_skills.enabled",
	},
	evalRuns: { id: "eval_runs.id" },
	scheduledJobs: {
		id: "scheduled_jobs.id",
		enabled: "scheduled_jobs.enabled",
		name: "scheduled_jobs.name",
		config: "scheduled_jobs.config",
	},
	skillRuns: {
		id: "skill_runs.id",
		tenant_id: "skill_runs.tenant_id",
		invoker_user_id: "skill_runs.invoker_user_id",
		skill_id: "skill_runs.skill_id",
		resolved_inputs_hash: "skill_runs.resolved_inputs_hash",
	},
	tenantSettings: {
		tenant_id: "tenant_settings.tenant_id",
		features: "tenant_settings.features",
	},
	threadTurns: { id: "thread_turns.id" },
	users: {
		id: "users.id",
	},
}));

vi.mock("drizzle-orm", () => ({
	and: (...args: unknown[]) => ({ _and: args }),
	eq: (...args: unknown[]) => ({ _eq: args }),
	sql: (...args: unknown[]) => ({ _sql: args }),
}));

vi.mock("@aws-sdk/client-lambda", () => ({
	LambdaClient: vi.fn().mockImplementation(() => ({ send: mockLambdaSend })),
	InvokeCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

// After mocks — import the handler + the exported binding resolver.
import { handler, resolveInputBindings } from "../job-trigger.js";

const BASE_EVENT = {
	triggerId: "job-1",
	triggerType: "skill_run",
	tenantId: "T1",
	scheduleName: "thinkwork-T1-sales-prep-daily",
};

const JOB_CONFIG = (
	overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
	skillId: "sales-prep",
	invokerUserId: "U1",
	agentId: "A1",
	inputBindings: {
		customer: "ABC Fuels",
		meeting_date: { today_plus_N: 1 },
	},
	...overrides,
});

const pushJobLookup = (config: Record<string, unknown> = JOB_CONFIG()): void => {
	// 1st select: fetch scheduledJobs row — the handler always runs this.
	mockSelect.mockReturnValueOnce([
		{ enabled: true, name: "Sales prep daily", config },
	]);
};

const pushInvokerLookup = (found: boolean): void => {
	mockSelect.mockReturnValueOnce(found ? [{ id: "U1" }] : []);
};

const pushTenantSettings = (
	features: Record<string, unknown> | null = {},
): void => {
	mockSelect.mockReturnValueOnce([{ features }]);
};

const pushAgentSkillEnablement = (enabled: boolean | null): void => {
	mockSelect.mockReturnValueOnce(enabled === null ? [] : [{ enabled }]);
};

beforeEach(() => {
	vi.clearAllMocks();
	process.env.AGENTCORE_FUNCTION_NAME = "thinkwork-dev-api-agentcore-invoke";
	mockLambdaSend.mockResolvedValue({ FunctionError: undefined, Payload: undefined });
});

// ---------------------------------------------------------------------------
// Binding resolver (pure function)
// ---------------------------------------------------------------------------

describe("resolveInputBindings", () => {
	it("returns literal plain values unchanged", async () => {
		const out = await resolveInputBindings(
			{ a: "hello", b: 42, c: true, d: null },
			{ tenantId: "T", tenantSettingsBlob: {}, now: new Date() },
		);
		expect(out).toEqual({ ok: true, resolved: { a: "hello", b: 42, c: true, d: null } });
	});

	it("resolves { literal: X } envelopes", async () => {
		const out = await resolveInputBindings(
			{ x: { literal: { nested: 1 } } },
			{ tenantId: "T", tenantSettingsBlob: {}, now: new Date() },
		);
		expect((out as { ok: true; resolved: Record<string, unknown> }).resolved.x).toEqual({ nested: 1 });
	});

	it("pulls from_tenant_config from the settings blob", async () => {
		const out = await resolveInputBindings(
			{ customer: { from_tenant_config: "default_customer" } },
			{ tenantId: "T", tenantSettingsBlob: { default_customer: "ABC" }, now: new Date() },
		);
		expect(out).toEqual({ ok: true, resolved: { customer: "ABC" } });
	});

	it("surfaces missing from_tenant_config keys", async () => {
		const out = await resolveInputBindings(
			{ customer: { from_tenant_config: "missing_key" } },
			{ tenantId: "T", tenantSettingsBlob: {}, now: new Date() },
		);
		expect(out.ok).toBe(false);
		expect((out as { ok: false; missing: string[] }).missing).toEqual([
			"customer: from_tenant_config=missing_key",
		]);
	});

	it("renders today_plus_N as ISO date string", async () => {
		const now = new Date("2026-05-01T00:00:00Z");
		const out = await resolveInputBindings(
			{ d0: { today_plus_N: 0 }, d1: { today_plus_N: 1 }, d7: { today_plus_N: 7 } },
			{ tenantId: "T", tenantSettingsBlob: {}, now },
		);
		expect(out).toEqual({
			ok: true,
			resolved: { d0: "2026-05-01", d1: "2026-05-02", d7: "2026-05-08" },
		});
	});

	it("rejects unknown binding shapes", async () => {
		// Deliberately passing an unknown envelope shape — testing the guard.
		const bindings = { x: { some_future_binding: "y" } } as unknown as Parameters<
			typeof resolveInputBindings
		>[0];
		const out = await resolveInputBindings(bindings, {
			tenantId: "T", tenantSettingsBlob: {}, now: new Date(),
		});
		expect(out.ok).toBe(false);
		expect((out as { ok: false; missing: string[] }).missing[0]).toMatch(/unknown binding shape/);
	});
});

// ---------------------------------------------------------------------------
// handler — skill_run branch
// ---------------------------------------------------------------------------

describe("job-trigger skill_run happy path", () => {
	it("inserts a running skill_runs row and invokes agentcore-invoke", async () => {
		pushJobLookup();
		pushInvokerLookup(true);
		pushTenantSettings({});
		pushAgentSkillEnablement(true);
		// INSERT returns the new row
		mockInsert.mockReturnValueOnce([{
			id: "run-1", skill_version: 1,
		}]);

		await handler(BASE_EVENT as never);

		expect(mockLambdaSend).toHaveBeenCalledTimes(1);
		const cmd = mockLambdaSend.mock.calls[0]![0] as { input: { FunctionName: string; Payload: Uint8Array } };
		const payload = JSON.parse(new TextDecoder().decode(cmd.input.Payload));
		expect(payload.body).toBeDefined();
		const envelope = JSON.parse(payload.body);
		expect(envelope.kind).toBe("run_skill");
		expect(envelope.runId).toBe("run-1");
		expect(envelope.tenantId).toBe("T1");
		expect(envelope.invokerUserId).toBe("U1");
		expect(envelope.invocationSource).toBe("scheduled");
		// Regression pin for P0: agentId must flow through; Python
		// dispatcher rejects null-agent envelopes with
		// _MISSING_AGENT_REASON and the scheduled path would go dark.
		expect(envelope.agentId).toBe("A1");
		expect(envelope.resolvedInputs.customer).toBe("ABC Fuels");
		expect(envelope.resolvedInputs.meeting_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		// U4 contract — must stay asynchronous so the agent loop has the
		// full 900s AgentCore Lambda budget.
		expect(cmd.input).toMatchObject({ InvocationType: "Event" });
	});
});

describe("job-trigger skill_run skill-disabled path", () => {
	it("writes skipped_disabled row and does not invoke", async () => {
		pushJobLookup();
		pushInvokerLookup(true);
		pushTenantSettings({});
		pushAgentSkillEnablement(false);
		mockInsert.mockReturnValueOnce([]);

		await handler(BASE_EVENT as never);

		expect(mockInsert).toHaveBeenCalledTimes(1);
		expect(mockLambdaSend).not.toHaveBeenCalled();
	});

	it("writes skipped_disabled row when agent_skills row is absent", async () => {
		pushJobLookup();
		pushInvokerLookup(true);
		pushTenantSettings({});
		pushAgentSkillEnablement(null);
		mockInsert.mockReturnValueOnce([]);

		await handler(BASE_EVENT as never);

		expect(mockInsert).toHaveBeenCalledTimes(1);
		expect(mockLambdaSend).not.toHaveBeenCalled();
	});
});

describe("job-trigger skill_run deprovisioned path", () => {
	it("pauses the scheduled job and does not insert a skill_runs row", async () => {
		pushJobLookup();
		pushInvokerLookup(false);

		await handler(BASE_EVENT as never);

		expect(mockUpdate).toHaveBeenCalledTimes(1);
		expect(mockInsert).not.toHaveBeenCalled();
		expect(mockLambdaSend).not.toHaveBeenCalled();
	});
});

describe("job-trigger skill_run invalid-binding path", () => {
	it("writes invalid_binding audit row and does not invoke", async () => {
		pushJobLookup(JOB_CONFIG({
			inputBindings: {
				customer: { from_tenant_config: "missing_key" },
			},
		}));
		pushInvokerLookup(true);
		pushTenantSettings({}); // empty settings → missing_key not found
		mockInsert.mockReturnValueOnce([]);

		await handler(BASE_EVENT as never);

		expect(mockInsert).toHaveBeenCalledTimes(1);
		expect(mockLambdaSend).not.toHaveBeenCalled();
	});
});

describe("job-trigger skill_run dedup path", () => {
	it("does not invoke when INSERT returns zero rows (concurrent fire)", async () => {
		pushJobLookup();
		pushInvokerLookup(true);
		pushTenantSettings({});
		pushAgentSkillEnablement(true);
		mockInsert.mockReturnValueOnce([]); // onConflictDoNothing → no rows

		await handler(BASE_EVENT as never);

		expect(mockLambdaSend).not.toHaveBeenCalled();
	});
});

describe("job-trigger skill_run invoke-failure path", () => {
	it("transitions row to failed when agentcore-invoke throws", async () => {
		pushJobLookup();
		pushInvokerLookup(true);
		pushTenantSettings({});
		pushAgentSkillEnablement(true);
		mockInsert.mockReturnValueOnce([{ id: "run-1", skill_version: 1 }]);
		mockLambdaSend.mockResolvedValueOnce({
			FunctionError: "Unhandled",
			Payload: new TextEncoder().encode("boom"),
		});

		await handler(BASE_EVENT as never);

		expect(mockUpdate).toHaveBeenCalledTimes(1); // the skill_runs → failed transition
	});
});

describe("job-trigger skill_run no-agent path", () => {
	it("skips the agent_skills check when no agentId is configured", async () => {
		pushJobLookup(JOB_CONFIG({ agentId: undefined }));
		pushInvokerLookup(true);
		pushTenantSettings({});
		// No agent enablement lookup — next lookup is not called
		mockInsert.mockReturnValueOnce([{ id: "run-1", skill_version: 1 }]);

		await handler(BASE_EVENT as never);

		// Three selects: scheduledJobs + users + tenantSettings. No agent_skills.
		expect(mockSelect).toHaveBeenCalledTimes(3);
		expect(mockLambdaSend).toHaveBeenCalledTimes(1);
	});
});

describe("job-trigger skill_run misconfiguration", () => {
	it("early-returns when skillId is missing", async () => {
		pushJobLookup({ invokerUserId: "U1", agentId: "A1" });

		await handler(BASE_EVENT as never);

		expect(mockInsert).not.toHaveBeenCalled();
		expect(mockLambdaSend).not.toHaveBeenCalled();
	});

	it("early-returns when invokerUserId is missing", async () => {
		pushJobLookup({ skillId: "sales-prep" });

		await handler(BASE_EVENT as never);

		expect(mockInsert).not.toHaveBeenCalled();
		expect(mockLambdaSend).not.toHaveBeenCalled();
	});
});
