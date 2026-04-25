import { describe, it, expect, beforeEach } from "vitest";
import {
	listPlans,
	internalPlanToPriceId,
	priceIdToInternalPlan,
	isConfiguredPriceId,
	__resetStripePlansCacheForTest,
} from "./stripe-plans";

describe("stripe-plans", () => {
	beforeEach(() => {
		__resetStripePlansCacheForTest();
		delete process.env.STRIPE_PRICE_IDS_JSON;
	});

	it("returns empty when env var is unset", () => {
		expect(listPlans()).toEqual([]);
		expect(internalPlanToPriceId("anything")).toBeUndefined();
		expect(priceIdToInternalPlan("price_anything")).toBeUndefined();
		expect(isConfiguredPriceId("price_x")).toBe(false);
	});

	it("parses a configured map and round-trips lookups", () => {
		// Only the For Business tier hits Stripe under the three-door
		// pricing ladder. The Open tier is OSS / no-Stripe; Enterprise is
		// sales-led / mailto. The map below mirrors the post-U4b
		// STRIPE_PRICE_IDS_JSON shape (business + an extra fixture key for
		// round-trip coverage).
		process.env.STRIPE_PRICE_IDS_JSON = JSON.stringify({
			business: "price_business_abc",
			"business-annual": "price_business_annual_def",
		});
		__resetStripePlansCacheForTest();

		expect(listPlans()).toEqual([
			{ internalPlan: "business", priceId: "price_business_abc" },
			{ internalPlan: "business-annual", priceId: "price_business_annual_def" },
		]);
		expect(internalPlanToPriceId("business")).toBe("price_business_abc");
		expect(priceIdToInternalPlan("price_business_annual_def")).toBe("business-annual");
		expect(isConfiguredPriceId("price_business_abc")).toBe(true);
		expect(isConfiguredPriceId("price_not_configured")).toBe(false);
	});

	it("ignores malformed JSON gracefully", () => {
		process.env.STRIPE_PRICE_IDS_JSON = "{not valid json";
		__resetStripePlansCacheForTest();
		expect(listPlans()).toEqual([]);
		expect(isConfiguredPriceId("anything")).toBe(false);
	});

	it("skips entries with empty / non-string values", () => {
		// Hand-constructed string so the TS-narrow shape at JSON.stringify time
		// doesn't reject the deliberately-invalid entries we want to exercise.
		process.env.STRIPE_PRICE_IDS_JSON =
			'{"business":"price_business","empty":"","invalid":42}';
		__resetStripePlansCacheForTest();
		const plans = listPlans();
		expect(plans.map((p) => p.internalPlan)).toEqual(["business"]);
	});
});
