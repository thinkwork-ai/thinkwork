/**
 * Thin Bedrock Runtime wrapper for the Compounding Memory compile pipeline.
 *
 * Planner and section-writer both talk through the Bedrock **Converse** API
 * (not the model-native Messages API) so we can swap between Anthropic
 * Claude, OpenAI gpt-oss, and Moonshot Kimi by changing a single env var.
 * Converse normalises request/response shapes across providers and returns
 * consistent token-usage + stop-reason fields.
 *
 * Model choice is configurable via `BEDROCK_MODEL_ID`. When unset, defaults
 * to `openai.gpt-oss-120b-1:0` — the pipeline previously ran on Haiku 4.5
 * but hit per-minute quota walls during full-bank rebuilds, and gpt-oss
 * currently has higher headroom on our account. Override per-call via
 * `InvokeClaudeArgs.modelId` for spikes.
 */

import {
	BedrockRuntimeClient,
	ConverseCommand,
	type ContentBlock,
	type Message,
	type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";

const REGION = process.env.AWS_REGION || "us-east-1";
const DEFAULT_MODEL_ID =
	process.env.BEDROCK_MODEL_ID || "openai.gpt-oss-120b-1:0";

/**
 * Known per-model hard caps for the Bedrock Converse `maxTokens` input.
 * Callers (planner, aggregation planner) request generous caps for large
 * JSON payloads; we clamp to the model's real limit so small-output models
 * like Nova Micro don't reject the request outright. Missing entries mean
 * "no cap needed" — the request goes through as-is.
 */
const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
	"amazon.nova-micro-v1:0": 5000,
};

// Shared singleton — Lambda reuses the same client across invocations.
let _client: BedrockRuntimeClient | null = null;
function getClient(): BedrockRuntimeClient {
	if (!_client) {
		_client = new BedrockRuntimeClient({ region: REGION });
	}
	return _client;
}

export interface InvokeClaudeArgs {
	/** System prompt. Kept separate from user content for clarity + caching. */
	system: string;
	/** User-turn content. */
	user: string;
	/** Hard cap on output tokens. Default 4096 (plenty for section rewrites). */
	maxTokens?: number;
	/** Sampling temperature; default 0 for deterministic planner output. */
	temperature?: number;
	/** Override for the shared model ID (e.g. spike Sonnet for a run). */
	modelId?: string;
	/** Abort signal for the SDK — compiler uses this to enforce a per-call budget. */
	signal?: AbortSignal;
}

export interface InvokeClaudeResult {
	/** Concatenated text content from the assistant response. */
	text: string;
	inputTokens: number;
	outputTokens: number;
	/** Raw model ID used — useful for cost attribution when override is in play. */
	modelId: string;
	/** Stop reason normalised by Converse (`end_turn`, `max_tokens`, etc.). */
	stopReason: string | null;
}

/**
 * Low-level model invocation via the Bedrock Converse API. Returns the text
 * response + token usage; does not parse JSON. Callers (planner, section-
 * writer) attach their own parsing + validation.
 *
 * Throws on SDK-level errors (throttling, network). Callers decide whether to
 * retry or bail — the compiler wraps this in an outer guard.
 *
 * NOTE: the exported function is still named `invokeClaude` to avoid churn at
 * every callsite. It's Claude-agnostic now — any Bedrock Converse-compatible
 * model works.
 */
export async function invokeClaude(
	args: InvokeClaudeArgs,
): Promise<InvokeClaudeResult> {
	const modelId = args.modelId || DEFAULT_MODEL_ID;
	const requestedMax = args.maxTokens ?? 4096;
	const modelCap = MODEL_MAX_OUTPUT_TOKENS[modelId];
	const maxTokens = modelCap
		? Math.min(requestedMax, modelCap)
		: requestedMax;

	const messages: Message[] = [
		{ role: "user", content: [{ text: args.user } as ContentBlock] },
	];

	const client = getClient();
	const resp = await client.send(
		new ConverseCommand({
			modelId,
			messages,
			system: args.system
				? [{ text: args.system } as SystemContentBlock]
				: undefined,
			inferenceConfig: {
				maxTokens,
				temperature: args.temperature ?? 0,
			},
		}),
		{ abortSignal: args.signal },
	);

	const blocks = resp.output?.message?.content ?? [];
	const text = blocks
		.map((b) => (typeof b.text === "string" ? b.text : ""))
		.join("");

	return {
		text,
		inputTokens: resp.usage?.inputTokens ?? 0,
		outputTokens: resp.usage?.outputTokens ?? 0,
		modelId,
		stopReason: resp.stopReason ?? null,
	};
}

/**
 * Parse a JSON object out of Claude's text response. Handles the common
 * wrappers (raw JSON, ```json fenced, ``` fenced, leading prose then JSON).
 *
 * Returns the parsed value or throws with a message including the raw text,
 * so the compiler can log it for prompt iteration.
 */
export function parseJsonResponse<T>(text: string): T {
	const trimmed = text.trim();
	if (!trimmed) {
		throw new Error("parseJsonResponse: empty response");
	}

	// Try direct parse first — the cheapest path.
	try {
		return JSON.parse(trimmed) as T;
	} catch {
		// fall through
	}

	// Strip ```json ... ``` or ``` ... ``` fences.
	const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
	if (fenceMatch && fenceMatch[1]) {
		return JSON.parse(fenceMatch[1]) as T;
	}

	// Last-ditch: grab the first {...} or [...] block.
	const firstBrace = trimmed.indexOf("{");
	const firstBracket = trimmed.indexOf("[");
	const start =
		firstBrace === -1
			? firstBracket
			: firstBracket === -1
				? firstBrace
				: Math.min(firstBrace, firstBracket);
	if (start !== -1) {
		const open = trimmed[start];
		const close = open === "{" ? "}" : "]";
		const end = trimmed.lastIndexOf(close);
		if (end > start) {
			const candidate = trimmed.slice(start, end + 1);
			return JSON.parse(candidate) as T;
		}
	}

	throw new Error(
		`parseJsonResponse: no JSON found in response: ${truncate(trimmed, 200)}`,
	);
}

function truncate(s: string, n: number): string {
	return s.length <= n ? s : `${s.slice(0, n)}…`;
}
