/**
 * @thinkwork/pricing-config
 *
 * Shared plan catalog + helpers for the ThinkWork pricing surfaces (web
 * marketing site + mobile onboarding screen).
 *
 * Intentionally pure-data + zero runtime deps so the package works in both
 * Astro/Vite (apps/www) and Expo/Metro (apps/mobile) without bundler
 * conditional exports.
 *
 * Stripe price IDs are intentionally NOT here — they are per-stage config
 * that lives in STRIPE_PRICE_IDS_JSON on the Lambda. The `id` field is the
 * contract between this catalog and the server's plan resolver.
 */

export type { Plan, PlanId } from "./types";
export { plans } from "./plans";

import type { Plan, PlanId } from "./types";
import { plans } from "./plans";

/** Return a plan by id, or undefined when no match exists. */
export function getPlanById(id: PlanId | string): Plan | undefined {
	return plans.find((p) => p.id === id);
}

/**
 * Return the single plan that should render with the "Recommended" treatment.
 * Returns undefined if no plan is flagged — callers should default to plain
 * rendering. Assumes at most one plan is highlighted at a time (enforced in
 * tests); if multiple are, returns the first in catalog order.
 */
export function getHighlightedPlan(): Plan | undefined {
	return plans.find((p) => p.highlighted);
}

/** Ordered list of plan ids, useful for iterating tabs / cards. */
export function getPlanIds(): readonly PlanId[] {
	return plans.map((p) => p.id);
}
