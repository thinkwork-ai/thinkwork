/**
 * Stripe Checkout Session creator.
 *
 * POST /api/stripe/checkout-session — auth-optional, CORS-enabled.
 *
 * Two modes, discriminated by the presence of an Authorization header:
 *
 *   • Signup (unauth): the www /pricing page + mobile /onboarding/payment
 *     send just { plan }. client_reference_id is a fresh UUID. On
 *     checkout.session.completed the webhook pre-provisions a new tenant
 *     with pending_owner_email; bootstrapUser claims it at sign-in time.
 *
 *   • Upgrade (authed): the admin/mobile Billing screen sends a Cognito
 *     Bearer token. We resolve the caller's tenantId and encode it in
 *     client_reference_id = "tenant:<uuid>". The webhook's upgrade branch
 *     attaches the subscription to the EXISTING tenant — no new tenant
 *     row, no welcome email (user is already inside their workspace).
 *
 * Takes an internal plan name (not a raw price ID — price IDs rotate
 * per stage), validates it against the stage's STRIPE_PRICE_IDS_JSON
 * config, creates a Stripe Checkout Session in subscription mode, and
 * returns the hosted Checkout URL.
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq } from "drizzle-orm";
import { getStripeClient } from "../lib/stripe-client.js";
import { authenticate } from "../lib/cognito-auth.js";
import { handleCors, json, error } from "../lib/response.js";
import {
	internalPlanToPriceId,
	listPlans,
} from "../lib/stripe-plans.js";
import { db } from "../lib/db.js";
import { schema } from "@thinkwork/database-pg";
import { randomUUID } from "node:crypto";

const { users } = schema;

interface RequestBody {
	plan?: string;
	email?: string;
	successUrl?: string;
	cancelUrl?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseBody(event: APIGatewayProxyEventV2): RequestBody {
	if (!event.body) return {};
	try {
		const raw = event.isBase64Encoded
			? Buffer.from(event.body, "base64").toString("utf8")
			: event.body;
		return JSON.parse(raw) as RequestBody;
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

	const body = parseBody(event);
	const plan = (body.plan || "").trim();
	if (!plan) return error("Missing `plan` in request body");

	const priceId = internalPlanToPriceId(plan);
	if (!priceId) {
		const known = listPlans().map((p) => p.internalPlan);
		return error(
			`Unknown plan "${plan}". Configured plans: ${known.length ? known.join(", ") : "(none — STRIPE_PRICE_IDS_JSON is empty for this stage)"}`,
		);
	}

	const email = body.email?.trim();
	if (email && !EMAIL_RE.test(email)) {
		return error("Invalid email format");
	}

	const successUrl =
		body.successUrl ||
		process.env.STRIPE_CHECKOUT_SUCCESS_URL ||
		"";
	const cancelUrl =
		body.cancelUrl ||
		process.env.STRIPE_CHECKOUT_CANCEL_URL ||
		process.env.WWW_URL ||
		"";
	if (!successUrl || !cancelUrl) {
		console.error(
			"[stripe-checkout] Missing success/cancel URLs. Set STRIPE_CHECKOUT_SUCCESS_URL / STRIPE_CHECKOUT_CANCEL_URL via Terraform common_env.",
		);
		return error("Server misconfigured: missing redirect URLs", 500);
	}

	let stripe;
	try {
		stripe = await getStripeClient();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error("[stripe-checkout] Credential load failed:", msg);
		return error("Server misconfigured", 500);
	}

	// Branch between signup (unauth) and upgrade (authed). Presence of a
	// valid Cognito JWT flips the flow; the Authorization header is
	// optional so the www /pricing page keeps working unauth.
	let upgradeTenantId: string | null = null;
	let upgradeEmail: string | null = null;
	const authResult = await authenticate(
		event.headers as Record<string, string | undefined>,
	);
	if (authResult?.authType === "cognito" && authResult.email) {
		// Resolve tenant via users-by-email (Cognito JWT's custom:tenant_id
		// is null for Google-federated users until the pre-token trigger
		// lands — feedback_oauth_tenant_resolver).
		const emailLower = authResult.email.toLowerCase();
		const [userRow] = await db
			.select()
			.from(users)
			.where(eq(users.email, emailLower))
			.limit(1);
		if (userRow?.tenant_id) {
			upgradeTenantId = userRow.tenant_id;
			upgradeEmail = userRow.email;
		}
	}

	const source = upgradeTenantId ? "in-app-upgrade" : "www-pricing";
	const clientReferenceId = upgradeTenantId
		? `tenant:${upgradeTenantId}`
		: randomUUID();
	const metadata: Record<string, string> = { plan, source };
	if (upgradeTenantId) metadata.tenantId = upgradeTenantId;

	try {
		const session = await stripe.checkout.sessions.create({
			mode: "subscription",
			line_items: [{ price: priceId, quantity: 1 }],
			// Subscription mode auto-creates customers. `customer_creation`
			// is payment-mode-only per the Stripe API.
			customer_email: upgradeEmail ?? email,
			allow_promotion_codes: true,
			client_reference_id: clientReferenceId,
			success_url: successUrl,
			cancel_url: cancelUrl,
			metadata,
			subscription_data: {
				metadata,
			},
		});

		if (!session.url) {
			return error("Stripe did not return a Checkout URL", 502);
		}

		console.log(
			`[stripe-checkout] Created session ${session.id} plan=${plan} priceId=${priceId} source=${source}${upgradeTenantId ? ` tenant=${upgradeTenantId}` : ""}`,
		);
		return json({ url: session.url, sessionId: session.id });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error("[stripe-checkout] Stripe API error:", msg);
		return error("Failed to start checkout", 502);
	}
}
