/**
 * Integration: full customer-onboarding reconciler HITL loop.
 *
 * This is the R13 (reconciler-shape adoption) criterion verification:
 *
 *   webhook received →
 *   Tick 1: creates tasks T1, T2, T3 (including a pending-clarification task) →
 *   owner completes T1 (task-event webhook fires) →
 *   Tick 2: creates only the tasks still missing (none new, since T2/T3
 *           already exist and T1 is done) →
 *   owner completes T2 →
 *   Tick 3: same — no duplicate creates →
 *   owner completes T3 →
 *   Tick 4: terminal — zero new tasks.
 *
 * The invariant under test: `lastmile_tasks_create` is called EXACTLY
 * as many times as there are initial gaps, not once per tick. Duplicate
 * task creation is the primary failure mode the reconciler contract
 * guards against (see plan R2 + docs/plans/... reconciler-HITL model).
 */

import { describe, it, expect } from "vitest";
import { createHarness } from "./_harness";

const TENANT = "tenant-reconciler";
const CUSTOMER = "cust-onboard-1";
const OPPORTUNITY = "opp-onboard-1";
const TRIGGER = "customer-onboarding-reconciler";

// The gap analysis the synthesize step would produce on a fresh
// onboarding. Three tasks — one of which is a clarification the agent
// owner needs to answer.
const GAPS: Array<{ summary: string; owner: string }> = [
	{ summary: "Assign CSM pod", owner: "csm-ops" },
	{ summary: "Clarify preferred invoice cadence", owner: "agent-owner" },
	{ summary: "Schedule kickoff call", owner: "cs-lead" },
];

function buildActScript() {
	// The harness's agentcore stub represents the whole composition per
	// tick. This mirrors the `act` sub-skill's decision protocol:
	//   1. Read gaps.
	//   2. Read existing tasks (from the stub task system).
	//   3. Create only the missing ones.
	return async (ctx: {
		envelope: { tenantId: string; resolvedInputs: Record<string, unknown> };
		tasks: {
			list: (a: {
				tenantId: string;
				subjectKind: string;
				subjectId: string;
				trigger: string;
			}) => Array<{ summary: string; status: string }>;
			create: (row: {
				tenantId: string;
				subjectKind: string;
				subjectId: string;
				trigger: string;
				summary: string;
				triggeredByRunId: string | null;
			}) => unknown;
		};
	}) => {
		const existing = ctx.tasks.list({
			tenantId: ctx.envelope.tenantId,
			subjectKind: "customer",
			subjectId: String(ctx.envelope.resolvedInputs.customerId),
			trigger: TRIGGER,
		});
		const existingSummaries = new Set(existing.map((t) => t.summary));
		for (const gap of GAPS) {
			if (existingSummaries.has(gap.summary)) continue;
			ctx.tasks.create({
				tenantId: ctx.envelope.tenantId,
				subjectKind: "customer",
				subjectId: String(ctx.envelope.resolvedInputs.customerId),
				trigger: TRIGGER,
				summary: gap.summary,
				triggeredByRunId: null,
			});
		}
		return { ok: true as const };
	};
}

describe("R13 reconciler-HITL loop — no duplicate task creation", () => {
	it("creates initial tasks on tick 1 and zero duplicates across subsequent ticks", async () => {
		const h = createHarness({ tenantId: TENANT });
		h.agentcore.setScript(buildActScript());

		// Tick 1 — CRM opportunity.won → webhook → kicks reconciler.
		const tick1 = await h.startRun({
			skillId: "customer-onboarding-reconciler",
			invocationSource: "webhook",
			inputs: { customerId: CUSTOMER, opportunityId: OPPORTUNITY },
		});
		expect(tick1.ok).toBe(true);
		expect(h.tasks.createCalls).toHaveLength(3);

		// Agent owner completes the clarification task.
		const clarificationTask = h.tasks
			.allTasks()
			.find((t) => t.summary === "Clarify preferred invoice cadence");
		expect(clarificationTask).toBeDefined();
		h.tasks.complete(clarificationTask!.id);

		// Task-event webhook fires for tick 2 — note the run's inputs are
		// identical to tick 1, but the prior run is in `complete` so dedup
		// doesn't block.
		h.runs.update(
			h.runs.all().find((r) => r.id === (tick1.ok ? tick1.runId : ""))!.id,
			{ status: "complete" },
		);
		const tick2 = await h.startRun({
			skillId: "customer-onboarding-reconciler",
			invocationSource: "webhook",
			inputs: { customerId: CUSTOMER, opportunityId: OPPORTUNITY },
			triggeredByRunId: tick1.ok ? tick1.runId : null,
		});
		expect(tick2.ok).toBe(true);
		// INVARIANT: tick 2 creates ZERO new tasks — the two open tasks
		// are still in the task system, and the one closed task is
		// terminal. Creating any new task here would be a duplicate.
		expect(h.tasks.createCalls).toHaveLength(3);

		// Close another task → tick 3.
		const assignPod = h.tasks
			.allTasks()
			.find((t) => t.summary === "Assign CSM pod");
		h.tasks.complete(assignPod!.id);

		h.runs.update(
			h.runs.all().find((r) => r.id === (tick2.ok ? tick2.runId : ""))!.id,
			{ status: "complete" },
		);
		const tick3 = await h.startRun({
			skillId: "customer-onboarding-reconciler",
			invocationSource: "webhook",
			inputs: { customerId: CUSTOMER, opportunityId: OPPORTUNITY },
			triggeredByRunId: tick2.ok ? tick2.runId : null,
		});
		expect(tick3.ok).toBe(true);
		expect(h.tasks.createCalls).toHaveLength(3);

		// Close the last task → tick 4 is terminal.
		const kickoff = h.tasks
			.allTasks()
			.find((t) => t.summary === "Schedule kickoff call");
		h.tasks.complete(kickoff!.id);

		h.runs.update(
			h.runs.all().find((r) => r.id === (tick3.ok ? tick3.runId : ""))!.id,
			{ status: "complete" },
		);
		const tick4 = await h.startRun({
			skillId: "customer-onboarding-reconciler",
			invocationSource: "webhook",
			inputs: { customerId: CUSTOMER, opportunityId: OPPORTUNITY },
			triggeredByRunId: tick3.ok ? tick3.runId : null,
		});
		expect(tick4.ok).toBe(true);
		// The composition completes cleanly with no new tasks — the
		// reconciler has reached convergence.
		expect(h.tasks.createCalls).toHaveLength(3);

		// Final: four ticks fired, exactly three task creates, zero
		// duplicates — the exact R13 falsification test.
		expect(h.agentcore.envelopes).toHaveLength(4);
		expect(h.tasks.createCalls.map((t) => t.summary)).toEqual([
			"Assign CSM pod",
			"Clarify preferred invoice cadence",
			"Schedule kickoff call",
		]);
	});
});
