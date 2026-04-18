/**
 * Thin Bedrock Runtime wrapper for the Compounding Memory compile pipeline.
 *
 * Planner and section-writer both talk to the same Anthropic Messages API
 * under Bedrock. Keeping the wiring in one place means the retry strategy,
 * token-usage accounting, and model-ID resolution stay consistent, and tests
 * can mock one surface instead of three.
 *
 * Model choice is Haiku 4.5 by default (see plan's "Planner + rewriter model"
 * decision). The ID is resolved from env so we can shift to Sonnet for a single
 * tenant or prompt without redeploying.
 */

import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const REGION = process.env.AWS_REGION || "us-east-1";
const DEFAULT_MODEL_ID =
	process.env.BEDROCK_MODEL_ID ||
	"us.anthropic.claude-haiku-4-5-20251001-v1:0";

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
	/** Stop reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | etc. */
	stopReason: string | null;
}

/**
 * Low-level Claude invocation. Returns text + token usage; does not parse JSON.
 * Callers (planner, section-writer) attach their own parsing + validation.
 *
 * Throws on SDK-level errors (throttling, network). Callers decide whether to
 * retry or bail — the compiler wraps this in an outer guard.
 */
export async function invokeClaude(
	args: InvokeClaudeArgs,
): Promise<InvokeClaudeResult> {
	const modelId = args.modelId || DEFAULT_MODEL_ID;
	const body = {
		anthropic_version: "bedrock-2023-05-31",
		max_tokens: args.maxTokens ?? 4096,
		temperature: args.temperature ?? 0,
		system: args.system,
		messages: [{ role: "user", content: args.user }],
	};

	const client = getClient();
	const resp = await client.send(
		new InvokeModelCommand({
			modelId,
			contentType: "application/json",
			accept: "application/json",
			body: new TextEncoder().encode(JSON.stringify(body)),
		}),
		{ abortSignal: args.signal },
	);

	const raw = new TextDecoder().decode(resp.body);
	const payload = JSON.parse(raw) as {
		content?: Array<{ type: string; text?: string }>;
		usage?: { input_tokens?: number; output_tokens?: number };
		stop_reason?: string | null;
	};

	const text =
		payload.content
			?.filter((c) => c.type === "text" && typeof c.text === "string")
			.map((c) => c.text as string)
			.join("") ?? "";

	return {
		text,
		inputTokens: payload.usage?.input_tokens ?? 0,
		outputTokens: payload.usage?.output_tokens ?? 0,
		modelId,
		stopReason: payload.stop_reason ?? null,
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
