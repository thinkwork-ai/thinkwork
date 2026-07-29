/**
 * PRD-02: Cost recording and budget enforcement.
 *
 * Called by the wakeup processor after each AgentCore invocation to:
 *   1. Record LLM + compute cost events
 *   2. Check budget policies and pause agents if exceeded
 */

import { getConfig } from "@thinkwork/runtime-config";
import { publishAppSyncMutation } from "./appsync-iam-publisher.js";
import { eq, and, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  costEvents,
  budgetPolicies,
  agents,
  modelCatalog,
} from "@thinkwork/database-pg/schema";
import {
  checkUserBudgetAndPauseWork,
  resolveTenantUserCostOwner,
} from "./user-budget-enforcement.js";
import { getTenantModelPricing } from "./model-catalog/tenant-catalog.js";
import {
  computeLlmCostUsd,
  lookupFallbackModelPricing,
  withCacheRates,
  type ModelPricing,
} from "./model-catalog/pricing.js";

const db = getDb();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENTCORE_RATE_PER_SECOND = 0.00012; // ~$0.43/hour estimate

// Model pricing (incl. cache rates) lives in ./model-catalog/pricing.js —
// THINK-245 consolidated the previously duplicated fallback maps.

// ---------------------------------------------------------------------------
// Token extraction from AgentCore response
// ---------------------------------------------------------------------------

export interface AgentCoreUsage {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
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
    // Pi runtime responses carry pi-ai style keys (`input`/`output`/
    // `cacheRead`) — the same alias set finalize-client.ts normalizes.
    inputTokens:
      usage.inputTokens ||
      usage.input_tokens ||
      usage.input ||
      usage.prompt_tokens ||
      0,
    outputTokens:
      usage.outputTokens ||
      usage.output_tokens ||
      usage.output ||
      usage.completion_tokens ||
      0,
    cachedReadTokens:
      usage.cacheReadInputTokens ||
      usage.cachedReadTokens ||
      usage.cacheRead ||
      usage.cached_read_tokens ||
      usage.cache_read_input_tokens ||
      0,
    cachedWriteTokens:
      usage.cacheWriteInputTokens ||
      usage.cachedWriteTokens ||
      usage.cacheWrite ||
      usage.cached_write_tokens ||
      usage.cache_write_input_tokens ||
      0,
    model: (invokeResult.model as string) || (response.model as string) || null,
  };
}

// ---------------------------------------------------------------------------
// Model pricing lookup
// ---------------------------------------------------------------------------

async function lookupModelPricing(
  tenantId: string,
  modelId: string | null,
): Promise<ModelPricing> {
  if (!modelId) return lookupFallbackModelPricing(null);

  // DB tiers carry only input/output — cache rates are always overlaid as
  // the model's multipliers applied to the RESOLVED input rate, so tenant-
  // specific input pricing propagates to cache pricing (THINK-245).
  const tenantPricing = await getTenantModelPricing({ tenantId, modelId });
  if (tenantPricing) return withCacheRates(modelId, tenantPricing);

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
      return withCacheRates(modelId, {
        inputPerMillion: Number(entry.input),
        outputPerMillion: Number(entry.output),
      });
    }
  } catch {
    // model_catalog query failed — fall through to fallback
  }

  return lookupFallbackModelPricing(modelId);
}

