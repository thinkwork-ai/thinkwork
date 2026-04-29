import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	parseArgs,
	runWipe,
	validateSurvey,
	type CliArgs,
} from "./wipe-external-memory-stores.js";

function buildArgs(overrides: Partial<CliArgs> = {}): CliArgs {
	return {
		stage: "dev",
		dryRun: true,
		maxDeletes: 1_000_000,
		batchSize: 1_000,
		...overrides,
	};
}

function buildDb(executeReturns: any[]) {
	const calls: any[] = [];
	const execute = vi.fn(async (query: any) => {
		calls.push(query);
		const idx = calls.length - 1;
		const result = executeReturns[idx] ?? { rows: [] };
		return result;
	});
	return {
		db: { execute } as any,
		execute,
		calls,
	};
}

describe("parseArgs", () => {
	it("dry-run is the default", () => {
		expect(parseArgs(["--stage", "dev"]).dryRun).toBe(true);
	});

	it("--dry-run=false flips to live mode", () => {
		expect(parseArgs(["--stage", "dev", "--dry-run=false"]).dryRun).toBe(false);
	});

	it("collects scope flags", () => {
		const args = parseArgs([
			"--stage",
			"prod",
			"--user",
			"u-1",
			"--tenant",
			"t-1",
			"--surveyed-on",
			"2026-04-26",
		]);
		expect(args.userId).toBe("u-1");
		expect(args.tenantId).toBe("t-1");
		expect(args.surveyedOn).toBe("2026-04-26");
	});

	it("rejects unknown args", () => {
		expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
	});
});

describe("validateSurvey", () => {
	const today = new Date("2026-04-28T00:00:00.000Z");

	it("dry-run skips the check", () => {
		expect(validateSurvey(buildArgs({ dryRun: true }), today).ok).toBe(true);
	});

	it("rejects missing --surveyed-on on live run", () => {
		const result = validateSurvey(buildArgs({ dryRun: false }), today);
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/requires --surveyed-on/);
	});

	it("accepts a fresh survey date", () => {
		expect(
			validateSurvey(
				buildArgs({ dryRun: false, surveyedOn: "2026-04-26" }),
				today,
			).ok,
		).toBe(true);
	});

	it("accepts the boundary date (exactly 7 days old)", () => {
		expect(
			validateSurvey(
				buildArgs({ dryRun: false, surveyedOn: "2026-04-21" }),
				today,
			).ok,
		).toBe(true);
	});

	it("rejects a stale survey (>7 days)", () => {
		const result = validateSurvey(
			buildArgs({ dryRun: false, surveyedOn: "2026-04-15" }),
			today,
		);
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/13 days old/);
	});

	it("rejects a malformed date", () => {
		expect(
			validateSurvey(
				buildArgs({ dryRun: false, surveyedOn: "not-a-date" }),
				today,
			).ok,
		).toBe(false);
	});

	it("rejects a future date", () => {
		expect(
			validateSurvey(
				buildArgs({ dryRun: false, surveyedOn: "2026-05-15" }),
				today,
			).ok,
		).toBe(false);
	});
});

describe("runWipe — dry-run", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	it("prints COUNT and per-bank breakdown without DELETE", async () => {
		const { db, execute } = buildDb([
			{ rows: [{ count: "42" }] }, // count phase
			{ rows: [{ bank_id: "user_u1", row_count: "30" }, { bank_id: "user_u2", row_count: "12" }] },
		]);

		const report = await runWipe(buildArgs({ dryRun: true }), db);

		expect(report.totalLegacy).toBe(42);
		expect(report.bankCount).toBe(2);
		expect(report.dryRun).toBe(true);
		expect(report.deletedByBank).toEqual([]);
		// Only count + per-bank breakdown queries; no DELETE.
		expect(execute).toHaveBeenCalledTimes(2);
	});

	it("zero legacy items is an exit-0 no-op", async () => {
		const { db } = buildDb([
			{ rows: [{ count: "0" }] },
			{ rows: [] },
		]);
		const report = await runWipe(buildArgs({ dryRun: true }), db);
		expect(report.totalLegacy).toBe(0);
		expect(report.bankCount).toBe(0);
	});

	it("aborts dry-run when count exceeds --max-deletes", async () => {
		const { db } = buildDb([{ rows: [{ count: "2000000" }] }]);
		await expect(
			runWipe(buildArgs({ dryRun: true, maxDeletes: 1_000_000 }), db),
		).rejects.toThrow(/exceeds --max-deletes/);
	});
});

describe("runWipe — live run", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	it("rejects without a fresh survey", async () => {
		const { db } = buildDb([]);
		await expect(
			runWipe(buildArgs({ dryRun: false }), db),
		).rejects.toThrow(/requires --surveyed-on/);
	});

	it("issues per-bank batched DELETE until no rows remain", async () => {
		const today = new Date();
		const isoToday = today.toISOString().slice(0, 10);

		const { db, execute, calls } = buildDb([
			// Count phase
			{ rows: [{ count: "150" }] },
			// Per-bank breakdown
			{ rows: [{ bank_id: "user_u1", row_count: "150" }] },
			// First DELETE batch — returns 100 rows
			{ rows: Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}` })) },
			// Second DELETE batch — returns 50 rows
			{ rows: Array.from({ length: 50 }, (_, i) => ({ id: `id-b-${i}` })) },
			// Third DELETE batch — returns 0 rows (loop exits)
			{ rows: [] },
		]);

		const report = await runWipe(
			buildArgs({
				dryRun: false,
				surveyedOn: isoToday,
				batchSize: 100,
			}),
			db,
		);

		expect(report.dryRun).toBe(false);
		expect(report.deletedByBank).toEqual([{ bankId: "user_u1", deleted: 150 }]);
		// 2 (count + breakdown) + 3 (DELETE batches) = 5 total
		expect(execute).toHaveBeenCalledTimes(5);
	});

	it("scoped to one user issues exact-match WHERE clause", async () => {
		const today = new Date();
		const isoToday = today.toISOString().slice(0, 10);

		const { db, calls } = buildDb([
			{ rows: [{ count: "0" }] },
			{ rows: [] },
		]);

		await runWipe(
			buildArgs({
				dryRun: true,
				surveyedOn: isoToday,
				userId: "11111111-2222-3333-4444-555555555555",
			}),
			db,
		);

		// Count query SQL should reference the user_<userId> form. Drizzle's
		// sql template object stores the segments + values; we assert by
		// inspecting the .queryChunks structure exposed by `sql`.
		const countQuery = calls[0];
		const serialized = JSON.stringify(countQuery);
		expect(serialized).toContain("user_11111111-2222-3333-4444-555555555555");
	});
});
