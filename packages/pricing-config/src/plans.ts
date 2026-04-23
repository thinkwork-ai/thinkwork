/**
 * Canonical plan catalog for ThinkWork self-serve billing.
 *
 * Shared by:
 *   - apps/www/src/pages/pricing.astro (marketing pricing page)
 *   - apps/mobile/app/onboarding/payment.tsx (mobile pricing screen)
 *
 * Any change here ripples to both surfaces. When adding a plan, also:
 *   1. Add its PlanId to `src/types.ts`.
 *   2. Add a matching price_id to STRIPE_PRICE_IDS_JSON in
 *      .github/workflows/deploy.yml (and any per-env GitHub var).
 *   3. Create the Stripe product + price (prod + test modes).
 *
 * The content here mirrors the plan data that previously lived in
 * apps/www/src/lib/copy.ts pricing.plans — copy-pasted verbatim to keep
 * the public-facing HTML byte-identical on first migration.
 */

import type { Plan } from "./types";

export const plans: readonly Plan[] = Object.freeze([
	{
		id: "starter",
		name: "Starter",
		tagline: "One team. Bounded pilot.",
		summary:
			"For a single ops team standing up a controlled pilot inside their AWS account.",
		features: Object.freeze([
			"One tenant",
			"Up to 10 agents, 5 templates",
			"Visible threads + durable memory",
			"Evaluations + budgets",
			"Community support",
		]),
		cta: "Start pilot",
		highlighted: false,
	},
	{
		id: "team",
		name: "Team",
		tagline: "Cross-team expansion.",
		summary:
			"For organizations moving from one pilot to several owned-workflows under shared governance.",
		features: Object.freeze([
			"Up to 5 tenants",
			"Up to 100 agents, 20 templates",
			"All Starter capabilities",
			"Template-level capability grants",
			"Priority email support",
		]),
		cta: "Choose Team",
		highlighted: true,
	},
	{
		id: "enterprise",
		name: "Enterprise",
		tagline: "Fleet-scale agent operations.",
		summary:
			"For enterprises running many teams across one AWS deployment boundary.",
		features: Object.freeze([
			"Unlimited tenants",
			"400+ agents, 5+ templates per tenant",
			"All Team capabilities",
			"Enterprise SSO + audit exports",
			"Named support + SLA",
		]),
		cta: "Talk to us",
		highlighted: false,
	},
]);
