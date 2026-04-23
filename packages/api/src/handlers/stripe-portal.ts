/**
 * Stripe Customer Portal session creator.
 *
 * POST /api/stripe/portal-session
 *   body?: { flow?: "payment_method_update" | "subscription_cancel" | "subscription_update" }
 *
 * Cognito-authenticated. Looks up the caller's tenant's stripe_customer
 * row and creates a billing portal session. When `flow` is specified, the
 * session is pre-deep-linked to that action (Stripe's `flow_data` feature)
 * so the user lands directly on Cancel / Update card / Change plan instead
 * of the portal's home menu.
 *
 * When no flow is specified, the portal opens at its home where the user
 * can navigate to invoices, tax IDs, etc.
 */

import type Stripe from "stripe";
import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq } from "drizzle-orm";
import { authenticate } from "../lib/cognito-auth.js";
import { handleCors, json, error, unauthorized } from "../lib/response.js";
import { getStripeClient } from "../lib/stripe-client.js";
import { db } from "../lib/db.js";
import { schema } from "@thinkwork/database-pg";

const { stripeCustomers, stripeSubscriptions, users } = schema;

type PortalFlow =
	| "payment_method_update"
	| "subscription_cancel"
	| "subscription_update";

const ALLOWED_FLOWS: readonly PortalFlow[] = [
	"payment_method_update",
	"subscription_cancel",
	"subscription_update",
];

function parseBody(event: APIGatewayProxyEventV2): { flow?: PortalFlow } {
	if (!event.body) return {};
	try {
		const raw = event.isBase64Encoded
			? Buffer.from(event.body, "base64").toString("utf8")
			: event.body;
		const parsed = JSON.parse(raw) as { flow?: string };
		if (parsed.flow && ALLOWED_FLOWS.includes(parsed.flow as PortalFlow)) {
			return { flow: parsed.flow as PortalFlow };
		}
		return {};
	} catch {
		return {};
	}
}

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const preflight = handleCors(event);
	if (preflight) return preflight;

	if (event.requestContext.http.method !== "POST") {
		return error("Method not allowed", 405);
	}

	const auth = await authenticate(event.headers as Record<string, string | undefined>);
	if (!auth || (!auth.tenantId && !auth.email)) {
		return unauthorized("Authentication required");
	}

	// Resolve tenant: prefer JWT tenant claim; fall back to email lookup
	// (Google-federated users don't have custom:tenant_id until the
	// pre-token trigger lands — memory feedback_oauth_tenant_resolver).
	let tenantId = auth.tenantId;
	const emailLower = auth.email ? auth.email.toLowerCase() : null;
	if (!tenantId && emailLower) {
		const [userRow] = await db
			.select()
			.from(users)
			.where(eq(users.email, emailLower))
			.limit(1);
		tenantId = userRow?.tenant_id ?? null;
	}
	if (!tenantId) {
		return json(
			{ error: "No tenant resolved for the caller" },
			403,
		);
	}

	const [customerRow] = await db
		.select()
		.from(stripeCustomers)
		.where(eq(stripeCustomers.tenant_id, tenantId))
		.limit(1);

	if (!customerRow) {
		return json(
			{
				error: "No active subscription found for this tenant",
				freeTier: true,
			},
			404,
		);
	}

	let stripe;
	try {
		stripe = await getStripeClient();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error("[stripe-portal] Credential load failed:", msg);
		return error("Server misconfigured", 500);
	}

	const adminUrl =
		process.env.ADMIN_URL || "https://admin.thinkwork.ai";
	const returnUrl = `${adminUrl.replace(/\/$/, "")}/settings/billing`;

	const { flow } = parseBody(event);

	// For flows that operate on a specific subscription (cancel / update),
	// look up the most recent active sub for this tenant. If none exists
	// the flow collapses to a plain portal session.
	let flowData: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined;
	if (flow === "payment_method_update") {
		flowData = { type: "payment_method_update" };
	} else if (flow === "subscription_cancel" || flow === "subscription_update") {
		const [sub] = await db
			.select()
			.from(stripeSubscriptions)
			.where(eq(stripeSubscriptions.tenant_id, tenantId))
			.limit(1);
		if (sub) {
			if (flow === "subscription_cancel") {
				flowData = {
					type: "subscription_cancel",
					subscription_cancel: { subscription: sub.stripe_subscription_id },
				};
			} else {
				flowData = {
					type: "subscription_update",
					subscription_update: { subscription: sub.stripe_subscription_id },
				};
			}
		}
	}

	try {
		const session = await stripe.billingPortal.sessions.create({
			customer: customerRow.stripe_customer_id,
			return_url: returnUrl,
			...(flowData ? { flow_data: flowData } : {}),
		});
		console.log(
			`[stripe-portal] session=${session.id} tenant=${tenantId} flow=${flow ?? "home"} → ${returnUrl}`,
		);
		return json({ url: session.url, flow: flow ?? null });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error("[stripe-portal] Stripe API error:", msg);
		return error("Failed to create portal session", 502);
	}
}
