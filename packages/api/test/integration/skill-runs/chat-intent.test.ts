/**
 * Integration: chat intent → skill-dispatcher → startSkillRun → skill run
 * completes → deliverable recorded on the run row.
 *
 * This test exercises the chat invocation path's shape: the dispatcher
 * passes a user's typed invocation down to startSkillRun with
 * invocationSource="chat", and the skill run completes with a rendered
 * deliverable that the delivery layer would attach to the thread. We
 * don't run the actual AgentCore dispatch path — the harness scripts a
 * deliverable-shaped run's outcome.
 */

import { describe, it, expect } from "vitest";
import { createHarness } from "./_harness";

describe("integration: chat-intent invocation of sales-prep", () => {
	it("runs end-to-end with a rendered deliverable attached to the run", async () => {
		const h = createHarness();

		h.agentcore.setScript(async ({ envelope, memory }) => {
			// Production dispatch invariant: recall before the run, reflect
			// after it. The harness compresses that into a single scripted
			// tick; the interesting production-boundary behavior is the
			// recall call before + reflect call after, which tests assert
			// separately.
			memory.recall({
				tenantId: envelope.tenantId,
				userId: envelope.invokerUserId,
				skillId: envelope.skillId,
				subjectEntityId: String(envelope.resolvedInputs.customer),
			});
			memory.reflect({
				tenantId: envelope.tenantId,
				userId: envelope.invokerUserId,
				skillId: envelope.skillId,
				subjectEntityId: String(envelope.resolvedInputs.customer),
				text: "meeting_date format was ISO-8601, keep it that way",
			});
			return {
				ok: true,
				deliverable: {
					format: "sales_brief",
					sections: ["risks", "opportunities", "open_questions", "talking_points"],
				},
			};
		});

		const result = await h.startRun({
			skillId: "sales-prep",
			invocationSource: "chat",
			inputs: { customer: "ABC Fuels", meeting_date: "2026-05-10", focus: "risks" },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const row = h.runs.byId(result.runId);
		expect(row?.status).toBe("complete");
		expect(row?.invocation_source).toBe("chat");
		expect(row?.delivered_artifact_ref).toMatchObject({
			type: "inline",
			payload: { format: "sales_brief" },
		});

		// Compound loop invariants.
		expect(h.agentcore.envelopes).toHaveLength(1);
		expect(h.memory.recallCalls).toHaveLength(1);
		expect(h.memory.reflectCalls).toHaveLength(1);
	});
});
