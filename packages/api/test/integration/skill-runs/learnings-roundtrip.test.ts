/**
 * Integration: the compound learnings loop across two runs.
 *
 * Run 1 executes against an empty memory, reflects a new learning. Run 2
 * with the same scope retrieves that learning via recall. Run 3 with a
 * different user_id should NOT see a user-scoped learning from User 1 but
 * MUST see a tenant-wide learning.
 *
 * This is the concrete adoption criterion behind R9 (learnings improve
 * successive runs) + R12 (compound loop is first-class in the framework).
 */

import { describe, it, expect } from "vitest";
import { createHarness } from "./_harness";

describe("integration: learnings round-trip", () => {
	it("run N+1 sees learnings written by run N under the same scope", async () => {
		const h = createHarness();

		// Run 1: empty memory, reflects a user-scoped learning.
		h.agentcore.setScript(async ({ envelope, memory }) => {
			const prior = memory.recall({
				tenantId: envelope.tenantId,
				userId: envelope.invokerUserId,
				skillId: envelope.skillId,
				subjectEntityId: String(envelope.resolvedInputs.customer),
			});
			expect(prior).toEqual([]);
			memory.reflect({
				tenantId: envelope.tenantId,
				userId: envelope.invokerUserId,
				skillId: envelope.skillId,
				subjectEntityId: String(envelope.resolvedInputs.customer),
				text: "ABC tends to ask about renewal timing first",
			});
			return { ok: true };
		});
		const r1 = await h.startRun({
			skillId: "sales-prep",
			invocationSource: "chat",
			inputs: { customer: "ABC", meeting_date: "2026-05-10" },
		});
		expect(r1.ok).toBe(true);

		// Run 2: same scope → recall returns Run 1's learning.
		h.agentcore.setScript(async ({ envelope, memory }) => {
			const prior = memory.recall({
				tenantId: envelope.tenantId,
				userId: envelope.invokerUserId,
				skillId: envelope.skillId,
				subjectEntityId: String(envelope.resolvedInputs.customer),
			});
			expect(prior.map((l) => l.text)).toContain(
				"ABC tends to ask about renewal timing first",
			);
			return { ok: true };
		});
		const r2 = await h.startRun({
			skillId: "sales-prep",
			invocationSource: "chat",
			inputs: { customer: "ABC", meeting_date: "2026-05-17" },
		});
		expect(r2.ok).toBe(true);
	});

	it("user-scoped learnings do NOT leak across users; tenant-wide ones do", async () => {
		const h = createHarness({ invokerUserId: "user-alpha" });
		h.memory.seedLearnings([
			{
				tenantId: h.tenantId,
				userId: "user-alpha",
				skillId: "sales-prep",
				text: "alpha prefers bullet-point briefs",
			},
			{
				tenantId: h.tenantId,
				// No userId → tenant-wide learning.
				skillId: "sales-prep",
				text: "ACME's legal team reviews all contracts on Fridays",
			},
		]);

		h.agentcore.setScript(async ({ envelope, memory }) => {
			const prior = memory.recall({
				tenantId: envelope.tenantId,
				userId: envelope.invokerUserId,
				skillId: envelope.skillId,
			});
			// User-beta recall should include tenant-wide but exclude alpha-specific.
			if (envelope.invokerUserId === "user-beta") {
				const texts = prior.map((l) => l.text);
				expect(texts).toContain(
					"ACME's legal team reviews all contracts on Fridays",
				);
				expect(texts).not.toContain("alpha prefers bullet-point briefs");
			}
			return { ok: true };
		});

		// Run as user-beta.
		await h.startRun({
			invokerUserId: "user-beta",
			skillId: "sales-prep",
			invocationSource: "chat",
			inputs: { customer: "ACME", meeting_date: "2026-06-01" },
		});
	});
});
