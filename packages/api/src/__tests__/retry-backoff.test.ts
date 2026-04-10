/**
 * Unit tests for getRetryDelay (PRD-09 §9.2.3).
 *
 * Covers jittered exponential backoff: boundaries, clamping, custom params,
 * and deterministic tests via Math.random mock.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { getRetryDelay } from "../lib/retry-backoff.js";

describe("getRetryDelay", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns a value >= 1 (minimum)", () => {
		for (let i = 0; i < 50; i++) {
			expect(getRetryDelay(1)).toBeGreaterThanOrEqual(1);
		}
	});

	it("returns a value <= min(baseSeconds * 2^(attempt-1), maxSeconds) (capped)", () => {
		for (let attempt = 1; attempt <= 10; attempt++) {
			const capped = Math.min(10 * Math.pow(2, attempt - 1), 300);
			for (let i = 0; i < 20; i++) {
				expect(getRetryDelay(attempt)).toBeLessThanOrEqual(capped);
			}
		}
	});

	it("attempt 1 with default params returns value in [1, 10]", () => {
		for (let i = 0; i < 50; i++) {
			const delay = getRetryDelay(1);
			expect(delay).toBeGreaterThanOrEqual(1);
			expect(delay).toBeLessThanOrEqual(10);
		}
	});

	it("high attempts (attempt=20) clamp to maxSeconds", () => {
		for (let i = 0; i < 50; i++) {
			const delay = getRetryDelay(20);
			expect(delay).toBeGreaterThanOrEqual(1);
			expect(delay).toBeLessThanOrEqual(300);
		}
	});

	it("custom baseSeconds and maxSeconds work correctly", () => {
		const base = 5;
		const max = 60;
		for (let attempt = 1; attempt <= 15; attempt++) {
			const capped = Math.min(base * Math.pow(2, attempt - 1), max);
			for (let i = 0; i < 20; i++) {
				const delay = getRetryDelay(attempt, base, max);
				expect(delay).toBeGreaterThanOrEqual(1);
				expect(delay).toBeLessThanOrEqual(capped);
			}
		}
	});

	it("random=0 returns 1 (floor(0 * capped) + 1)", () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		expect(getRetryDelay(1)).toBe(1);
		expect(getRetryDelay(5)).toBe(1);
		expect(getRetryDelay(20)).toBe(1);
	});

	it("random=0.999 returns the capped value (floor(0.999 * capped) + 1)", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.999);

		// attempt 1: capped = 10, floor(9.99) + 1 = 10
		expect(getRetryDelay(1)).toBe(10);

		// attempt 5: capped = min(10*16, 300) = 160, floor(159.84) + 1 = 160
		expect(getRetryDelay(5)).toBe(160);

		// attempt 20: capped = min(10*524288, 300) = 300, floor(299.7) + 1 = 300
		expect(getRetryDelay(20)).toBe(300);
	});
});
