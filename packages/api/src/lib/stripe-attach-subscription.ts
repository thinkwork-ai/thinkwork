/**
 * Attach a Stripe subscription to an EXISTING tenant — the upgrade path.
 *
 * Called by stripe-webhook's checkout.session.completed branch when the
 * session's client_reference_id is "tenant:<uuid>" (set by the
 * stripe-checkout Lambda when an authenticated caller started the
 * session, i.e. a free-tier tenant upgrading).
 *
 * Differs from provisionTenantFromStripeSession in three ways:
 *   1. No new tenant row is created — tenant already exists.
 *   2. No welcome email — the user is already inside their workspace.
 *   3. stripe_customers is upserted (the row may not exist for a tenant
 *      that upgraded from the free tier).
 */

import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, tenants } from "../graphql/utils.js";
import { schema } from "@thinkwork/database-pg";
import { priceIdToInternalPlan } from "./stripe-plans.js";

const { stripeCustomers, stripeSubscriptions } = schema;

export interface AttachInput {
	tenantId: string;
	customer: Stripe.Customer;
	subscription: Stripe.Subscription;
}

export interface AttachResult {
	tenantId: string;
	plan: string;
	stripeCustomerId: string;
	stripeSubscriptionId: string;
}

const UNKNOWN_PLAN = "unknown";

function readPeriodEnd(
	subscription: Stripe.Subscription,
): Date | null {
	const raw = (
		subscription as unknown as { current_period_end?: number | null }
	).current_period_end;
	return raw ? new Date(raw * 1000) : null;
}

export async function attachStripeSubscriptionToTenant(
	input: AttachInput,
): Promise<AttachResult> {
	const { tenantId, customer, subscription } = input;

	const priceId = subscription.items.data[0]?.price.id ?? "";
	const internalPlan = priceId
		? priceIdToInternalPlan(priceId) ?? UNKNOWN_PLAN
		: UNKNOWN_PLAN;
	if (internalPlan === UNKNOWN_PLAN) {
		console.warn(
			`[stripe-attach-subscription] Unrecognized price_id=${priceId} on sub=${subscription.id}; tenant=${tenantId} will carry plan="${UNKNOWN_PLAN}" until remapped.`,
		);
	}

	const email = customer.email?.trim().toLowerCase() ?? "";

	return await db.transaction(async (tx) => {
		// Upsert stripe_customers by tenant_id (PK). Tenants upgrading
		// from free don't have a row yet; returning tenants that canceled
		// and came back get their row updated.
		await tx
			.insert(stripeCustomers)
			.values({
				tenant_id: tenantId,
				stripe_customer_id: customer.id,
				email: email || `customer+${tenantId}@unknown.local`,
			})
			.onConflictDoUpdate({
				target: stripeCustomers.tenant_id,
				set: {
					stripe_customer_id: customer.id,
					email: email || undefined,
					updated_at: new Date(),
				},
			});

		// Insert the subscription mirror. Unique on stripe_subscription_id
		// — same Stripe sub can't be inserted twice for different tenants.
		await tx
			.insert(stripeSubscriptions)
			.values({
				tenant_id: tenantId,
				stripe_subscription_id: subscription.id,
				stripe_price_id: priceId,
				status: subscription.status,
				current_period_end: readPeriodEnd(subscription),
				cancel_at_period_end: subscription.cancel_at_period_end ?? false,
			})
			.onConflictDoUpdate({
				target: stripeSubscriptions.stripe_subscription_id,
				set: {
					stripe_price_id: priceId,
					status: subscription.status,
					current_period_end: readPeriodEnd(subscription),
					cancel_at_period_end:
						subscription.cancel_at_period_end ?? false,
					updated_at: new Date(),
				},
			});

		// Flip tenants.plan. If a tenant is upgrading back from a prior
		// cancel (deactivated_at set), clear the deactivation markers —
		// they're paying again.
		await tx
			.update(tenants)
			.set({
				plan:
					internalPlan === UNKNOWN_PLAN ? UNKNOWN_PLAN : internalPlan,
				deactivated_at: null,
				deactivation_reason: null,
				updated_at: new Date(),
			})
			.where(eq(tenants.id, tenantId));

		return {
			tenantId,
			plan: internalPlan,
			stripeCustomerId: customer.id,
			stripeSubscriptionId: subscription.id,
		};
	});
}
