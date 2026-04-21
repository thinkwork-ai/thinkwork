/**
 * Integration: CRM webhook → _shared.ts → customer-onboarding-reconciler
 * composition invoked with the tenant system-user actor.
 *
 * This test asserts the webhook-specific invariants end-to-end against the
 * harness:
 *   - actor identity is the tenant system-user, not any caller-provided field
 *   - invocation_source is "webhook"
 *   - the composition receives the resolved inputs (customerId + opportunityId)
 */

import { describe, it, expect } from "vitest";
import { createHarness } from "./_harness";

describe("integration: CRM webhook → reconciler", () => {
	it("dispatches a webhook run under the tenant system-user actor", async () => {
		const h = createHarness({ systemUserId: "sys-tenant-A" });
		h.agentcore.setScript(async () => ({ ok: true }));

		const result = await h.startRun({
			skillId: "customer-onboarding-reconciler",
			invocationSource: "webhook",
			inputs: { customerId: "cust-99", opportunityId: "opp-99" },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const row = h.runs.byId(result.runId);
		expect(row?.invocation_source).toBe("webhook");
		expect(row?.invoker_user_id).toBe("sys-tenant-A");
		const envelope = h.agentcore.envelopes[0];
		expect(envelope.invokerUserId).toBe("sys-tenant-A");
		expect(envelope.resolvedInputs).toEqual({
			customerId: "cust-99",
			opportunityId: "opp-99",
		});
	});
});
