import { describe, expect, it } from "vitest";
import {
	parseEvalWorkerMessage,
	summarizeEvalResults,
} from "./eval-worker.js";

describe("eval-worker message parsing", () => {
	it("requires both runId and testCaseId", () => {
		expect(
			parseEvalWorkerMessage(
				JSON.stringify({ runId: "run-1", testCaseId: "tc-1", index: 2 }),
			),
		).toEqual({ runId: "run-1", testCaseId: "tc-1", index: 2 });

		expect(() =>
			parseEvalWorkerMessage(JSON.stringify({ runId: "run-1" })),
		).toThrow(/runId and testCaseId/);
	});
});

describe("eval-worker finalization summary", () => {
	it("aggregates pass/fail totals and evaluator token cost", () => {
		const summary = summarizeEvalResults([
			{
				status: "pass",
				evaluator_results: [
					{ token_usage: { totalTokens: 1000 } },
					{ token_usage: { totalTokens: 500 } },
				],
			},
			{
				status: "fail",
				evaluator_results: [{ token_usage: { totalTokens: 250 } }],
			},
			{ status: "error", evaluator_results: [] },
		]);

		expect(summary).toEqual({
			passed: 1,
			failed: 2,
			passRate: 1 / 3,
			totalCostUsd: 0.021,
		});
	});
});
