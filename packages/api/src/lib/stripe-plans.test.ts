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
		process.env.STRIPE_PRICE_IDS_JSON = JSON.stringify({
			starter: "price_starter_abc",
			team: "price_team_def",
		});
		__resetStripePlansCacheForTest();

		expect(listPlans()).toEqual([
			{ internalPlan: "starter", priceId: "price_starter_abc" },
			{ internalPlan: "team", priceId: "price_team_def" },
		]);
		expect(internalPlanToPriceId("starter")).toBe("price_starter_abc");
		expect(priceIdToInternalPlan("price_team_def")).toBe("team");
		expect(isConfiguredPriceId("price_starter_abc")).toBe(true);
		expect(isConfiguredPriceId("price_not_configured")).toBe(false);
	});

	it("ignores malformed JSON gracefully", () => {
		process.env.STRIPE_PRICE_IDS_JSON = "{not valid json";
		__resetStripePlansCacheForTest();
		expect(listPlans()).toEqual([]);
		expect(isConfiguredPriceId("anything")).toBe(false);
	});

	it("skips entries with empty / non-string values", () => {
		process.env.STRIPE_PRICE_IDS_JSON = JSON.stringify({
			starter: "price_starter",
			team: "",
			// @ts-expect-error — deliberately invalid for runtime robustness
			pro: 42,
		});
		__resetStripePlansCacheForTest();
		const plans = listPlans();
		expect(plans.map((p) => p.internalPlan)).toEqual(["starter"]);
	});
});
