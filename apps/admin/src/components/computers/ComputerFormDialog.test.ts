import { describe, expect, it } from "vitest";
import {
	classifyCreateComputerError,
	parseBudgetDollarsToCents,
} from "./ComputerFormDialog";

describe("classifyCreateComputerError", () => {
	it("routes assertNoActiveComputer CONFLICT messages to the owner field", () => {
		expect(
			classifyCreateComputerError("User already has an active Computer"),
		).toBe("ownerUserId");
	});

	it("is case-insensitive against the canonical phrase", () => {
		expect(
			classifyCreateComputerError(
				"[CONFLICT] User Already Has An Active Computer for tenant t-1",
			),
		).toBe("ownerUserId");
	});

	it("routes everything else to the form-wide root banner", () => {
		expect(classifyCreateComputerError("Computer template not found")).toBe(
			"root",
		);
		expect(
			classifyCreateComputerError("Forbidden: requireTenantAdmin failed"),
		).toBe("root");
		expect(classifyCreateComputerError("")).toBe("root");
	});
});

describe("parseBudgetDollarsToCents", () => {
	it("returns null for empty input (treats as 'unbounded')", () => {
		expect(parseBudgetDollarsToCents(undefined)).toBeNull();
		expect(parseBudgetDollarsToCents("")).toBeNull();
		expect(parseBudgetDollarsToCents("   ")).toBeNull();
	});

	it("converts whole dollars to cents", () => {
		expect(parseBudgetDollarsToCents("50")).toBe(5000);
		expect(parseBudgetDollarsToCents("100")).toBe(10000);
	});

	it("rounds fractional dollars to nearest cent", () => {
		expect(parseBudgetDollarsToCents("12.34")).toBe(1234);
		expect(parseBudgetDollarsToCents("12.345")).toBe(1235);
		expect(parseBudgetDollarsToCents("12.344")).toBe(1234);
	});

	it("rejects negative values as null (admin chose to clear)", () => {
		expect(parseBudgetDollarsToCents("-5")).toBeNull();
	});

	it("rejects non-numeric strings as null", () => {
		expect(parseBudgetDollarsToCents("abc")).toBeNull();
		expect(parseBudgetDollarsToCents("$50")).toBeNull();
	});

	it("trims surrounding whitespace before parsing", () => {
		expect(parseBudgetDollarsToCents("  50  ")).toBe(5000);
	});
});
