/**
 * Canonical plan catalog for the Agent Harness for Business three-door
 * pricing ladder.
 *
 * Shared by:
 *   - apps/www/src/pages/cloud.astro (web pricing grid; renders all 3 tiers)
 *   - apps/mobile/app/onboarding/payment.tsx (mobile pricing screen; filters
 *     out the `oss` tier — the OSS path is web-only to satisfy Apple App
 *     Store review on external-purchase links)
 *
 * The three tiers map to the three deployment models:
 *   - "open"       → ThinkWork (the open Agent Harness). Free, self-host on
 *                    customer AWS, Apache 2.0, community support. CTA links
 *                    to the GitHub repo + getting-started docs. NOT Stripe-
 *                    billed. Filtered out of mobile.
 *   - "business"   → ThinkWork for Business. Operated by us, deployed into
 *                    customer AWS, Stripe-billed monthly, managed updates,
 *                    priority support. The recommended/highlighted tier.
 *   - "enterprise" → ThinkWork Enterprise. Services + SLA + named support;
 *                    sales-led; mailto CTA. Reframed from the prior scale-
 *                    laddered "Enterprise" sub-tier to the services tier of
 *                    the deployment ladder.
 *
 * When changing this file, also:
 *   1. Update PlanId / PlanCtaKind in `src/types.ts` if the union changes.
 *   2. Update STRIPE_PRICE_IDS_JSON in .github/workflows/deploy.yml + the
 *      per-stage GitHub var (only the `business` tier hits Stripe; the
 *      `open` and `enterprise` tiers don't need price ids).
 *   3. Create the corresponding Stripe product + price (prod + test) for the
 *      `business` tier in U4b.
 *
 * History: previously scale-laddered Starter/Team/Enterprise (all Stripe-
 * billed sub-tiers within "Cloud"); reshaped 2026-04-24 per plan
 * docs/plans/2026-04-24-009 to deployment-laddered Open/Business/Enterprise
 * (the three doors of the Agent Harness for Business).
 */

import type { Plan } from "./types";

const GITHUB_REPO_URL = "https://github.com/thinkwork-ai/thinkwork";
const ENTERPRISE_MAILTO =
	"mailto:hello@thinkwork.ai?subject=ThinkWork%20Enterprise%20%E2%80%94%20scope%20a%20pilot";

export const plans: readonly Plan[] = Object.freeze([
	{
		id: "open",
		name: "ThinkWork",
		tagline: "The open Agent Harness.",
		summary:
			"Apache 2.0. Self-host the harness on your AWS account. The full product, no operating partner — community-supported.",
		features: Object.freeze([
			"Self-host on your AWS",
			"Apache 2.0 license",
			"All product capabilities — Threads, Memory, Agents, Connectors, Automations, Control",
			"R.E.S.T. anchors built into the runtime",
			"Community support (GitHub issues + discussions)",
		]),
		cta: "Self-host on GitHub",
		ctaHref: GITHUB_REPO_URL,
		kind: "oss",
		highlighted: false,
	},
	{
		id: "business",
		name: "ThinkWork for Business",
		tagline: "Agent Harness, operated.",
		summary:
			"The same harness, run by us — deployed into your AWS account, with managed updates, priority support, and the operating discipline so your team focuses on the workflows, not the runtime.",
		features: Object.freeze([
			"Run by us, deployed into your AWS",
			"Managed updates and upgrades",
			"Priority email + Slack support",
			"All product capabilities — Threads, Memory, Agents, Connectors, Automations, Control",
			"R.E.S.T. anchors enforced + monitored",
		]),
		cta: "Choose For Business",
		kind: "stripe",
		highlighted: true,
	},
	{
		id: "enterprise",
		name: "ThinkWork Enterprise",
		tagline: "Services + SLA + named support.",
		summary:
			"Strategy, pilot launch, managed operations, and workflow expansion services on top of either ThinkWork (open) or ThinkWork for Business. Sales-led, scoped up front.",
		features: Object.freeze([
			"Strategy, launch, and expansion services",
			"Named support + SLA",
			"Cross-team / cross-tenant fleet operations",
			"Annual contracts; procurement-ready",
			"Wraps ThinkWork (open) or ThinkWork for Business",
		]),
		cta: "Talk to us",
		ctaHref: ENTERPRISE_MAILTO,
		kind: "sales",
		highlighted: false,
	},
]);
