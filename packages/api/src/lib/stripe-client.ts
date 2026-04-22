/**
 * Memoized Stripe SDK client.
 *
 * The Stripe `apiVersion` is pinned so upgrades are explicit — never inherit
 * whatever is newest at deploy time. Update deliberately when we've reviewed
 * the diff at https://docs.stripe.com/upgrades.
 *
 * Consumers: stripe-checkout, stripe-webhook, and any future billing-adjacent
 * Lambdas. All of them should call `getStripeClient()` rather than
 * constructing their own `Stripe` instance so credential loading and API-
 * version pinning stay centralized.
 */

import Stripe from "stripe";
import { getStripeCredentials } from "./stripe-credentials";

// Pin to the Stripe API version that matches the SDK typings shipped with
// the installed `stripe` package. Bump deliberately — review the changelog
// at https://docs.stripe.com/upgrades before changing.
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2025-02-24.acacia";

let cached: Stripe | null = null;

export async function getStripeClient(): Promise<Stripe> {
	if (cached) return cached;
	const { secretKey } = await getStripeCredentials();
	cached = new Stripe(secretKey, {
		apiVersion: STRIPE_API_VERSION,
		// Enable retries for transient failures; Stripe ignores on non-
		// idempotent calls so this is safe.
		maxNetworkRetries: 2,
		typescript: true,
	});
	return cached;
}

/** Test-only helper to clear the module cache between tests. */
export function __resetStripeClientCacheForTest(): void {
	cached = null;
}
