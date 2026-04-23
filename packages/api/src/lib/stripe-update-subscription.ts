/**
 * Update the stripe_subscriptions mirror + tenants.plan in response to
 * Stripe lifecycle events after the initial checkout.session.completed
 * provisioning.
 *
 * Called by:
 *   - customer.subscription.updated    (plan change / status change)
 *   - customer.subscription.deleted    (cancelation — immediate or EOP)
 *   - invoice.payment_succeeded        (renewal — bump current_period_end)
 *   - invoice.payment_failed           (dunning — status → past_due)
 *
 * Upserts by stripe_subscription_id so out-of-order / replayed deliveries
 * converge to the latest Stripe state (last writer wins, guarded by the
 * stripe_events idempotency PK in the webhook handler).
 */

import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, tenants } from "../graphql/utils.js";
import { schema } from "@thinkwork/database-pg";
import { priceIdToInternalPlan } from "./stripe-plans.js";

const { stripeSubscriptions, stripeCustomers } = schema;

export interface UpdateSubscriptionResult {
	updated: boolean;
	tenantId: string | null;
	newPlan: string | null;
	newStatus: string | null;
}

function readPeriodEnd(
	subscription: Stripe.Subscription,
): Date | null {
	const raw = (
		subscription as unknown as { current_period_end?: number | null }
	).current_period_end;
	return raw ? new Date(raw * 1000) : null;
}

/**
 * Reflect the full Stripe.Subscription state onto our mirror row.
 *
 * Resolves tenant by stripe_customer_id (customer is 1:1 with tenant).
 * Returns {updated: false} when we have no matching customer row —
 * the webhook ack's 200 and logs; usually means the subscription was
 * created outside the ThinkWork flow, or our local DB is behind the
 * webhook for a new signup (in which case Stripe retries).
 */
export async function applyStripeSubscriptionUpdate(
	subscription: Stripe.Subscription,
): Promise<UpdateSubscriptionResult> {
	const stripeCustomerId =
		typeof subscription.customer === "string"
			? subscription.customer
			: subscription.customer.id;

	const [customerRow] = await db
		.select()
		.from(stripeCustomers)
		.where(eq(stripeCustomers.stripe_customer_id, stripeCustomerId))
		.limit(1);

	if (!customerRow) {
		return {
			updated: false,
			tenantId: null,
			newPlan: null,
			newStatus: null,
		};
	}

	const tenantId = customerRow.tenant_id;
	const priceId = subscription.items.data[0]?.price.id ?? "";
	const resolvedPlan = priceId
		? priceIdToInternalPlan(priceId) ?? "unknown"
		: "unknown";
	const status = subscription.status;
	const cancelAtPeriodEnd = subscription.cancel_at_period_end ?? false;
	const currentPeriodEnd = readPeriodEnd(subscription);

	await db.transaction(async (tx) => {
		// Upsert the subscription mirror. ON CONFLICT on the unique
		// stripe_subscription_id — writes are idempotent.
		await tx
			.insert(stripeSubscriptions)
			.values({
				tenant_id: tenantId,
				stripe_subscription_id: subscription.id,
				stripe_price_id: priceId,
				status,
				current_period_end: currentPeriodEnd,
				cancel_at_period_end: cancelAtPeriodEnd,
			})
			.onConflictDoUpdate({
				target: stripeSubscriptions.stripe_subscription_id,
				set: {
					stripe_price_id: priceId,
					status,
					current_period_end: currentPeriodEnd,
					cancel_at_period_end: cancelAtPeriodEnd,
					updated_at: new Date(),
				},
			});

		// Plan flip rules:
		//   - "canceled" or "incomplete_expired" → tenants.plan = "free"
		//   - "active" / "trialing" / "past_due" → tenants.plan = resolvedPlan
		//   - "unpaid" / "paused" → keep prior plan (don't churn feature gates)
		//
		// Rationale: features aren't gated by plan today, so this is
		// mostly a label. When gating lands, past_due will need a grace
		// period — handle there, not here.
		let newPlan: string | null = null;
		if (status === "canceled" || status === "incomplete_expired") {
			newPlan = "free";
		} else if (
			status === "active" ||
			status === "trialing" ||
			status === "past_due"
		) {
			if (resolvedPlan !== "unknown") newPlan = resolvedPlan;
		}

		if (newPlan) {
			await tx
				.update(tenants)
				.set({ plan: newPlan, updated_at: new Date() })
				.where(eq(tenants.id, tenantId));
		}

		return newPlan;
	});

	// Recompute for the return value (transaction closure can't easily
	// return nested values cleanly in drizzle).
	let reportedPlan: string | null = null;
	if (status === "canceled" || status === "incomplete_expired") {
		reportedPlan = "free";
	} else if (
		(status === "active" ||
			status === "trialing" ||
			status === "past_due") &&
		resolvedPlan !== "unknown"
	) {
		reportedPlan = resolvedPlan;
	}

	return {
		updated: true,
		tenantId,
		newPlan: reportedPlan,
		newStatus: status,
	};
}

/**
 * Handle invoice.payment_failed by flipping the subscription status to
 * past_due. Stripe follows up with its own retry policy; if dunning
 * fails terminally it fires customer.subscription.deleted, handled in
 * the main path.
 */
export async function applyStripePaymentFailed(
	subscriptionId: string,
): Promise<UpdateSubscriptionResult> {
	const [row] = await db
		.select()
		.from(stripeSubscriptions)
		.where(eq(stripeSubscriptions.stripe_subscription_id, subscriptionId))
		.limit(1);
	if (!row) {
		return { updated: false, tenantId: null, newPlan: null, newStatus: null };
	}
	await db
		.update(stripeSubscriptions)
		.set({ status: "past_due", updated_at: new Date() })
		.where(eq(stripeSubscriptions.stripe_subscription_id, subscriptionId));
	return {
		updated: true,
		tenantId: row.tenant_id,
		newPlan: null,
		newStatus: "past_due",
	};
}
