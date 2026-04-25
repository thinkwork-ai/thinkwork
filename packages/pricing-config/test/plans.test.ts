import { describe, it, expect } from "vitest";
import {
	plans,
	getPlanById,
	getHighlightedPlan,
	getPlanIds,
	type Plan,
} from "../src/index";

describe("pricing-config (Agent Harness for Business three-door ladder)", () => {
	it("ships exactly three plans in stable Open → Business → Enterprise order", () => {
		expect(plans.map((p) => p.id)).toEqual(["open", "business", "enterprise"]);
	});

	it("every plan has the full required shape", () => {
		for (const p of plans) {
			expect(p.id).toMatch(/^(open|business|enterprise)$/);
			expect(p.name).toBeTruthy();
			expect(p.tagline).toBeTruthy();
			expect(p.summary).toBeTruthy();
			expect(Array.isArray(p.features)).toBe(true);
			expect(p.features.length).toBeGreaterThanOrEqual(3);
			for (const feat of p.features) {
				expect(typeof feat).toBe("string");
				expect(feat.length).toBeGreaterThan(0);
			}
			expect(p.cta).toBeTruthy();
			expect(typeof p.highlighted).toBe("boolean");
			expect(p.kind).toMatch(/^(oss|stripe|sales)$/);
		}
	});

	it("each plan's kind matches its deployment model", () => {
		// `kind` is the contract that prevents the Open-tier card from ever
		// firing a Stripe Checkout request and routes the Enterprise card to
		// mailto. Every consuming surface branches on it.
		expect(getPlanById("open")?.kind).toBe("oss");
		expect(getPlanById("business")?.kind).toBe("stripe");
		expect(getPlanById("enterprise")?.kind).toBe("sales");
	});

	it("non-Stripe tiers carry an explicit ctaHref so consumers don't have to invent routing", () => {
		const open = getPlanById("open");
		const enterprise = getPlanById("enterprise");
		expect(open?.ctaHref).toMatch(/^https:\/\/github\.com\//);
		expect(enterprise?.ctaHref).toMatch(/^mailto:/);
		// `business` intentionally has no ctaHref — its CTA invokes the
		// Stripe Checkout flow via JS, not a static href.
		expect(getPlanById("business")?.ctaHref).toBeUndefined();
	});

	it("getPlanById resolves each catalog id", () => {
		for (const id of ["open", "business", "enterprise"] as const) {
			const match = getPlanById(id);
			expect(match?.id).toBe(id);
		}
	});

	it("getPlanById returns undefined for unknown ids", () => {
		// The function accepts `PlanId | string` so unknown strings pass
		// compilation but resolve to undefined at runtime.
		expect(getPlanById("nonexistent")).toBeUndefined();
		// Retired tier names from the prior scale-laddered catalog must not
		// resolve — they are deleted, not aliased.
		expect(getPlanById("starter")).toBeUndefined();
		expect(getPlanById("team")).toBeUndefined();
	});

	it("getHighlightedPlan returns the For Business tier", () => {
		const highlighted = getHighlightedPlan();
		expect(highlighted?.id).toBe("business");
		expect(highlighted?.highlighted).toBe(true);
	});

	it("at most one plan is highlighted (single recommended CTA)", () => {
		const highlights = plans.filter((p) => p.highlighted);
		expect(highlights.length).toBeLessThanOrEqual(1);
	});

	it("getPlanIds returns the ordered catalog ids", () => {
		expect(getPlanIds()).toEqual(["open", "business", "enterprise"]);
	});

	it("plans array is frozen — runtime mutation throws", () => {
		expect(() => {
			// @ts-expect-error — deliberate attempt to mutate the readonly array
			plans.push({ id: "oops" } as Plan);
		}).toThrow();
	});

	it("individual plan feature arrays are frozen", () => {
		expect(() => {
			// @ts-expect-error — deliberate attempt to mutate a readonly tuple
			plans[0]!.features.push("oops");
		}).toThrow();
	});
});
