/**
 * Pricing-config public types.
 *
 * `PlanId` is the internal plan name — the exact string that both the web
 * pricing page and the mobile pricing screen POST to
 * /api/stripe/checkout-session, and the key that the backend's
 * STRIPE_PRICE_IDS_JSON env var maps to a Stripe price_id.
 *
 * Keep this union in lockstep with:
 *   - terraform/examples/greenfield (and .github/workflows/deploy.yml)'s
 *     STRIPE_PRICE_IDS_JSON default: every PlanId must have a price_id.
 *   - packages/api/src/lib/stripe-plans.ts — which validates incoming
 *     request.plan against the env-var keys.
 *
 * Plan *display* data (name, tagline, features, …) lives here. Plan
 * *pricing* (Stripe price_id, currency, cadence) stays on the server.
 */

export type PlanId = "open" | "business" | "enterprise";

/**
 * `kind` is the deployment-model dimension of the three-door pricing ladder:
 *   - `oss`    → Open tier. Self-host on customer AWS. Apache 2.0. CTA links
 *                to the GitHub repo / getting-started docs. No Stripe.
 *   - `stripe` → For Business tier. Operated by us, deployed into customer
 *                AWS. CTA invokes the Stripe Checkout flow.
 *   - `sales`  → Enterprise tier. Services + SLA + named support. CTA is a
 *                mailto anchor (or contact-form route in the future).
 *
 * The pricing-config catalog declares the kind; consuming surfaces
 * (PricingCard.astro, mobile payment screen) branch their CTA shape on it
 * instead of hard-coding by plan id. This is the contract that prevents the
 * Open-tier card from ever firing a Stripe Checkout request.
 */
export type PlanCtaKind = "oss" | "stripe" | "sales";

export interface Plan {
	readonly id: PlanId;
	readonly name: string;
	readonly tagline: string;
	readonly summary: string;
	readonly features: readonly string[];
	readonly cta: string;
	readonly ctaHref?: string;
	readonly kind: PlanCtaKind;
	readonly highlighted: boolean;
}
