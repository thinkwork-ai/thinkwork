import { describe, expect, it, vi } from "vitest";
import { handler } from "./eval-worker.js";

describe("eval-worker inert substrate", () => {
	it("throws so accidental SQS traffic reaches the DLQ during U2", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			handler({
				Records: [
					{
						body: JSON.stringify({
							runId: "run-1",
							testCaseId: "case-1",
						}),
					},
				],
			}),
		).rejects.toThrow(/eval-worker inert stub/);

		expect(errorSpy).toHaveBeenCalledWith(
			"[eval-worker] inert stub invoked",
			expect.objectContaining({
				message: expect.stringContaining("live per-case evaluator"),
			}),
		);
		errorSpy.mockRestore();
	});
});
