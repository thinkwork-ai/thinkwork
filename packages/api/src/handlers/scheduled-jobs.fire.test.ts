/**
 * Verifies the manual-fire route routes agent-typed schedules to the linked
 * Computer's task queue and never to the legacy `agent_wakeup_requests` →
 * wakeup-processor → Flue path.
 *
 * Regression context: a scheduled job whose underlying agent had
 * `runtime = "flue"` was being fired through wakeup-processor, which read
 * the agent's runtime column and dispatched to the Flue Lambda. Flue 400'd
 * because the legacy `requested_by_actor_id` plumbing was missing too.
 * Automations must run on Computers (Strands) — never Flue.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const mocks = vi.hoisted(() => ({
	requireTenantMembership: vi.fn(),
	ensureThreadForWork: vi.fn(),
	// db.select(...) call recorders, keyed by table object reference so
	// the test can distinguish which path the handler took.
	selectFromScheduledJobs: vi.fn(),
	selectFromComputers: vi.fn(),
	selectFromAgents: vi.fn(),
	// db.insert(table).values(...).returning() recorders.
	insertIntoMessages: vi.fn(),
	insertIntoComputerTasks: vi.fn(),
	insertIntoComputerEvents: vi.fn(),
	insertIntoAgentWakeupRequests: vi.fn(),
	insertIntoEvalRuns: vi.fn(),
	updateAgents: vi.fn(),
	lambdaSend: vi.fn(),
}));

vi.mock("../lib/tenant-membership.js", () => ({
	requireTenantMembership: mocks.requireTenantMembership,
}));

vi.mock("../lib/thread-helpers.js", () => ({
	ensureThreadForWork: mocks.ensureThreadForWork,
}));

vi.mock("@thinkwork/database-pg/schema", () => {
	// Sentinel table objects so the mock db can route by reference.
	const make = (name: string) =>
		new Proxy(
			{ __tableName: name },
			{
				get: (target: { __tableName: string }, prop: string) => {
					if (prop === "__tableName") return target.__tableName;
					if (typeof prop === "symbol") return undefined;
					return { __column: `${name}.${prop}` };
				},
			},
		);
	return {
		scheduledJobs: make("scheduledJobs"),
		threadTurns: make("threadTurns"),
		threadTurnEvents: make("threadTurnEvents"),
		agentWakeupRequests: make("agentWakeupRequests"),
		agents: make("agents"),
		computers: make("computers"),
		computerTasks: make("computerTasks"),
		computerEvents: make("computerEvents"),
		evalRuns: make("evalRuns"),
		messages: make("messages"),
	};
});

vi.mock("../lib/db.js", () => {
	const tableName = (obj: unknown): string => {
		if (obj && typeof obj === "object" && "__tableName" in obj) {
			return (obj as { __tableName: string }).__tableName;
		}
		return "<unknown>";
	};

	const select = (_projection?: unknown) => {
		return {
			from: (table: unknown) => {
				const t = tableName(table);
				const exec = async (): Promise<unknown[]> => {
					if (t === "scheduledJobs")
						return mocks.selectFromScheduledJobs();
					if (t === "computers") return mocks.selectFromComputers();
					if (t === "agents") return mocks.selectFromAgents();
					return [];
				};
				return {
					where: (_cond: unknown) => ({
						then: (resolve: (rows: unknown[]) => unknown) =>
							exec().then(resolve),
						limit: () => exec(),
					}),
				};
			},
		};
	};

	const insert = (table: unknown) => {
		const t = tableName(table);
		const dispatchInsert = (values: Record<string, unknown>) => {
			if (t === "messages")
				return mocks.insertIntoMessages({ values });
			if (t === "computerTasks")
				return mocks.insertIntoComputerTasks({ values });
			if (t === "computerEvents")
				return mocks.insertIntoComputerEvents({ values });
			if (t === "agentWakeupRequests")
				return mocks.insertIntoAgentWakeupRequests({ values });
			if (t === "evalRuns") return mocks.insertIntoEvalRuns({ values });
			return [];
		};
		return {
			values: (values: Record<string, unknown>) => ({
				returning: () => Promise.resolve(dispatchInsert(values)),
				onConflictDoNothing: (_args: unknown) => ({
					returning: () => Promise.resolve(dispatchInsert(values)),
				}),
			}),
		};
	};

	const update = (table: unknown) => {
		const t = tableName(table);
		return {
			set: (values: Record<string, unknown>) => ({
				where: (_cond: unknown) => {
					if (t === "agents")
						return mocks.updateAgents({ values });
					return Promise.resolve([]);
				},
			}),
		};
	};

	return { db: { select, insert, update } };
});

vi.mock("@aws-sdk/client-lambda", () => ({
	LambdaClient: vi.fn().mockImplementation(() => ({ send: mocks.lambdaSend })),
	InvokeCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

import { handler } from "./scheduled-jobs.js";

const TENANT_ID = "11111111-2222-3333-4444-555555555555";
const USER_ID = "aaaaaaaa-1111-2222-3333-444444444444";
const AGENT_ID = "c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c";
const COMPUTER_ID = "1715d78f-bf71-40b3-b923-0c7fd5162031";
const TRIGGER_ID = "7ae07953-970b-4b4e-a848-272e1385e8ac";

function fireEvent(): APIGatewayProxyEventV2 {
	return {
		rawPath: `/api/scheduled-jobs/${TRIGGER_ID}/fire`,
		headers: { "x-tenant-id": TENANT_ID, authorization: "Bearer test" },
		body: undefined,
		queryStringParameters: {},
		requestContext: { http: { method: "POST" } },
	} as unknown as APIGatewayProxyEventV2;
}

function schedRow(overrides: Record<string, unknown> = {}) {
	return [
		{
			id: TRIGGER_ID,
			tenant_id: TENANT_ID,
			trigger_type: "agent_scheduled",
			agent_id: AGENT_ID,
			computer_id: COMPUTER_ID,
			routine_id: null,
			name: "Check Package Updates",
			prompt: "Check the upstream repos.",
			config: null,
			...overrides,
		},
	];
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requireTenantMembership.mockResolvedValue({
		ok: true,
		tenantId: TENANT_ID,
		userId: USER_ID,
	});
	mocks.ensureThreadForWork.mockResolvedValue({
		threadId: "thread-1",
		identifier: "AUTO-42",
		number: 42,
	});
	mocks.selectFromComputers.mockResolvedValue([
		{
			id: COMPUTER_ID,
			ownerUserId: "owner-x",
			migratedAgentId: AGENT_ID,
		},
	]);
	mocks.selectFromAgents.mockResolvedValue([]);
	mocks.insertIntoMessages.mockResolvedValue([{ id: "msg-1" }]);
	mocks.insertIntoComputerTasks.mockResolvedValue([{ id: "task-1" }]);
	mocks.insertIntoComputerEvents.mockResolvedValue([{ id: "evt-1" }]);
	mocks.insertIntoAgentWakeupRequests.mockResolvedValue([{ id: "wakeup-1" }]);
	mocks.insertIntoEvalRuns.mockResolvedValue([{ id: "eval-run-1" }]);
	mocks.lambdaSend.mockResolvedValue({
		FunctionError: undefined,
		Payload: undefined,
	});
	mocks.updateAgents.mockResolvedValue([{ id: AGENT_ID }]);
});

describe("scheduled-jobs handler — manual fire routes to Computer (never Flue)", () => {
	it("enqueues a computer_tasks row + ensures a Computer-attached thread", async () => {
		mocks.selectFromScheduledJobs.mockResolvedValue(schedRow());

		const response = await handler(fireEvent());

		expect(response.statusCode).toBe(201);
		const body = JSON.parse(response.body ?? "{}");
		expect(body).toMatchObject({
			ok: true,
			computerId: COMPUTER_ID,
			threadId: "thread-1",
			messageId: "msg-1",
			taskId: "task-1",
			dedup: false,
		});

		expect(mocks.ensureThreadForWork).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: TENANT_ID,
				computerId: COMPUTER_ID,
				userId: USER_ID,
				channel: "schedule",
			}),
		);

		expect(mocks.insertIntoComputerTasks).toHaveBeenCalledTimes(1);
		const taskValues = mocks.insertIntoComputerTasks.mock.calls[0]![0]!
			.values as Record<string, unknown>;
		expect(taskValues.task_type).toBe("thread_turn");
		expect(taskValues.created_by_user_id).toBe(USER_ID);
		expect((taskValues.input as Record<string, unknown>).actorId).toBe(
			USER_ID,
		);

		// Regression: zero entries into the legacy wakeup queue. This is the
		// path that could land on Flue — must not be used for automations.
		expect(mocks.insertIntoAgentWakeupRequests).not.toHaveBeenCalled();
	});

	it("succeeds when scheduled_jobs.computer_id is null and the agent has a migrated Computer", async () => {
		// The handler skips the direct computer_id lookup (column is null)
		// and falls back to looking up `computers.migrated_from_agent_id`.
		// The default `selectFromComputers` mock returns the linked Computer,
		// proving the fallback path resolves to a Computer rather than
		// erroring out — and never touches the legacy wakeup queue.
		mocks.selectFromScheduledJobs.mockResolvedValue(
			schedRow({ computer_id: null }),
		);

		const response = await handler(fireEvent());
		expect(response.statusCode).toBe(201);
		expect(mocks.insertIntoAgentWakeupRequests).not.toHaveBeenCalled();
		expect(mocks.insertIntoComputerTasks).toHaveBeenCalledTimes(1);
	});

	it("returns 409 when no Computer is linked anywhere (no legacy fallback)", async () => {
		mocks.selectFromScheduledJobs.mockResolvedValue(
			schedRow({ computer_id: null }),
		);
		mocks.selectFromComputers.mockResolvedValue([]);

		const response = await handler(fireEvent());
		expect(response.statusCode).toBe(409);
		expect(mocks.insertIntoAgentWakeupRequests).not.toHaveBeenCalled();
		expect(mocks.insertIntoComputerTasks).not.toHaveBeenCalled();
	});

	it("returns 401 when membership succeeds without resolving a user identity", async () => {
		mocks.requireTenantMembership.mockResolvedValue({
			ok: true,
			tenantId: TENANT_ID,
			userId: null,
		});
		mocks.selectFromScheduledJobs.mockResolvedValue(schedRow());

		const response = await handler(fireEvent());
		expect(response.statusCode).toBe(401);
		expect(mocks.insertIntoComputerTasks).not.toHaveBeenCalled();
		expect(mocks.insertIntoAgentWakeupRequests).not.toHaveBeenCalled();
	});

	it("manual-fires eval schedules against agent or computer template ids", async () => {
		mocks.selectFromScheduledJobs.mockResolvedValue(
			schedRow({
				trigger_type: "eval_scheduled",
				agent_id: null,
				computer_id: null,
				config: {
					agentTemplateId: "computer-template-1",
					model: "anthropic.claude-haiku-4-5",
					categories: ["performance-computer"],
				},
			}),
		);

		const response = await handler(fireEvent());

		expect(response.statusCode).toBe(201);
		expect(mocks.insertIntoEvalRuns).toHaveBeenCalledWith({
			values: expect.objectContaining({
				tenant_id: TENANT_ID,
				agent_id: null,
				agent_template_id: "computer-template-1",
				scheduled_job_id: TRIGGER_ID,
				status: "pending",
				model: "anthropic.claude-haiku-4-5",
				categories: ["performance-computer"],
			}),
		});
		expect(mocks.lambdaSend).toHaveBeenCalledTimes(1);
		expect(mocks.insertIntoComputerTasks).not.toHaveBeenCalled();
	});
});
