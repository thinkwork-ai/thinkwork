import { describe, expect, it } from "vitest";
import {
	centsToDollarString,
	parseBudgetInput,
} from "./ComputerIdentityEditPanel";

describe("parseBudgetInput", () => {
	it("returns null for empty / whitespace input (admin chose to clear)", () => {
		expect(parseBudgetInput("")).toBeNull();
		expect(parseBudgetInput("   ")).toBeNull();
	});

	it("converts whole dollars to cents", () => {
		expect(parseBudgetInput("50")).toBe(5000);
		expect(parseBudgetInput("100")).toBe(10000);
	});

	it("rounds fractional dollars to nearest cent", () => {
		expect(parseBudgetInput("12.34")).toBe(1234);
		expect(parseBudgetInput("12.345")).toBe(1235);
	});

	it("returns 'invalid' for negatives", () => {
		expect(parseBudgetInput("-5")).toBe("invalid");
	});

	it("returns 'invalid' for non-numeric input", () => {
		expect(parseBudgetInput("abc")).toBe("invalid");
		expect(parseBudgetInput("$50")).toBe("invalid");
	});

	it("trims surrounding whitespace", () => {
		expect(parseBudgetInput("  50  ")).toBe(5000);
	});
});

describe("centsToDollarString", () => {
	it("returns empty string for null / undefined (renders as Unbounded placeholder)", () => {
		expect(centsToDollarString(null)).toBe("");
		expect(centsToDollarString(undefined)).toBe("");
	});

	it("renders cents as a dollar string without trailing zeros", () => {
		expect(centsToDollarString(5000)).toBe("50");
		expect(centsToDollarString(1234)).toBe("12.34");
		expect(centsToDollarString(100)).toBe("1");
		expect(centsToDollarString(0)).toBe("0");
	});
});
