/**
 * PRD-02: Cost recording and budget enforcement.
 *
 * Called by the wakeup processor after each AgentCore invocation to:
 *   1. Record LLM + compute cost events
 *   2. Check budget policies and pause agents if exceeded
 */

import { eq, and, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
	costEvents,
	budgetPolicies,
	agents,
	modelCatalog,
} from "@thinkwork/database-pg/schema";

const db = getDb();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENTCORE_RATE_PER_SECOND = 0.00012; // ~$0.43/hour estimate

const FALLBACK_PRICING = { inputPerMillion: 3.0, outputPerMillion: 15.0 };

const MODEL_PRICING_FALLBACKS: Record<
	string,
	{ input: number; output: number }
> = {
	"claude-sonnet-4": { input: 3.0, output: 15.0 },
	"claude-sonnet-4-5": { input: 3.0, output: 15.0 },
	"claude-sonnet-4-6": { input: 3.0, output: 15.0 },
	"claude-3-5-haiku": { input: 0.8, output: 4.0 },
	"claude-3-haiku": { input: 0.25, output: 1.25 },
	"kimi-k2": { input: 1.0, output: 3.0 },
	"kimi-k2-instruct": { input: 1.0, output: 3.0 },
	// PRD-41B Phase 7 item 2: Hindsight uses these for retain (extract) and
	// reflect (synthesize). Bedrock pricing for the openai-hosted GPT-OSS
	// models — verify against current AWS pricing page periodically.
	"gpt-oss-20b": { input: 0.05, output: 0.2 },
	"gpt-oss-120b": { input: 0.15, output: 0.6 },
};

// ---------------------------------------------------------------------------
// Token extraction from AgentCore response
// ---------------------------------------------------------------------------

export interface AgentCoreUsage {
	inputTokens: number;
	outputTokens: number;
	cachedReadTokens: number;
	model: string | null;
}

export function extractUsage(
	invokeResult: Record<string, unknown>,
): AgentCoreUsage {
	// AgentCore may return usage at top level or nested under "response"
	const response = (invokeResult.response || {}) as Record<string, unknown>;
	const usage = (invokeResult.usage || response.usage || {}) as Record<
		string,
		number
	>;
	return {
		inputTokens: usage.inputTokens || usage.input_tokens || usage.prompt_tokens || 0,
		outputTokens: usage.outputTokens || usage.output_tokens || usage.completion_tokens || 0,
		cachedReadTokens:
			usage.cacheReadInputTokens ||
			usage.cachedReadTokens ||
			usage.cached_read_tokens ||
			usage.cache_read_input_tokens ||
			0,
		model:
			(invokeResult.model as string) ||
			(response.model as string) ||
			null,
	};
}

// ---------------------------------------------------------------------------
// Model pricing lookup
// ---------------------------------------------------------------------------

async function lookupModelPricing(
	modelId: string | null,
): Promise<{ inputPerMillion: number; outputPerMillion: number }> {
	if (!modelId) return FALLBACK_PRICING;

	// Try model_catalog first
	try {
		const [entry] = await db
			.select({
				input: modelCatalog.input_cost_per_million,
				output: modelCatalog.output_cost_per_million,
			})
			.from(modelCatalog)
			.where(eq(modelCatalog.model_id, modelId))
			.limit(1);

		if (entry?.input && entry?.output) {
			return {
				inputPerMillion: Number(entry.input),
				outputPerMillion: Number(entry.output),
			};
		}
	} catch {
		// model_catalog query failed — fall through to fallback
	}

	return matchFallbackPricing(modelId);
}

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

