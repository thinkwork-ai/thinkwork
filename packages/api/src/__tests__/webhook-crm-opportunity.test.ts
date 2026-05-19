/**
 * Focused resolver test for the CRM opportunity handler. The full request/
 * response cycle is exercised by webhook-shared.test.ts via a fake resolver;
 * this file pins the CRM-specific resolver contract so the crm-opportunity
 * handler doesn't drift into accepting payload shapes that mismatch the
 * vendor adapter contract.
 */

import { beforeEach, describe, it, expect, vi } from "vitest";

const { mockStartCustomerOnboardingWorkflow } = vi.hoisted(() => ({
	mockStartCustomerOnboardingWorkflow: vi.fn(),
}));

vi.mock("../lib/spaces/customer-onboarding-workflow.js", async () => {
	const actual = await vi.importActual<
		typeof import("../lib/spaces/customer-onboarding-workflow.js")
	>("../lib/spaces/customer-onboarding-workflow.js");
	return {
		...actual,
		startCustomerOnboardingWorkflow: mockStartCustomerOnboardingWorkflow,
	};
});

import { resolveCrmOpportunity } from "../handlers/webhooks/crm-opportunity.js";

const TENANT = "tenant-1";

describe("resolveCrmOpportunity", () => {
	beforeEach(() => {
		mockStartCustomerOnboardingWorkflow.mockReset();
		mockStartCustomerOnboardingWorkflow.mockResolvedValue({
			thread: { id: "thread-1" },
			idempotent: false,
			linkedTasks: [{ externalTaskId: "LM-1" }],
			missingFields: [],
		});
	});

	it("starts the deterministic onboarding workflow for opportunity.won", async () => {
		const result = await resolveCrmOpportunity({
			tenantId: TENANT,
			rawBody: JSON.stringify({
				event: "opportunity.won",
				opportunityId: "opp-123",
				customerId: "cust-abc",
			}),
		});
		expect(result).toEqual({
			ok: true,
			handled: true,
			body: {
				threadId: "thread-1",
				idempotent: false,
				linkedTaskCount: 1,
				missingFields: [],
			},
		});
		expect(mockStartCustomerOnboardingWorkflow).toHaveBeenCalledWith({
			tenantId: TENANT,
			source: "webhook",
			opportunity: expect.objectContaining({
				customerId: "cust-abc",
				opportunityId: "opp-123",
			}),
			startedBy: { type: "system" },
		});
	});

	it("accepts opportunity.closed_won as an alias", async () => {
		const result = await resolveCrmOpportunity({
			tenantId: TENANT,
			rawBody: JSON.stringify({
				event: "opportunity.closed_won",
				opportunityId: "opp-2",
				customerId: "cust-2",
			}),
		});
		expect(result).toMatchObject({ ok: true, handled: true });
	});

	it("skips non-close-won events without erroring", async () => {
		const result = await resolveCrmOpportunity({
			tenantId: TENANT,
			rawBody: JSON.stringify({
				event: "opportunity.created",
				opportunityId: "opp-3",
				customerId: "cust-3",
			}),
		});
		expect(result).toEqual({
			ok: true,
			skip: true,
			reason: expect.stringContaining("not a close-won"),
		});
	});

	it("rejects payloads missing opportunityId with 400", async () => {
		const result = await resolveCrmOpportunity({
			tenantId: TENANT,
			rawBody: JSON.stringify({
				event: "opportunity.won",
				customerId: "cust-x",
			}),
		});
		expect(result).toEqual({
			ok: false,
			status: 400,
			message: "opportunityId is required",
		});
	});

	it("accepts customerName when customerId is absent", async () => {
		const result = await resolveCrmOpportunity({
			tenantId: TENANT,
			rawBody: JSON.stringify({
				event: "opportunity.won",
				opportunityId: "opp-x",
				customerName: "Acme Corp",
			}),
		});
		expect(result).toMatchObject({ ok: true, handled: true });
	});

	it("rejects payloads missing customer identity with 400", async () => {
		const result = await resolveCrmOpportunity({
			tenantId: TENANT,
			rawBody: JSON.stringify({
				event: "opportunity.won",
				opportunityId: "opp-x",
			}),
		});
		expect(result).toEqual({
			ok: false,
			status: 400,
			message: "customerId or customerName is required",
		});
	});

	it("rejects malformed JSON with 400", async () => {
		const result = await resolveCrmOpportunity({
			tenantId: TENANT,
			rawBody: "{ not json",
		});
		expect(result).toMatchObject({ ok: false, status: 400 });
	});
});
