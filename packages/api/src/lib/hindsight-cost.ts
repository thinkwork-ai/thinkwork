/**
 * PRD-41B Phase 7 item 2: Cost attribution for Hindsight LLM calls.
 *
 * Hindsight runs on its own ECS Fargate task and calls Bedrock (gpt-oss-20b
 * for retain/extract, gpt-oss-120b for reflect) using its own IAM role. As
 * a result, the Bedrock spend lands under "Hindsight task" in AWS billing,
 * with no link back to which agent or tenant triggered it.
 *
 * Both Hindsight retain and reflect responses include a `usage` block with
 * input_tokens / output_tokens / total_tokens (verified against the dev
 * ALB on 2026-04-08). The kg-extract-worker (TS) and the agent container
 * (Python) parse those fields and call into recordHindsightCost() to
 * insert a row into cost_events tagged with the originating agent/tenant.
 *
 * The agent container delivers Hindsight usage back to the API via the
 * chat-agent-invoke response payload (`hindsight_usage: [...]`), which is
 * then drained into recordHindsightCost calls inside the wakeup processor
 * /chat-agent-invoke handler — same shape as bedrock_request_ids today.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { costEvents, modelCatalog } from "@thinkwork/database-pg/schema";
import { randomUUID } from "node:crypto";

const db = getDb();

// Same fallback table as cost-recording.ts MODEL_PRICING_FALLBACKS — kept
// in sync manually. Hindsight uses two model IDs by default; cover both.
const HINDSIGHT_FALLBACK_PRICING: Record<string, { input: number; output: number }> = {
	"gpt-oss-20b": { input: 0.05, output: 0.2 },
	"gpt-oss-120b": { input: 0.15, output: 0.6 },
};

const FINAL_FALLBACK = { input: 0.05, output: 0.2 };

async function lookupPricing(
	modelId: string,
): Promise<{ inputPerMillion: number; outputPerMillion: number }> {
	if (!modelId) return { inputPerMillion: FINAL_FALLBACK.input, outputPerMillion: FINAL_FALLBACK.output };

	// Try model_catalog first — same source of truth as recordCostEvents()
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
		// model_catalog query failed — fall through to substring match
	}

	const lower = modelId.toLowerCase();
	for (const [key, p] of Object.entries(HINDSIGHT_FALLBACK_PRICING)) {
		if (lower.includes(key)) {
			return { inputPerMillion: p.input, outputPerMillion: p.output };
		}
	}

	return { inputPerMillion: FINAL_FALLBACK.input, outputPerMillion: FINAL_FALLBACK.output };
}

export type HindsightPhase = "retain" | "reflect";

export interface RecordHindsightCostParams {
	tenantId: string;
	agentId: string | null;
	bankId: string;
	phase: HindsightPhase;
	model: string;
	inputTokens: number;
	outputTokens: number;
	threadId?: string;
	traceId?: string;
	requestId?: string;
	source?: "kg_extract" | "agent_invoke";
}

/**
 * Insert one cost_events row attributed to an agent/tenant for a Hindsight
 * Bedrock call. Skips silently if both token counts are zero.
 *
 * `request_id` is optional — when omitted we synthesize a UUID so the
 * unique constraint on (request_id, event_type) doesn't reject the row.
 * Hindsight responses do not currently expose a Bedrock request id we
 * could reuse, but if that ever changes, pass it through.
 */
export async function recordHindsightCost(params: RecordHindsightCostParams): Promise<void> {
	const { inputTokens, outputTokens, model } = params;
	if ((inputTokens || 0) <= 0 && (outputTokens || 0) <= 0) return;

	const pricing = await lookupPricing(model);
	const usd = (inputTokens * pricing.inputPerMillion + outputTokens * pricing.outputPerMillion) / 1_000_000;

	if (usd <= 0) return;

	try {
		await db
			.insert(costEvents)
			.values({
				tenant_id: params.tenantId,
				agent_id: params.agentId || undefined,
				request_id: params.requestId || `hindsight-${params.phase}-${randomUUID()}`,
				event_type: "llm",
				amount_usd: usd.toFixed(6),
				model,
				provider: "bedrock",
				input_tokens: inputTokens,
				output_tokens: outputTokens,
				thread_id: params.threadId || undefined,
				trace_id: params.traceId || undefined,
				metadata: {
					source: params.source || "hindsight",
					phase: params.phase,
					bank_id: params.bankId,
					engine: "hindsight",
				},
			})
			.onConflictDoNothing();
	} catch (err) {
		// Cost recording must never break the calling flow — log and move on.
		console.error(`[hindsight-cost] failed to record ${params.phase} cost for bank=${params.bankId}:`, err);
	}
}