function deriveProvider(modelId: string | null): string | null {
  if (!modelId) return null;
  const lower = modelId.toLowerCase();
  if (lower.includes("claude") || lower.includes("anthropic"))
    return "anthropic";
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
  userId?: string | null;
  requestId: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens?: number;
  durationMs: number;
  inputText?: string;
  outputText?: string;
  threadId?: string;
  traceId?: string;
  runtimeType?: string | null;
  bedrockRequestIds?: string[];
  metadata?: Record<string, unknown>;
  /** Record the AgentCore compute row. Defaults to true. */
  recordCompute?: boolean;
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
  const userId = await resolveTenantUserCostOwner({
    tenantId: params.tenantId,
    userId: params.userId,
  });
  const pricing = await lookupModelPricing(params.tenantId, params.model);

  // Use real tokens if available, otherwise estimate from text as fallback
  let inputTokens = params.inputTokens;
  let outputTokens = params.outputTokens;
  let estimated = false;

  if (inputTokens > 0 || outputTokens > 0) {
    console.log(
      `[cost] Real token data: input=${inputTokens} output=${outputTokens} cachedRead=${params.cachedReadTokens} cachedWrite=${params.cachedWriteTokens ?? 0} model=${params.model}`,
    );
  } else {
    // Runtime didn't return tokens (e.g. pi runtime always returns 0).
    // Record with zeros and estimated=true — the span enrichment cron will
    // query Bedrock invocation logs for real counts within 5 minutes.
    inputTokens = 0;
    outputTokens = 0;
    estimated = true;
    console.log(
      `[cost] No token data from runtime, recording zeros (will be enriched from invocation logs)`,
    );
  }

  const llmCost = computeLlmCostUsd(pricing, {
    inputTokens,
    outputTokens,
    cachedReadTokens: params.cachedReadTokens,
    cachedWriteTokens: params.cachedWriteTokens,
  });

  const computeCost =
    (params.durationMs / 1000) *
    AGENTCORE_RATE_PER_SECOND *
    ((params.recordCompute ?? true) ? 1 : 0);

  // Skip recording if both costs are zero AND not estimated (no real usage)
  if (llmCost === 0 && computeCost === 0 && !estimated)
    return { totalUsd: 0, llmUsd: 0, computeUsd: 0 };

  const values: Array<typeof costEvents.$inferInsert> = [];

  const source = params.source || "wakeup_processor";
  const runtimeSourceEvidence = (eventType: string) => ({
    source_type: "runtime",
    source_system: source,
    request_id: params.requestId,
    event_type: eventType,
    ...(params.traceId ? { trace_id: params.traceId } : {}),
    ...(params.runtimeType ? { runtime_type: params.runtimeType } : {}),
  });

  if (llmCost > 0 || estimated) {
    values.push({
      tenant_id: params.tenantId,
      agent_id: params.agentId || undefined,
      user_id: userId || undefined,
      request_id: params.requestId,
      event_type: "llm",
      runtime_type: params.runtimeType || undefined,
      amount_usd: llmCost.toFixed(6),
      model: params.model,
      provider: deriveProvider(params.model),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_read_tokens: params.cachedReadTokens,
      cached_write_tokens: params.cachedWriteTokens ?? null,
      thread_id: params.threadId || undefined,
      trace_id: params.traceId || undefined,
      reconciliation_source: "runtime",
      reconciliation_at: new Date(),
      source_evidence_ref: runtimeSourceEvidence("llm"),
      metadata: {
        source,
        ...(params.metadata ?? {}),
        estimated,
        ...(params.runtimeType ? { runtime_type: params.runtimeType } : {}),
        ...(params.bedrockRequestIds?.length
          ? { bedrock_request_ids: params.bedrockRequestIds }
          : {}),
      },
    });
  }

  if ((params.recordCompute ?? true) && computeCost > 0) {
    values.push({
      tenant_id: params.tenantId,
      agent_id: params.agentId || undefined,
      user_id: userId || undefined,
      request_id: params.requestId,
      event_type: "agentcore_compute",
      runtime_type: params.runtimeType || undefined,
      amount_usd: computeCost.toFixed(6),
      duration_ms: params.durationMs,
      thread_id: params.threadId || undefined,
      trace_id: params.traceId || undefined,
      reconciliation_source: "runtime",
      reconciliation_at: new Date(),
      source_evidence_ref: runtimeSourceEvidence("agentcore_compute"),
      metadata: {
        source,
        ...(params.metadata ?? {}),
        ...(params.runtimeType ? { runtime_type: params.runtimeType } : {}),
      },
    });
  }

  if (values.length > 0) {
    await db.insert(costEvents).values(values).onConflictDoNothing();
  }

  return {
    totalUsd: llmCost + computeCost,
    llmUsd: llmCost,
    computeUsd: computeCost,
  };
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
  userId?: string | null,
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
          // THINK-245 R11 — graced (retroactively repriced) rows never
          // count toward enforcement.
          eq(costEvents.enforcement_exempt, false),
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
          // THINK-245 R11 — graced (retroactively repriced) rows never
          // count toward enforcement.
          eq(costEvents.enforcement_exempt, false),
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

  if (userId) {
    await checkUserBudgetAndPauseWork({ tenantId, userId });
  }
}

// ---------------------------------------------------------------------------
// AppSync subscription notification
// ---------------------------------------------------------------------------

export async function notifyCostRecorded(payload: {
  tenantId: string;
  agentId?: string | null;
  agentName?: string | null;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  eventType: string;
  amountUsd: number;
  model: string | null;
}): Promise<void> {
  const mutation = `
		mutation NotifyCostRecorded(
			$tenantId: ID!
			$agentId: ID
			$agentName: String
			$userId: ID
			$userName: String
			$userEmail: String
			$eventType: String!
			$amountUsd: Float!
			$model: String
		) {
			notifyCostRecorded(
				tenantId: $tenantId
				agentId: $agentId
				agentName: $agentName
				userId: $userId
				userName: $userName
				userEmail: $userEmail
				eventType: $eventType
				amountUsd: $amountUsd
				model: $model
			) {
				tenantId
				agentId
				agentName
				userId
				userName
				userEmail
				eventType
				amountUsd
				model
				updatedAt
			}
		}
	`;

  await publishAppSyncMutation(mutation, payload);
}
