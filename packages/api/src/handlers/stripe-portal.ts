/**
 * Stripe Customer Portal session creator.
 *
 * POST /api/stripe/portal-session
 *
 * Cognito-authenticated. Looks up the caller's tenant's stripe_customer
 * row, creates a `stripe.billingPortal.sessions.create({ customer })` and
 * returns { url } for the admin UI to redirect to.
 *
 * The portal itself is hosted by Stripe — cancel, plan change, invoice
 * history, update card all happen there. We just auth, look up, and
 * hand over the URL.
 */

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

const { stripeCustomers, users } = schema;

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
	if (!tenantId && auth.email) {
		const [userRow] = await db
			.select()
			.from(users)
			.where(eq(users.email, auth.email))
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

	try {
		const session = await stripe.billingPortal.sessions.create({
			customer: customerRow.stripe_customer_id,
			return_url: returnUrl,
		});
		console.log(
			`[stripe-portal] session=${session.id} tenant=${tenantId} → ${returnUrl}`,
		);
		return json({ url: session.url });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error("[stripe-portal] Stripe API error:", msg);
		return error("Failed to create portal session", 502);
	}
}
