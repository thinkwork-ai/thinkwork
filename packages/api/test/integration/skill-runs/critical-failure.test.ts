/**
 * Integration: a critical gather branch fails → run moves to `failed` →
 * deliverable is NOT attached. Non-critical branches would degrade
 * gracefully via `continue_with_footer`, but a critical branch failure
 * aborts the whole composition (plan R2 + deliverable-shape test invariant).
 */

import { describe, it, expect } from "vitest";
import { createHarness } from "./_harness";

describe("integration: critical-branch failure aborts the run", () => {
	it("flips status to failed and records a failure reason", async () => {
		const h = createHarness();
		h.agentcore.setScript(async () => ({
			ok: false,
			error: "crm_account_summary (critical) timed out after 120s",
		}));

		const result = await h.startRun({
			skillId: "sales-prep",
			invocationSource: "chat",
			inputs: { customer: "ABC", meeting_date: "2026-05-10" },
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.status).toBe("failed");
		const row = h.runs.all().find((r) => r.skill_id === "sales-prep");
		expect(row?.status).toBe("failed");
		expect(row?.delivered_artifact_ref).toBeNull();
		expect(row?.failure_reason).toContain("critical");
	});
});
