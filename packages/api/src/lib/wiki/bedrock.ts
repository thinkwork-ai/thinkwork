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
const DEFAULT_CALL_TIMEOUT_MS = positiveIntEnv(
	"WIKI_BEDROCK_CALL_TIMEOUT_MS",
	120_000,
);

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
	const timeout = args.signal ? null : new AbortController();
	const timeoutId = timeout
		? setTimeout(() => timeout.abort(), DEFAULT_CALL_TIMEOUT_MS)
		: null;
	try {
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
			{ abortSignal: args.signal ?? timeout?.signal },
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
	} catch (err) {
		if (timeout?.signal.aborted && isAbortLikeError(err)) {
			const timeoutErr = new Error(
				`Bedrock converse timed out after ${DEFAULT_CALL_TIMEOUT_MS}ms`,
			);
			timeoutErr.name = "TimeoutError";
			throw timeoutErr;
		}
		throw err;
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
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

function positiveIntEnv(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function isAbortLikeError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	return (
		err.name === "AbortError" ||
		err.name === "TimeoutError" ||
		err.name === "RequestAbortedError"
	);
}

// ---------------------------------------------------------------------------
// Retry wrapper — handles transient Bedrock + JSON-parse failures
// ---------------------------------------------------------------------------

/**
 * Thrown when all retry attempts fail. The compile-job outer catch checks for
 * this name and increments `bedrock_retry_exhausted` on the job metrics.
 */
export class BedrockRetryExhaustedError extends Error {
	override readonly name = "BedrockRetryExhaustedError";
	readonly attempts: number;
	override readonly cause: Error;
	constructor(attempts: number, cause: Error) {
		super(
			`bedrock retry exhausted after ${attempts} attempts: ${cause.message}`,
		);
		this.attempts = attempts;
		this.cause = cause;
	}
}

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;

// SDK exception names that indicate a transient condition worth retrying.
// Anything outside this set (auth, validation, not-found, aborted) is fatal.
const RETRYABLE_SDK_ERROR_NAMES = new Set([
	"ThrottlingException",
	"ServiceUnavailableException",
	"InternalServerException",
	"ModelStreamErrorException",
	"ModelErrorException",
	"TimeoutError",
]);

/**
 * Classify an error as worth retrying. Covers:
 * - Transient SDK exceptions (throttling, 5xx, transient timeouts)
 * - `parseJsonResponse: empty response` and `no JSON found…` — empty or
 *   prose-only Bedrock outputs that cleared the SDK call but failed to parse
 * - `SyntaxError` from `JSON.parse` — the "Expected ',' or '}' after property
 *   value" / unterminated-string shapes that come from a truncated response
 *
 * User-initiated cancellation (`AbortError`) is never retried.
 */
export function isRetryableBedrockError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	if (err.name === "AbortError") return false;
	if (RETRYABLE_SDK_ERROR_NAMES.has(err.name)) return true;
	const code = (err as NodeJS.ErrnoException).code;
	if (code === "ETIMEDOUT" || code === "ECONNRESET") return true;
	if (err instanceof SyntaxError) return true;
	if (err.message.startsWith("parseJsonResponse:")) return true;
	return false;
}

function backoffDelayMs(attempt: number): number {
	// attempt is 1-indexed; first retry waits ~1s, then ~2s, then ~4s
	const base = BASE_BACKOFF_MS * 2 ** (attempt - 1);
	// ±25% jitter: multiply by a factor in [0.75, 1.25]
	const jitter = 0.75 + Math.random() * 0.5;
	return Math.round(base * jitter);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface InvokeClaudeWithRetryResult extends InvokeClaudeResult {
	/** Number of retry attempts that happened before the call succeeded. */
	retries: number;
}

/**
 * Invoke Claude with retry on transient SDK failures. Used by section-writer,
 * which accepts raw markdown and has no JSON-parse step to retry on.
 */
export async function invokeClaudeWithRetry(
	args: InvokeClaudeArgs,
): Promise<InvokeClaudeWithRetryResult> {
	return withBedrockRetry(
		async () => invokeClaude(args),
		{ signal: args.signal },
	);
}

export interface InvokeClaudeJsonResult<T> extends InvokeClaudeWithRetryResult {
	parsed: T;
}

/**
 * Invoke Claude expecting a JSON response, retrying on transient SDK failures
 * AND on JSON-parse failures (empty response, truncated response, no JSON
 * found). Planner + aggregation-planner both route through this — a compile
 * job now rides through the ~15% Bedrock flakes that used to kill the chain.
 *
 * Optional `parse` hook lets callers substitute their own extractor. Defaults
 * to `parseJsonResponse`.
 */
export async function invokeClaudeJson<T>(
	args: InvokeClaudeArgs & { parse?: (text: string) => T },
): Promise<InvokeClaudeJsonResult<T>> {
	const parse = args.parse ?? ((text: string) => parseJsonResponse<T>(text));
	return withBedrockRetry(
		async () => {
			const res = await invokeClaude(args);
			const parsed = parse(res.text);
			return { ...res, parsed };
		},
		{ signal: args.signal },
	);
}

async function withBedrockRetry<R>(
	fn: () => Promise<R>,
	opts: { signal?: AbortSignal; maxAttempts?: number } = {},
): Promise<R & { retries: number }> {
	const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	let lastErr: Error | undefined;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		if (opts.signal?.aborted) {
			const abortErr = new Error("aborted");
			abortErr.name = "AbortError";
			throw abortErr;
		}
		try {
			const res = await fn();
			return { ...res, retries: attempt - 1 };
		} catch (err) {
			lastErr = err instanceof Error ? err : new Error(String(err));
			if (!isRetryableBedrockError(lastErr)) {
				throw lastErr;
			}
			if (attempt >= maxAttempts) {
				throw new BedrockRetryExhaustedError(attempt, lastErr);
			}
			const delay = backoffDelayMs(attempt);
			console.warn(
				`[bedrock] retry ${attempt}/${maxAttempts - 1} after ${delay}ms: ${truncate(lastErr.message, 200)}`,
			);
			await sleep(delay);
		}
	}
	// Unreachable — loop always returns or throws.
	throw new BedrockRetryExhaustedError(
		maxAttempts,
		lastErr ?? new Error("unknown bedrock failure"),
	);
}
