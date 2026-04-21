/**
 * Focused resolver test for the CRM opportunity handler. The full request/
 * response cycle is exercised by webhook-shared.test.ts via a fake resolver;
 * this file pins the CRM-specific resolver contract so the crm-opportunity
 * handler doesn't drift into accepting payload shapes that mismatch the
 * vendor adapter contract.
 */

import { describe, it, expect } from "vitest";
import { resolveCrmOpportunity } from "../handlers/webhooks/crm-opportunity.js";

const TENANT = "tenant-1";

describe("resolveCrmOpportunity", () => {
	it("routes opportunity.won to customer-onboarding-reconciler with both ids", async () => {
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
			skillId: "customer-onboarding-reconciler",
			inputs: { customerId: "cust-abc", opportunityId: "opp-123" },
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
		expect(result).toMatchObject({ ok: true, skillId: expect.any(String) });
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

	it("rejects payloads missing customerId with 400", async () => {
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
			message: "customerId is required",
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
