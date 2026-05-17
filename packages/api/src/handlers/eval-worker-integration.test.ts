import { describe, expect, it } from "vitest";
import {
	buildEvalWorkerMessages,
	chunkEvalWorkerMessages,
} from "./eval-runner.js";
import {
	parseEvalWorkerMessage,
	summarizeEvalResults,
} from "./eval-worker.js";

describe("eval fan-out integration shape", () => {
	it("round-trips a full-corpus dispatch payload into worker messages and final totals", () => {
		const cases = Array.from({ length: 120 }, (_, index) => ({
			id: `tc-${index + 1}`,
		}));
		const messages = buildEvalWorkerMessages("run-1", cases);
		const sqsBatches = chunkEvalWorkerMessages(messages);
		const workerMessages = sqsBatches.flatMap((batch) =>
			batch.map((message) => parseEvalWorkerMessage(JSON.stringify(message))),
		);

		expect(sqsBatches).toHaveLength(12);
		expect(workerMessages).toHaveLength(120);
		expect(workerMessages.at(-1)).toEqual({
			runId: "run-1",
			testCaseId: "tc-120",
			index: 119,
		});

		const summary = summarizeEvalResults(
			workerMessages.map((_, index) => ({
				status: index % 3 === 0 ? "fail" : "pass",
				evaluator_results: [],
			})),
		);
		expect(summary.completed).toBe(120);
		expect(summary.passed).toBe(80);
		expect(summary.failed).toBe(40);
		expect(summary.passRate).toBe(80 / 120);
	});
});
