/**
 * CRM opportunity webhook — Unit 8 anchor for the reconciler shape (D7b).
 *
 * Invoked by LastMile CRM when a deal transitions to "Closed Won".
 * Deterministically creates or returns the Customer Onboarding Space Thread
 * and checklist mirror before any coordinator agent interpretation.
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
import {
	CustomerOnboardingWorkflowError,
	startCustomerOnboardingWorkflow,
} from "../../lib/spaces/customer-onboarding-workflow.js";

export const CUSTOMER_ONBOARDING_SKILL_ID = "customer-onboarding-reconciler";

interface CrmOpportunityPayload {
	event?: string;
	opportunityId?: string;
	customerId?: string;
	customerName?: string;
	companyName?: string;
	occurredAt?: string;
	[key: string]: unknown;
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
	const hasCustomerId =
		typeof payload.customerId === "string" && payload.customerId.trim();
	const hasCustomerName =
		(typeof payload.customerName === "string" &&
			payload.customerName.trim()) ||
		(typeof payload.companyName === "string" && payload.companyName.trim());
	if (!hasCustomerId && !hasCustomerName) {
		return {
			ok: false,
			status: 400,
			message: "customerId or customerName is required",
		};
	}

	try {
		const result = await startCustomerOnboardingWorkflow({
			tenantId: args.tenantId,
			source: "webhook",
			opportunity: payload,
			startedBy: { type: "system" },
		});
		return {
			ok: true,
			handled: true,
			body: {
				threadId: result.thread.id,
				idempotent: result.idempotent,
				linkedTaskCount: result.linkedTasks.length,
				missingFields: result.missingFields,
			},
		};
	} catch (error) {
		if (error instanceof CustomerOnboardingWorkflowError) {
			return {
				ok: false,
				status: error.status,
				message: error.message,
			};
		}
		throw error;
	}
}

export const handler = createWebhookHandler({
	integration: "crm-opportunity",
	resolve: async (args) => resolveCrmOpportunity(args),
});

// Re-export under `APIGatewayProxyEventV2` so Lambda picks up `handler`.
export type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 };
