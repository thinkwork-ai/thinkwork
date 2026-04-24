/**
 * Integration: scheduled invocation via job-trigger's skill_run branch.
 *
 * Production path:
 *   EventBridge fires → job-trigger.ts sees triggerType="skill_run" →
 *   resolves bindings → INSERT skill_runs (invocationSource="scheduled")
 *   → invokeAgentcoreRunSkill(Event enqueue, §U4) → agent turn runs out
 *   of band → /api/skills/complete HMAC callback flips row to complete.
 *
 * The harness's startRun() mirrors this sequence; what this test pins is
 * the shape of a scheduled run: `invocation_source="scheduled"`, the
 * agent_id propagates from the scheduled_jobs row, and the dedup slot
 * is freed once the run completes so the next scheduled fire can run.
 */

import { describe, it, expect } from "vitest";
import { createHarness } from "./_harness";

describe("integration: scheduled invocation via job-trigger", () => {
	it("runs the composition and frees the dedup slot on completion", async () => {
		const h = createHarness();
		h.agentcore.setScript(async () => ({ ok: true }));

		const r1 = await h.startRun({
			skillId: "sales-prep",
			invocationSource: "scheduled",
			agentId: "agent-42",
			inputs: { customer: "ABC", meeting_date: "2026-05-01" },
		});
		expect(r1.ok).toBe(true);
		if (!r1.ok) return;
		expect(h.runs.byId(r1.runId)?.invocation_source).toBe("scheduled");
		expect(h.runs.byId(r1.runId)?.agent_id).toBe("agent-42");
		expect(h.runs.byId(r1.runId)?.status).toBe("complete");

		// Tomorrow's scheduled fire — identical inputs would collide if
		// the dedup index stayed held, but status="complete" frees the
		// slot. A second run inserts cleanly.
		const r2 = await h.startRun({
			skillId: "sales-prep",
			invocationSource: "scheduled",
			agentId: "agent-42",
			inputs: { customer: "ABC", meeting_date: "2026-05-01" },
		});
		expect(r2.ok).toBe(true);
		if (!r2.ok) return;
		expect(r2.runId).not.toBe(r1.runId);
		expect(r2.deduped).toBe(false);
	});

	it("dedups when an identical scheduled fire overlaps a still-running one", async () => {
		const h = createHarness();
		// Script hangs — simulates a long-running invoke that hasn't
		// returned. We manually flip the second run to dedup by keeping
		// the first in `running`.
		let resolveFirst: (v: { ok: true }) => void = () => {};
		const firstInvoke = new Promise<{ ok: true }>((r) => { resolveFirst = r; });
		h.agentcore.setScript(() => firstInvoke);

		// Fire first — status stays "running" until we resolveFirst().
		const first = h.startRun({
			skillId: "sales-prep",
			invocationSource: "scheduled",
			inputs: { customer: "ABC", meeting_date: "2026-05-01" },
		});

		// Fire second — identical hash, first is still running → dedup hit.
		const second = await h.startRun({
			skillId: "sales-prep",
			invocationSource: "scheduled",
			inputs: { customer: "ABC", meeting_date: "2026-05-01" },
		});
		expect(second.ok).toBe(true);
		if (!second.ok) return;
		expect(second.deduped).toBe(true);

		// Unblock the first; both resolve.
		resolveFirst({ ok: true });
		await first;
	});
});
