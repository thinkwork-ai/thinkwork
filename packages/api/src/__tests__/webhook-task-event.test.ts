/**
 * Focused resolver test for the task-event handler.
 *
 * The resolver must hit the DB to resolve the prior run's skill_id +
 * inputs, so this test stubs the db lookup. Full HTTP-cycle coverage
 * lives in webhook-shared.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));

type Rows = Record<string, unknown>[];
const selectChain = (rows: Rows) => ({
	from: () => ({ where: () => Promise.resolve(rows) }),
});

vi.mock("../lib/db.js", () => ({
	db: {
		select: () => selectChain((mockSelect() as Rows) ?? []),
	},
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
	skillRuns: {
		id: "skill_runs.id",
		tenant_id: "skill_runs.tenant_id",
		skill_id: "skill_runs.skill_id",
		skill_version: "skill_runs.skill_version",
		resolved_inputs: "skill_runs.resolved_inputs",
		agent_id: "skill_runs.agent_id",
	},
	tenantSystemUsers: {},
}));

vi.mock("drizzle-orm", () => ({
	and: (...a: unknown[]) => ({ _and: a }),
	eq: (...a: unknown[]) => ({ _eq: a }),
	sql: (...a: unknown[]) => ({ _sql: a }),
}));

vi.mock("../graphql/utils.js", () => ({
	hashResolvedInputs: vi.fn(() => "hash-fixed"),
	invokeComposition: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
	SecretsManagerClient: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
	GetSecretValueCommand: vi.fn(),
	ResourceNotFoundException: class extends Error {},
}));

const { resolveTaskEvent } = await import("../handlers/webhooks/task-event.js");

const TENANT = "tenant-a";
const PRIOR_RUN_ID = "run-123";

beforeEach(() => {
	vi.resetAllMocks();
});

describe("resolveTaskEvent", () => {
	it("re-invokes the triggering run's skill with its original inputs", async () => {
		mockSelect.mockReturnValueOnce([
			{
				id: PRIOR_RUN_ID,
				tenant_id: TENANT,
				skill_id: "customer-onboarding-reconciler",
				skill_version: 2,
				resolved_inputs: { customerId: "c-1", opportunityId: "o-1" },
				agent_id: "agent-42",
			},
		]);

		const result = await resolveTaskEvent({
			tenantId: TENANT,
			rawBody: JSON.stringify({
				event: "task.completed",
				taskId: "task-1",
				metadata: { triggeredByRunId: PRIOR_RUN_ID },
			}),
		});

		expect(result).toEqual({
			ok: true,
			skillId: "customer-onboarding-reconciler",
			skillVersion: 2,
			inputs: { customerId: "c-1", opportunityId: "o-1" },
			triggeredByRunId: PRIOR_RUN_ID,
			agentId: "agent-42",
		});
	});

	it("skips events whose type is not task.completed", async () => {
		const result = await resolveTaskEvent({
			tenantId: TENANT,
			rawBody: JSON.stringify({
				event: "task.updated",
				taskId: "t",
				metadata: { triggeredByRunId: PRIOR_RUN_ID },
			}),
		});
		expect(result).toMatchObject({ ok: true, skip: true });
	});

	it("skips tasks without triggeredByRunId rather than guessing", async () => {
		const result = await resolveTaskEvent({
			tenantId: TENANT,
			rawBody: JSON.stringify({ event: "task.completed", taskId: "t" }),
		});
		expect(result).toMatchObject({ ok: true, skip: true });
		expect(result).toMatchObject({
			reason: expect.stringContaining("triggeredByRunId"),
		});
	});

	it("returns 403 when triggeredByRunId belongs to another tenant", async () => {
		// The DB where clause includes `tenant_id = args.tenantId`, so a
		// cross-tenant run returns empty.
		mockSelect.mockReturnValueOnce([]);
		const result = await resolveTaskEvent({
			tenantId: TENANT,
			rawBody: JSON.stringify({
				event: "task.completed",
				taskId: "t",
				metadata: { triggeredByRunId: "foreign-run" },
			}),
		});
		expect(result).toEqual({
			ok: false,
			status: 403,
			message: "triggeredByRunId does not belong to this tenant",
		});
	});

	it("returns 400 on malformed JSON", async () => {
		const result = await resolveTaskEvent({
			tenantId: TENANT,
			rawBody: "not json",
		});
		expect(result).toMatchObject({ ok: false, status: 400 });
	});
});
