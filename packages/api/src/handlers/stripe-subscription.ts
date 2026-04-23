/**
 * Stripe subscription state reader — GET /api/stripe/subscription.
 *
 * Cognito-authenticated. Returns the caller's tenant subscription
 * mirror row + the tenant's current plan label, plus a hasCustomer
 * flag so the admin UI can decide whether the "Manage subscription"
 * button is clickable.
 *
 * Implemented as a thin REST endpoint rather than a GraphQL resolver
 * because it's scoped to a single admin screen and the surface is one
 * row. When more billing queries land, consider promoting to GraphQL.
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq } from "drizzle-orm";
import { authenticate } from "../lib/cognito-auth.js";
import { handleCors, json, error, unauthorized } from "../lib/response.js";
import { db } from "../lib/db.js";
import { schema } from "@thinkwork/database-pg";

const { stripeCustomers, stripeSubscriptions, tenants, users } = schema;

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const preflight = handleCors(event);
	if (preflight) return preflight;

	if (event.requestContext.http.method !== "GET") {
		return error("Method not allowed", 405);
	}

	const auth = await authenticate(event.headers as Record<string, string | undefined>);
	if (!auth || (!auth.tenantId && !auth.email)) {
		return unauthorized("Authentication required");
	}

	// Resolve tenant (JWT claim, or email fallback for Google-federated users).
	// Email match is case-insensitive — Google can return mixed-case in the
	// JWT email claim while our users table stores lowercase.
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
	console.log(
		`[stripe-subscription] auth.email=${auth.email} auth.tenantId=${auth.tenantId} resolved=${tenantId ?? "null"}`,
	);
	if (!tenantId) {
		return json({ error: "No tenant resolved for the caller" }, 403);
	}

	// Fetch tenant (for plan) + stripe_customers + stripe_subscriptions in parallel.
	const [[tenantRow], [customerRow], subscriptionRows] = await Promise.all([
		db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1),
		db
			.select()
			.from(stripeCustomers)
			.where(eq(stripeCustomers.tenant_id, tenantId))
			.limit(1),
		db
			.select()
			.from(stripeSubscriptions)
			.where(eq(stripeSubscriptions.tenant_id, tenantId)),
	]);

	if (!tenantRow) {
		return json({ error: "Tenant not found" }, 404);
	}

	// Pick the most recent active-ish subscription row (multiple historical
	// rows possible when a tenant cancels and re-subscribes).
	const activeRank: Record<string, number> = {
		active: 0,
		trialing: 1,
		past_due: 2,
		unpaid: 3,
		paused: 4,
		incomplete: 5,
		incomplete_expired: 6,
		canceled: 7,
	};
	const rankOf = (row: (typeof subscriptionRows)[number]) =>
		activeRank[row.status] ?? 99;
	const sortedSubs = [...subscriptionRows].sort((a, b) => rankOf(a) - rankOf(b));
	const liveSub = sortedSubs[0] ?? null;

	return json({
		plan: tenantRow.plan,
		status: liveSub?.status ?? null,
		currentPeriodEnd: liveSub?.current_period_end?.toISOString() ?? null,
		cancelAtPeriodEnd: liveSub?.cancel_at_period_end ?? false,
		stripePriceId: liveSub?.stripe_price_id ?? null,
		hasCustomer: !!customerRow,
		customerEmail: customerRow?.email ?? null,
	});
}
