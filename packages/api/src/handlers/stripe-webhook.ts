/**
 * Stripe webhook handler.
 *
 * POST /api/stripe/webhook — server-to-server, no CORS, no Cognito auth.
 *
 * Flow:
 *   1. Read raw body (base64-decode if API Gateway reports it that way).
 *   2. Verify signature via stripe.webhooks.constructEvent. Failure → 400,
 *      no DB writes, no side effects. Stripe will retry a few times then
 *      give up, which is visible as a 4xx alarm.
 *   3. INSERT INTO stripe_events (stripe_event_id). PK conflict = replay,
 *      return 200 and skip — idempotency lives at the DB layer, not in
 *      application code.
 *   4. Dispatch on event.type. Only checkout.session.completed has behavior
 *      in this handler right now; other events are acked and logged.
 *   5. On checkout.session.completed: re-fetch the session with expand
 *      [customer, subscription] to get authoritative state, then call
 *      provisionTenantFromStripeSession inside a DB transaction.
 *
 * Do NOT widen resolveCaller. Service callers stay on service-auth surfaces.
 * See docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type Stripe from "stripe";
import { getStripeClient } from "../lib/stripe-client.js";
import { getStripeCredentials } from "../lib/stripe-credentials.js";
import { provisionTenantFromStripeSession } from "../lib/stripe-provision-tenant.js";
import { sendStripeWelcomeEmail } from "../lib/stripe-welcome-email.js";
import { db } from "../lib/db.js";
import { schema } from "@thinkwork/database-pg";

const { stripeEvents } = schema;

function json(
	body: unknown,
	statusCode = 200,
): APIGatewayProxyStructuredResultV2 {
	return {
		statusCode,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	};
}

function readRawBody(event: APIGatewayProxyEventV2): string {
	if (!event.body) return "";
	if (event.isBase64Encoded) {
		return Buffer.from(event.body, "base64").toString("utf8");
	}
	return event.body;
}

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const method = event.requestContext.http.method;
	if (method !== "POST") {
		return json({ error: "Method not allowed" }, 405);
	}

	const signature =
		event.headers?.["stripe-signature"] ||
		event.headers?.["Stripe-Signature"] ||
		"";
	if (!signature) {
		console.warn("[stripe-webhook] Missing Stripe-Signature header");
		return json({ error: "Missing signature" }, 400);
	}

	const rawBody = readRawBody(event);
	if (!rawBody) {
		return json({ error: "Empty body" }, 400);
	}

	let stripe: Stripe;
	let webhookSecret: string;
	try {
		stripe = await getStripeClient();
		const creds = await getStripeCredentials();
		webhookSecret = creds.webhookSigningSecret;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error("[stripe-webhook] Credential load failed:", msg);
		// 500 so Stripe retries with its standard backoff — this is a server
		// misconfiguration, not a client signature problem.
		return json({ error: "Server misconfigured" }, 500);
	}

	let stripeEvent: Stripe.Event;
	try {
		stripeEvent = stripe.webhooks.constructEvent(
			rawBody,
			signature,
			webhookSecret,
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn(`[stripe-webhook] Signature verification failed: ${msg}`);
		return json({ error: "Invalid signature" }, 400);
	}

	// Idempotency gate — DB constraint, not application logic. Replays hit
	// the unique primary key and return 200 without touching anything else.
	try {
		await db.insert(stripeEvents).values({
			stripe_event_id: stripeEvent.id,
			event_type: stripeEvent.type,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (
			msg.includes("duplicate key") ||
			msg.includes("stripe_events_pkey") ||
			msg.toLowerCase().includes("unique")
		) {
			console.log(
				`[stripe-webhook] Replay of event ${stripeEvent.id} (${stripeEvent.type}) — acking`,
			);
			return json({ received: true, replayed: true });
		}
		// Any other DB error → 500 so Stripe retries.
		console.error("[stripe-webhook] stripe_events insert failed:", msg);
		return json({ error: "DB error" }, 500);
	}

	try {
		switch (stripeEvent.type) {
			case "checkout.session.completed": {
				const session = stripeEvent.data.object as Stripe.Checkout.Session;
				if (session.mode !== "subscription") {
					console.log(
						`[stripe-webhook] Ignoring non-subscription checkout session ${session.id} (mode=${session.mode})`,
					);
					return json({ received: true });
				}
				// Re-fetch with expands so we have authoritative customer + sub
				// state (the webhook payload sends IDs only for some fields).
				const full = (await stripe.checkout.sessions.retrieve(session.id, {
					expand: ["customer", "subscription"],
				})) as Stripe.Response<Stripe.Checkout.Session>;

				const customer = full.customer;
				const subscription = full.subscription;
				if (
					!customer ||
					typeof customer === "string" ||
					customer.deleted ||
					!subscription ||
					typeof subscription === "string"
				) {
					console.error(
						`[stripe-webhook] Session ${session.id} is missing customer or subscription after expand`,
					);
					return json({ error: "Session incomplete" }, 500);
				}

				const result = await provisionTenantFromStripeSession({
					session: full,
					customer: customer as Stripe.Customer,
					subscription: subscription as Stripe.Subscription,
				});
				console.log(
					`[stripe-webhook] Provisioned tenant ${result.tenantId} plan=${result.plan} from session ${session.id}`,
				);

				// Fire the welcome email. Non-fatal on SES failure — the tenant
				// row already carries pending_owner_email, so the webhook ack's
				// 200 either way (Stripe won't retry, and the operator has a
				// manual-recovery path via the logs).
				const adminUrl = process.env.ADMIN_URL || "https://admin.thinkwork.ai";
				await sendStripeWelcomeEmail({
					email: result.email,
					plan: result.plan,
					tenantId: result.tenantId,
					sessionId: session.id,
					adminUrl,
				});

				return json({ received: true, tenantId: result.tenantId });
			}
			default:
				console.log(
					`[stripe-webhook] Acked unhandled event type=${stripeEvent.type} id=${stripeEvent.id}`,
				);
				return json({ received: true });
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(
			`[stripe-webhook] Dispatch failure for ${stripeEvent.type} (${stripeEvent.id}):`,
			msg,
		);
		// 500 so Stripe retries. The stripe_events row is already written, so
		// a later retry will hit the dedup gate and return 200 without
		// re-doing side effects — BUT the provision work never committed, so
		// the tenant row is absent. That's an incident-path scenario: operator
		// needs to manually inspect and either re-drive the provisioning or
		// delete the stripe_events row to let Stripe retry from scratch.
		return json({ error: "Provision failed" }, 500);
	}
}
