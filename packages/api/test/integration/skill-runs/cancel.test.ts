/**
 * Integration: cancelSkillRun flips status before the composition script
 * finishes. The harness doesn't model partial-branch execution, but it
 * does model the state transition: a run in `running` can move to
 * `cancelled`, and a subsequent dedup-shaped insert with identical
 * inputs slots cleanly as a fresh run (the dedup slot frees on any
 * terminal status, not just `complete`).
 */

import { describe, it, expect } from "vitest";
import { createHarness } from "./_harness";

describe("integration: cancelSkillRun frees the dedup slot", () => {
	it("lets a fresh run with identical inputs start after cancellation", async () => {
		const h = createHarness();
		// Hanging first invoke until we decide to cancel.
		let resolveFirst: (v: { ok: true }) => void = () => {};
		const first = new Promise<{ ok: true }>((r) => { resolveFirst = r; });
		h.agentcore.setScript(() => first);

		const p1 = h.startRun({
			skillId: "sales-prep",
			invocationSource: "chat",
			inputs: { customer: "ABC", meeting_date: "2026-05-10" },
		});

		// Grab the inserted row (hash fingerprint is what matters).
		const running = h.runs.all().find((r) => r.status === "running");
		expect(running).toBeDefined();
		await h.cancelRun(running!.id);

		// Resolve the hanging script to clean up, though the run is
		// already cancelled.
		resolveFirst({ ok: true });
		await p1;

		expect(h.runs.byId(running!.id)?.status).toBe("cancelled");

		// Now a fresh run with the same inputs should insert cleanly.
		h.agentcore.setScript(async () => ({ ok: true }));
		const r2 = await h.startRun({
			skillId: "sales-prep",
			invocationSource: "chat",
			inputs: { customer: "ABC", meeting_date: "2026-05-10" },
		});
		expect(r2.ok).toBe(true);
		if (!r2.ok) return;
		expect(r2.deduped).toBe(false);
	});
});
