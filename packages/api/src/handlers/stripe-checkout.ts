/**
 * Stripe Checkout Session creator.
 *
 * POST /api/stripe/checkout-session — unauthenticated, CORS-enabled.
 *
 * Called by the www /pricing page. Takes an internal plan name (not a raw
 * price ID — price IDs rotate per stage), validates it against the
 * stage's STRIPE_PRICE_IDS_JSON config, creates a Stripe Checkout Session
 * in subscription mode, and returns the hosted Checkout URL for the
 * browser to redirect to.
 *
 * The webhook (stripe-webhook.ts) is the source of truth for "payment
 * succeeded" — this handler is just the pre-payment funnel. The success_url
 * lands the user on admin/onboarding/welcome, which takes them through
 * Google sign-in and lets bootstrapUser claim the tenant.
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { getStripeClient } from "../lib/stripe-client.js";
import { handleCors, json, error } from "../lib/response.js";
import {
	internalPlanToPriceId,
	listPlans,
} from "../lib/stripe-plans.js";
import { randomUUID } from "node:crypto";

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

	try {
		const session = await stripe.checkout.sessions.create({
			mode: "subscription",
			line_items: [{ price: priceId, quantity: 1 }],
			customer_creation: "always",
			customer_email: email,
			allow_promotion_codes: true,
			client_reference_id: randomUUID(),
			success_url: successUrl,
			cancel_url: cancelUrl,
			metadata: {
				plan,
				source: "www-pricing",
			},
			subscription_data: {
				metadata: { plan, source: "www-pricing" },
			},
		});

		if (!session.url) {
			return error("Stripe did not return a Checkout URL", 502);
		}

		console.log(
			`[stripe-checkout] Created session ${session.id} plan=${plan} priceId=${priceId}`,
		);
		return json({ url: session.url, sessionId: session.id });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error("[stripe-checkout] Stripe API error:", msg);
		return error("Failed to start checkout", 502);
	}
}
