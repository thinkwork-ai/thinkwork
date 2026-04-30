import { describe, expect, it } from "vitest";
import {
	runSourceAgent,
	type SourceAgentModel,
	type SourceAgentTool,
} from "./source-agent-runtime.js";

describe("source agent runtime", () => {
	it("runs a model/tool/final loop and only accepts observed citations", async () => {
		const modelTurns: string[] = [
			JSON.stringify({
				tool_calls: [
					{
						id: "search-1",
						tool: "company-brain.pages.search",
						input: { query: "favorite restarant in Paris" },
					},
				],
			}),
			JSON.stringify({
				final: {
					answer: "Auberge Bressane is the cited favorite.",
					results: [
						{
							source_id: "page-auberge-bressane",
							title: "Auberge Bressane",
							summary: "Compiled page says it is a favorite Paris restaurant.",
							confidence: 0.91,
							source_tool_call_ids: ["search-1"],
						},
						{
							source_id: "page-not-observed",
							title: "Unseen page",
						},
					],
				},
			}),
		];
		const model: SourceAgentModel = async () => ({
			text: modelTurns.shift() ?? "{}",
			modelId: "test-model",
			inputTokens: 10,
			outputTokens: 5,
			stopReason: "end_turn",
		});
		const searchTool: SourceAgentTool = {
			name: "company-brain.pages.search",
			description: "Search compiled Company Brain pages.",
			async execute(input, context) {
				context.rememberSource("page-auberge-bressane", {
					title: "Auberge Bressane",
				});
				return {
					summary: `searched for ${input.query}`,
					citedSourceIds: ["page-auberge-bressane"],
					observation: {
						pages: [
							{
								id: "page-auberge-bressane",
								title: "Auberge Bressane",
								summary: "Paris restaurant known for souffle.",
							},
						],
					},
				};
			},
		};

		const result = await runSourceAgent({
			name: "Company Brain Page Agent",
			system: "You are a source-specific wiki navigator.",
			query: "favorite restarant in Paris",
			tools: [searchTool],
			allowedTools: ["company-brain.pages.search"],
			depthCap: 3,
			model,
		});

		expect(result.state).toBe("ok");
		expect(result.finalResults).toEqual([
			{
				sourceId: "page-auberge-bressane",
				title: "Auberge Bressane",
				summary: "Compiled page says it is a favorite Paris restaurant.",
				confidence: 0.91,
				sourceToolCallIds: ["search-1"],
			},
		]);
		expect(result.model).toMatchObject({
			id: "test-model",
			inputTokens: 20,
			outputTokens: 10,
			turns: 2,
		});
		expect(result.toolCallCount).toBe(1);
		expect(result.trace.map((step) => step.type)).toEqual([
			"model",
			"tool",
			"model",
			"final",
		]);
		expect(result.trace.at(-1)).toMatchObject({
			type: "final",
			status: "ok",
			summary: "accepted 1 cited result; rejected 1 uncited",
		});
	});

	it("rejects tools outside the allowlist before execution", async () => {
		const result = await runSourceAgent({
			name: "Company Brain Page Agent",
			system: "Use allowed tools only.",
			query: "favorite restaurant",
			tools: [
				{
					name: "company-brain.pages.search",
					description: "Search pages.",
					async execute() {
						throw new Error("should not run");
					},
				},
			],
			allowedTools: ["company-brain.pages.search"],
			depthCap: 2,
			model: async () => ({
				text: JSON.stringify({
					tool_calls: [{ tool: "workspace.files.delete", input: {} }],
				}),
			}),
		});

		expect(result.state).toBe("error");
		expect(result.reason).toBe("tool workspace.files.delete is not allowed");
		expect(result.trace).toEqual([
			expect.objectContaining({ type: "model", status: "ok" }),
			expect.objectContaining({
				type: "tool",
				status: "error",
				tool: "workspace.files.delete",
			}),
		]);
	});

	it("returns an error trace when the model never produces final citations", async () => {
		const result = await runSourceAgent({
			name: "Company Brain Page Agent",
			system: "Use tools then cite sources.",
			query: "favorite restaurant",
			tools: [
				{
					name: "company-brain.pages.search",
					description: "Search pages.",
					async execute() {
						return { observation: { pages: [] }, summary: "0 pages" };
					},
				},
			],
			allowedTools: ["company-brain.pages.search"],
			depthCap: 1,
			model: async () => ({
				text: JSON.stringify({
					tool_calls: [
						{ id: "search-1", tool: "company-brain.pages.search", input: {} },
					],
				}),
			}),
		});

		expect(result.state).toBe("error");
		expect(result.reason).toBe(
			"source agent reached depth cap (1) before final answer",
		);
		expect(result.trace.map((step) => step.type)).toEqual(["model", "tool"]);
	});

	it("compacts large tool observations before the next model turn", async () => {
		const largeBody = "A".repeat(5000);
		let secondPrompt = "";
		let turn = 0;

		const result = await runSourceAgent({
			name: "Company Brain Page Agent",
			system: "Inspect pages without flooding the context.",
			query: "favorite restaurant",
			tools: [
				{
					name: "company-brain.pages.read",
					description: "Read a compiled page.",
					async execute(_input, context) {
						context.rememberSource("page-auberge-bressane", {});
						return {
							summary: "read large page",
							citedSourceIds: ["page-auberge-bressane"],
							observation: {
								page: {
									id: "page-auberge-bressane",
									body_md: largeBody,
								},
							},
						};
					},
				},
			],
			allowedTools: ["company-brain.pages.read"],
			depthCap: 2,
			model: async (request) => {
				turn += 1;
				if (turn === 1) {
					return {
						text: JSON.stringify({
							tool_calls: [
								{
									id: "read-1",
									tool: "company-brain.pages.read",
									input: { page_id: "page-auberge-bressane" },
								},
							],
						}),
					};
				}
				secondPrompt = request.user;
				return {
					text: JSON.stringify({
						final: {
							results: [{ source_id: "page-auberge-bressane" }],
						},
					}),
				};
			},
		});

		expect(result.state).toBe("ok");
		expect(secondPrompt).toContain("read large page");
		expect(secondPrompt).not.toContain(largeBody);
		expect(secondPrompt).toContain("...");
	});
});