function deriveProvider(modelId: string | null): string | null {
	if (!modelId) return null;
	const lower = modelId.toLowerCase();
	if (lower.includes("claude") || lower.includes("anthropic")) return "anthropic";
	if (lower.includes("kimi") || lower.includes("moonshot")) return "moonshotai";
	// Hindsight calls Bedrock-hosted GPT-OSS models — they're prefixed
	// `openai.gpt-oss-...` in Bedrock but the spend goes to AWS, not OpenAI.
	if (lower.includes("gpt-oss")) return "bedrock";
	if (lower.includes("gpt") || lower.includes("openai")) return "openai";
	return null;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Estimate token count from text when the runtime doesn't report tokens.
 * Uses ~4 chars per token (conservative for English text with Claude models).
 * Marked as estimated in metadata so we can distinguish from real counts.
 */
function estimateTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Cost recording
// ---------------------------------------------------------------------------

export interface RecordCostParams {
	tenantId: string;
	agentId?: string | null;
	requestId: string;
	model: string | null;
	inputTokens: number;
	outputTokens: number;
	cachedReadTokens: number;
	durationMs: number;
	inputText?: string;
	outputText?: string;
	threadId?: string;
	traceId?: string;
	bedrockRequestIds?: string[];
	/**
	 * Tag this row in cost_events.metadata.source. Defaults to
	 * "wakeup_processor" for backward compatibility with the original caller.
	 * Pass e.g. "kg_auto_classify" or "agent_invoke" from other emitters.
	 */
	source?: string;
}

export interface RecordCostResult {
	totalUsd: number;
	llmUsd: number;
	computeUsd: number;
}

export async function recordCostEvents(
	params: RecordCostParams,
): Promise<RecordCostResult> {
	const pricing = await lookupModelPricing(params.model);

	// Use real tokens if available, otherwise estimate from text as fallback
	let inputTokens = params.inputTokens;
	let outputTokens = params.outputTokens;
	let estimated = false;

	if (inputTokens > 0 || outputTokens > 0) {
		console.log(`[cost] Real token data: input=${inputTokens} output=${outputTokens} model=${params.model}`);
	} else {
		// Runtime didn't return tokens (e.g. pi runtime always returns 0).
		// Record with zeros and estimated=true — the span enrichment cron will
		// query Bedrock invocation logs for real counts within 5 minutes.
		inputTokens = 0;
		outputTokens = 0;
		estimated = true;
		console.log(`[cost] No token data from runtime, recording zeros (will be enriched from invocation logs)`);
	}

	const llmCost =
		(inputTokens * pricing.inputPerMillion +
			outputTokens * pricing.outputPerMillion) /
		1_000_000;

	const computeCost = (params.durationMs / 1000) * AGENTCORE_RATE_PER_SECOND;

	// Skip recording if both costs are zero AND not estimated (no real usage)
	if (llmCost === 0 && computeCost === 0 && !estimated) return { totalUsd: 0, llmUsd: 0, computeUsd: 0 };

	const values: Array<typeof costEvents.$inferInsert> = [];

	const source = params.source || "wakeup_processor";

	if (llmCost > 0 || estimated) {
		values.push({
			tenant_id: params.tenantId,
			agent_id: params.agentId || undefined,
			request_id: params.requestId,
			event_type: "llm",
			amount_usd: llmCost.toFixed(6),
			model: params.model,
			provider: deriveProvider(params.model),
			input_tokens: inputTokens,
			output_tokens: outputTokens,
			cached_read_tokens: params.cachedReadTokens,
			thread_id: params.threadId || undefined,
			trace_id: params.traceId || undefined,
			metadata: {
				source,
				estimated,
				...(params.bedrockRequestIds?.length ? { bedrock_request_ids: params.bedrockRequestIds } : {}),
			},
		});
	}

	if (computeCost > 0) {
		values.push({
			tenant_id: params.tenantId,
			agent_id: params.agentId || undefined,
			request_id: params.requestId,
			event_type: "agentcore_compute",
			amount_usd: computeCost.toFixed(6),
			duration_ms: params.durationMs,
			thread_id: params.threadId || undefined,
			trace_id: params.traceId || undefined,
			metadata: { source },
		});
	}

	if (values.length > 0) {
		await db.insert(costEvents).values(values).onConflictDoNothing();
	}

	return { totalUsd: llmCost + computeCost, llmUsd: llmCost, computeUsd: computeCost };
}

// ---------------------------------------------------------------------------
// Budget enforcement
// ---------------------------------------------------------------------------

function getStartOfMonth(): Date {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function checkBudgetAndPause(
	tenantId: string,
	agentId: string,
): Promise<void> {
	const startOfMonth = getStartOfMonth();

	// Check agent-level policy
	const [agentPolicy] = await db
		.select()
		.from(budgetPolicies)
		.where(
			and(
				eq(budgetPolicies.agent_id, agentId),
				eq(budgetPolicies.scope, "agent"),
				eq(budgetPolicies.enabled, true),
			),
		)
		.limit(1);

	if (agentPolicy) {
		const [agentSpend] = await db
			.select({
				total: sql<string>`COALESCE(SUM(amount_usd), 0)`,
			})
			.from(costEvents)
			.where(
				and(
					eq(costEvents.agent_id, agentId),
					gte(costEvents.created_at, startOfMonth),
				),
			);

		if (Number(agentSpend.total) >= Number(agentPolicy.limit_usd)) {
			await db
				.update(agents)
				.set({
					budget_paused: true,
					budget_paused_at: new Date(),
					budget_paused_reason: `Agent budget exceeded: $${agentSpend.total} >= $${agentPolicy.limit_usd}`,
				})
				.where(eq(agents.id, agentId));

			console.log(
				`[cost] Agent ${agentId} paused: $${agentSpend.total} >= $${agentPolicy.limit_usd}`,
			);
		}
	}

	// Check tenant-level policy
	const [tenantPolicy] = await db
		.select()
		.from(budgetPolicies)
		.where(
			and(
				eq(budgetPolicies.tenant_id, tenantId),
				eq(budgetPolicies.scope, "tenant"),
				isNull(budgetPolicies.agent_id),
				eq(budgetPolicies.enabled, true),
			),
		)
		.limit(1);

	if (tenantPolicy) {
		const [tenantSpend] = await db
			.select({
				total: sql<string>`COALESCE(SUM(amount_usd), 0)`,
			})
			.from(costEvents)
			.where(
				and(
					eq(costEvents.tenant_id, tenantId),
					gte(costEvents.created_at, startOfMonth),
				),
			);

		if (Number(tenantSpend.total) >= Number(tenantPolicy.limit_usd)) {
			await db
				.update(agents)
				.set({
					budget_paused: true,
					budget_paused_at: new Date(),
					budget_paused_reason: `Tenant budget exceeded: $${tenantSpend.total} >= $${tenantPolicy.limit_usd}`,
				})
				.where(eq(agents.tenant_id, tenantId));

			console.log(
				`[cost] All agents for tenant ${tenantId} paused: $${tenantSpend.total} >= $${tenantPolicy.limit_usd}`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// AppSync subscription notification
// ---------------------------------------------------------------------------

const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT || "";
const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY || "";

export async function notifyCostRecorded(payload: {
	tenantId: string;
	agentId: string;
	agentName: string;
	eventType: string;
	amountUsd: number;
	model: string | null;
}): Promise<void> {
	if (!APPSYNC_ENDPOINT || !APPSYNC_API_KEY) return;

	const mutation = `
		mutation NotifyCostRecorded(
			$tenantId: ID!
			$agentId: ID
			$agentName: String
			$eventType: String!
			$amountUsd: Float!
			$model: String
		) {
			notifyCostRecorded(
				tenantId: $tenantId
				agentId: $agentId
				agentName: $agentName
				eventType: $eventType
				amountUsd: $amountUsd
				model: $model
			) {
				tenantId
				agentId
				agentName
				eventType
				amountUsd
				model
				updatedAt
			}
		}
	`;

	try {
		const response = await fetch(APPSYNC_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": APPSYNC_API_KEY,
			},
			body: JSON.stringify({ query: mutation, variables: payload }),
		});
		const responseBody = await response.text();
		if (!response.ok || responseBody.includes('"errors"')) {
			console.error(`[cost] AppSync notifyCostRecorded issue: ${response.status} ${responseBody}`);
		}
	} catch (err) {
		console.error(`[cost] AppSync notifyCostRecorded error:`, err);
	}
}
