import { describe, it, expect } from "vitest";
import {
	plans,
	getPlanById,
	getHighlightedPlan,
	getPlanIds,
	type Plan,
} from "../src/index";

describe("pricing-config", () => {
	it("ships exactly three plans in stable order", () => {
		expect(plans.map((p) => p.id)).toEqual(["starter", "team", "enterprise"]);
	});

	it("every plan has the full required shape", () => {
		for (const p of plans) {
			expect(p.id).toMatch(/^(starter|team|enterprise)$/);
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
		}
	});

	it("getPlanById resolves each catalog id", () => {
		for (const id of ["starter", "team", "enterprise"] as const) {
			const match = getPlanById(id);
			expect(match?.id).toBe(id);
		}
	});

	it("getPlanById returns undefined for unknown ids", () => {
		// The function accepts `PlanId | string` so unknown strings pass
		// compilation but resolve to undefined at runtime.
		expect(getPlanById("nonexistent")).toBeUndefined();
	});

	it("getHighlightedPlan returns the team plan", () => {
		const highlighted = getHighlightedPlan();
		expect(highlighted?.id).toBe("team");
		expect(highlighted?.highlighted).toBe(true);
	});

	it("at most one plan is highlighted (single recommended CTA)", () => {
		const highlights = plans.filter((p) => p.highlighted);
		expect(highlights.length).toBeLessThanOrEqual(1);
	});

	it("getPlanIds returns the ordered catalog ids", () => {
		expect(getPlanIds()).toEqual(["starter", "team", "enterprise"]);
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
