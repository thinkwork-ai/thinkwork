/**
 * Stripe plan ↔ internal plan mapping.
 *
 * Price IDs are stage-specific and carried as a JSON env var
 * `STRIPE_PRICE_IDS_JSON` — non-secret, so no Secrets Manager trip. The env
 * var is shaped `{ "<internalPlan>": "<stripe_price_id>", ... }`. Missing,
 * empty, or malformed JSON falls back to an empty map so handlers can still
 * boot; unknown price IDs are explicit errors at the call site.
 *
 * Consumers: stripe-checkout (priceId → validate against known plans),
 * stripe-webhook (subscription.items[0].price.id → internal plan written onto
 * the tenant row).
 */

export interface StripePlanConfig {
	/** Internal plan name stored on tenants.plan (e.g. "starter", "team"). */
	internalPlan: string;
	/** Stripe recurring price ID (e.g. "price_1A2B3C…"). */
	priceId: string;
}

let cached: Map<string, string> | null = null;

function loadPlansMap(): Map<string, string> {
	if (cached) return cached;
	const raw = process.env.STRIPE_PRICE_IDS_JSON || "{}";
	let parsed: Record<string, string>;
	try {
		parsed = JSON.parse(raw);
	} catch {
		console.warn(
			`[stripe-plans] STRIPE_PRICE_IDS_JSON is not valid JSON; treating as empty. Value length: ${raw.length}`,
		);
		parsed = {};
	}
	const map = new Map<string, string>();
	for (const [internalPlan, priceId] of Object.entries(parsed)) {
		if (typeof priceId !== "string" || !priceId) continue;
		map.set(internalPlan, priceId);
	}
	cached = map;
	return map;
}

/** Return every configured plan for this stage (ordered by internal plan name). */
export function listPlans(): StripePlanConfig[] {
	const map = loadPlansMap();
	return Array.from(map.entries())
		.map(([internalPlan, priceId]) => ({ internalPlan, priceId }))
		.sort((a, b) => a.internalPlan.localeCompare(b.internalPlan));
}

/** Resolve an internal plan name → Stripe price ID. Returns undefined if unknown. */
export function internalPlanToPriceId(internalPlan: string): string | undefined {
	return loadPlansMap().get(internalPlan);
}

/** Reverse lookup: Stripe price ID → internal plan name. Returns undefined if unknown. */
export function priceIdToInternalPlan(priceId: string): string | undefined {
	for (const [internalPlan, configuredPriceId] of loadPlansMap()) {
		if (configuredPriceId === priceId) return internalPlan;
	}
	return undefined;
}

/** True iff the given Stripe price ID is one of this stage's configured plans. */
export function isConfiguredPriceId(priceId: string): boolean {
	return priceIdToInternalPlan(priceId) !== undefined;
}

/** Test-only helper to clear the module cache between tests. */
export function __resetStripePlansCacheForTest(): void {
	cached = null;
}
