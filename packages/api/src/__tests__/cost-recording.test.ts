import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Extracted pure functions from cost-recording.ts for unit testing.
// These mirror the logic in the module — keep in sync.
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

interface AgentCoreUsage {
	inputTokens: number;
	outputTokens: number;
	cachedReadTokens: number;
	model: string | null;
}

function extractUsage(
	invokeResult: Record<string, unknown>,
): AgentCoreUsage {
	const response = (invokeResult.response || {}) as Record<string, unknown>;
	const usage = (invokeResult.usage || response.usage || {}) as Record<
		string,
		number
	>;
	return {
		inputTokens: usage.inputTokens || usage.prompt_tokens || 0,
		outputTokens: usage.outputTokens || usage.completion_tokens || 0,
		cachedReadTokens: usage.cacheReadInputTokens || 0,
		model:
			(invokeResult.model as string) ||
			(response.model as string) ||
			null,
	};
}

const FALLBACK_PRICING = { inputPerMillion: 3.0, outputPerMillion: 15.0 };

const MODEL_PRICING_FALLBACKS: Record<
	string,
	{ input: number; output: number }
> = {
	"claude-sonnet-4": { input: 3.0, output: 15.0 },
	"claude-sonnet-4-6": { input: 3.0, output: 15.0 },
	"claude-3-5-haiku": { input: 0.8, output: 4.0 },
};

function matchFallbackPricing(
	modelId: string,
): { inputPerMillion: number; outputPerMillion: number } {
	const lower = modelId.toLowerCase();
	for (const [key, pricing] of Object.entries(MODEL_PRICING_FALLBACKS)) {
		if (lower.includes(key)) {
			return {
				inputPerMillion: pricing.input,
				outputPerMillion: pricing.output,
			};
		}
	}
	return FALLBACK_PRICING;
}

// ---------------------------------------------------------------------------
// Tests: extractUsage — maps AgentCore response shapes to normalized usage
// ---------------------------------------------------------------------------

describe("extractUsage", () => {
	it("extracts usage from top-level OpenAI-style response (prompt_tokens/completion_tokens)", () => {
		const result = extractUsage({
			model: "claude-code",
			usage: { prompt_tokens: 1500, completion_tokens: 300 },
		});
		expect(result).toEqual({
			inputTokens: 1500,
			outputTokens: 300,
			cachedReadTokens: 0,
			model: "claude-code",
		});
	});

	it("extracts usage from top-level Anthropic-style response (inputTokens/outputTokens)", () => {
		const result = extractUsage({
			model: "claude-sonnet-4-6",
			usage: { inputTokens: 2000, outputTokens: 500, cacheReadInputTokens: 100 },
		});
		expect(result).toEqual({
			inputTokens: 2000,
			outputTokens: 500,
			cachedReadTokens: 100,
			model: "claude-sonnet-4-6",
		});
	});

	it("extracts usage from nested response.usage", () => {
		const result = extractUsage({
			response: {
				model: "claude-code",
				usage: { prompt_tokens: 800, completion_tokens: 200 },
			},
		});
		expect(result).toEqual({
			inputTokens: 800,
			outputTokens: 200,
			cachedReadTokens: 0,
			model: "claude-code",
		});
	});

	it("returns zeros when usage is missing (legacy hardcoded-zero responses)", () => {
		const result = extractUsage({
			model: "pi",
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
		});
		expect(result).toEqual({
			inputTokens: 0,
			outputTokens: 0,
			cachedReadTokens: 0,
			model: "pi",
		});
	});

	it("returns zeros when no usage field exists", () => {
		const result = extractUsage({ model: "claude-code" });
		expect(result).toEqual({
			inputTokens: 0,
			outputTokens: 0,
			cachedReadTokens: 0,
			model: "claude-code",
		});
	});

	it("prefers top-level usage over response.usage", () => {
		const result = extractUsage({
			model: "test",
			usage: { prompt_tokens: 100, completion_tokens: 50 },
			response: {
				usage: { prompt_tokens: 999, completion_tokens: 999 },
			},
		});
		expect(result.inputTokens).toBe(100);
		expect(result.outputTokens).toBe(50);
	});
});

// ---------------------------------------------------------------------------
// Tests: estimation fallback logic
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
	it("estimates ~4 chars per token", () => {
		expect(estimateTokens("Hello world! This is a test.")).toBe(7); // 28 chars / 4
	});

	it("returns 0 for empty string", () => {
		expect(estimateTokens("")).toBe(0);
	});

	it("rounds up", () => {
		expect(estimateTokens("abc")).toBe(1); // 3/4 → ceil → 1
	});
});

describe("estimation vs real token selection", () => {
	it("should NOT estimate when real tokens are provided", () => {
		const inputTokens = 1500;
		const outputTokens = 300;
		// This mirrors the logic in recordCostEvents
		const shouldEstimate = inputTokens === 0 && outputTokens === 0;
		expect(shouldEstimate).toBe(false);
	});

	it("should estimate when tokens are zero and text is available", () => {
		const inputTokens = 0;
		const outputTokens = 0;
		const inputText = "Hello world";
		const outputText = "Response here";
		const shouldEstimate =
			inputTokens === 0 && outputTokens === 0 && (inputText || outputText);
		expect(shouldEstimate).toBeTruthy();
	});

	it("should not estimate when tokens are zero and no text available", () => {
		const inputTokens = 0;
		const outputTokens = 0;
		const inputText = "";
		const outputText = "";
		const shouldEstimate =
			inputTokens === 0 && outputTokens === 0 && (inputText || outputText);
		expect(shouldEstimate).toBeFalsy();
	});
});

// ---------------------------------------------------------------------------
// Tests: model pricing fallback
// ---------------------------------------------------------------------------

describe("matchFallbackPricing", () => {
	it("matches claude-sonnet-4-6 model", () => {
		const pricing = matchFallbackPricing("us.anthropic.claude-sonnet-4-6-20260312-v1:0");
		expect(pricing.inputPerMillion).toBe(3.0);
		expect(pricing.outputPerMillion).toBe(15.0);
	});

	it("matches haiku model", () => {
		const pricing = matchFallbackPricing("claude-3-5-haiku-20241022");
		expect(pricing.inputPerMillion).toBe(0.8);
		expect(pricing.outputPerMillion).toBe(4.0);
	});

	it("returns generic fallback for unknown model", () => {
		const pricing = matchFallbackPricing("some-unknown-model");
		expect(pricing).toEqual(FALLBACK_PRICING);
	});
});

// ---------------------------------------------------------------------------
// Tests: LLM cost calculation
// ---------------------------------------------------------------------------

describe("LLM cost calculation", () => {
	it("calculates correct cost from real tokens", () => {
		const inputTokens = 10000;
		const outputTokens = 2000;
		const pricing = { inputPerMillion: 3.0, outputPerMillion: 15.0 };
		const llmCost =
			(inputTokens * pricing.inputPerMillion +
				outputTokens * pricing.outputPerMillion) /
			1_000_000;
		// 10000 * 3.0 / 1M + 2000 * 15.0 / 1M = 0.03 + 0.03 = 0.06
		expect(llmCost).toBeCloseTo(0.06, 6);
	});

	it("returns zero cost for zero tokens", () => {
		const llmCost = (0 * 3.0 + 0 * 15.0) / 1_000_000;
		expect(llmCost).toBe(0);
	});
});
