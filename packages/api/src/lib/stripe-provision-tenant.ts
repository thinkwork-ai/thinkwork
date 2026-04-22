/**
 * Pre-provision a tenant row from a successful Stripe Checkout Session.
 *
 * Called by the stripe-webhook Lambda after signature verification and event
 * dedup succeed. Writes tenants + tenant_settings + stripe_customers +
 * stripe_subscriptions in a single transaction. Does NOT create a users row
 * or tenant_members row — those land when the paying user completes Google
 * sign-in and bootstrapUser claims the tenant via pending_owner_email.
 */

import type Stripe from "stripe";
import { db, tenants, tenantSettings } from "../graphql/utils.js";
import { schema } from "@thinkwork/database-pg";
import { generateSlug } from "@thinkwork/database-pg/utils/generate-slug";
import { priceIdToInternalPlan } from "./stripe-plans.js";

const { stripeCustomers, stripeSubscriptions } = schema;

export interface ProvisionInput {
	session: Stripe.Checkout.Session;
	customer: Stripe.Customer;
	subscription: Stripe.Subscription;
}

export interface ProvisionResult {
	tenantId: string;
	email: string;
	plan: string;
	stripeCustomerId: string;
	stripeSubscriptionId: string;
}

const UNKNOWN_PLAN = "unknown";

/**
 * Idempotent at the uniqueness-constraint layer: if stripe_subscription_id
 * already exists, we ignore the insert (another concurrent delivery of the
 * same event type got here first). The stripe_events table is the primary
 * dedup gate; this is belt-and-suspenders.
 */
export async function provisionTenantFromStripeSession(
	input: ProvisionInput,
): Promise<ProvisionResult> {
	const { session, customer, subscription } = input;

	const email = (
		session.customer_details?.email ||
		customer.email ||
		""
	)
		.trim()
		.toLowerCase();
	if (!email) {
		throw new Error(
			"Cannot provision tenant: checkout session has no customer email",
		);
	}

	const priceId = subscription.items.data[0]?.price.id;
	if (!priceId) {
		throw new Error(
			`Cannot provision tenant: subscription ${subscription.id} has no price`,
		);
	}

	const internalPlan = priceIdToInternalPlan(priceId) ?? UNKNOWN_PLAN;
	if (internalPlan === UNKNOWN_PLAN) {
		console.warn(
			`[stripe-provision-tenant] Unrecognized price_id=${priceId} on subscription=${subscription.id}; writing plan="${UNKNOWN_PLAN}" and continuing so Stripe stops retrying. Operator follow-up required.`,
		);
	}

	const emailLocal = email.split("@")[0] || "workspace";
	const displayName =
		session.customer_details?.name?.trim() ||
		customer.name?.trim() ||
		`${emailLocal}'s Workspace`;

	// Stripe typings: current_period_end may be undefined on some subscription
	// shapes; we coerce via the first item's period end when present.
	const currentPeriodEndRaw =
		(subscription as unknown as { current_period_end?: number })
			.current_period_end ??
		subscription.items.data[0]?.current_period_end ??
		null;

	return await db.transaction(async (tx) => {
		const [tenant] = await tx
			.insert(tenants)
			.values({
				name: displayName,
				slug: generateSlug(),
				plan: internalPlan,
				issue_prefix: "TW",
				issue_counter: 0,
				pending_owner_email: email,
			})
			.returning();

		await tx
			.insert(tenantSettings)
			.values({ tenant_id: tenant.id })
			.onConflictDoNothing();

		await tx
			.insert(stripeCustomers)
			.values({
				tenant_id: tenant.id,
				stripe_customer_id: customer.id,
				email,
			})
			.onConflictDoNothing();

		await tx
			.insert(stripeSubscriptions)
			.values({
				tenant_id: tenant.id,
				stripe_subscription_id: subscription.id,
				stripe_price_id: priceId,
				status: subscription.status,
				current_period_end: currentPeriodEndRaw
					? new Date(currentPeriodEndRaw * 1000)
					: null,
				cancel_at_period_end: subscription.cancel_at_period_end ?? false,
			})
			.onConflictDoNothing();

		return {
			tenantId: tenant.id,
			email,
			plan: internalPlan,
			stripeCustomerId: customer.id,
			stripeSubscriptionId: subscription.id,
		};
	});
}
