/**
 * CRM opportunity webhook — Unit 8 anchor for the reconciler shape (D7b).
 *
 * Invoked by a CRM vendor (Salesforce, HubSpot, etc.) when a deal transitions
 * to "Closed Won". Kicks off the `customer-onboarding-reconciler` composition
 * so that — for the first tick of the loop — the composition can gather
 * existing onboarding state, identify gaps, and materialize the initial task
 * set with the right owners.
 *
 * Route:
 *   POST /webhooks/crm-opportunity/{tenantId}
 *
 * Expected payload shape (vendor-neutral):
 *   {
 *     "event":        "opportunity.won" | "opportunity.closed_won",
 *     "opportunityId": "<crm-opportunity-id>",
 *     "customerId":    "<crm-account-id>",
 *     "occurredAt":    "<rfc3339 timestamp>"
 *   }
 *
 * The payload MUST carry customerId. A future revision can plumb in a
 * resolver that maps opportunityId → customerId via a per-tenant CRM adapter;
 * v1 requires the CRM to send both together.
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { createWebhookHandler, type WebhookResolveResult } from "./_shared.js";

export const CUSTOMER_ONBOARDING_SKILL_ID = "customer-onboarding-reconciler";

interface CrmOpportunityPayload {
	event?: string;
	opportunityId?: string;
	customerId?: string;
	occurredAt?: string;
}

const RELEVANT_EVENTS = new Set([
	"opportunity.won",
	"opportunity.closed_won",
]);

export async function resolveCrmOpportunity(args: {
	tenantId: string;
	rawBody: string;
}): Promise<WebhookResolveResult> {
	let payload: CrmOpportunityPayload;
	try {
		payload = JSON.parse(args.rawBody) as CrmOpportunityPayload;
	} catch {
		return { ok: false, status: 400, message: "invalid JSON body" };
	}

	if (!payload.event || !RELEVANT_EVENTS.has(payload.event)) {
		return {
			ok: true,
			skip: true,
			reason: `event ${payload.event ?? "<missing>"} is not a close-won event`,
		};
	}

	if (!payload.opportunityId || typeof payload.opportunityId !== "string") {
		return {
			ok: false,
			status: 400,
			message: "opportunityId is required",
		};
	}
	if (!payload.customerId || typeof payload.customerId !== "string") {
		return {
			ok: false,
			status: 400,
			message: "customerId is required",
		};
	}

	return {
		ok: true,
		skillId: CUSTOMER_ONBOARDING_SKILL_ID,
		inputs: {
			customerId: payload.customerId,
			opportunityId: payload.opportunityId,
		},
	};
}

export const handler = createWebhookHandler({
	integration: "crm-opportunity",
	resolve: async (args) => resolveCrmOpportunity(args),
});

// Re-export under `APIGatewayProxyEventV2` so Lambda picks up `handler`.
export type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 };
