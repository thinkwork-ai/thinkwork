/**
 * PRD-20: Span & Invocation Log Enrichment Cron
 *
 * Runs every 5 minutes. Finds cost_events with estimated=true (zero tokens)
 * and enriches them with real token counts from Bedrock model invocation logs.
 * This is the primary enrichment path — it works for all runtimes regardless
 * of whether they return token counts in their response.
 *
 * Fallback: also checks aws/spans for gen_ai token data (trace-based matching).
 */

import { eq, and, sql, gte } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { costEvents, modelCatalog } from "@thinkwork/database-pg/schema";
import {
	CloudWatchLogsClient,
	FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

const db = getDb();
const logsClient = new CloudWatchLogsClient({ region: "us-east-1" });

const INVOCATIONS_LOG_GROUP = "/thinkwork/bedrock/model-invocations";
const LOOKBACK_MS = 15 * 60 * 1000; // 15 minutes

// Fallback pricing (per million tokens)
const FALLBACK_PRICING: Record<string, { input: number; output: number }> = {
	"claude-sonnet-4": { input: 3.0, output: 15.0 },
	"claude-sonnet-4-5": { input: 3.0, output: 15.0 },
	"claude-sonnet-4-6": { input: 3.0, output: 15.0 },
	"claude-3-5-haiku": { input: 0.8, output: 4.0 },
	"claude-haiku-4-5": { input: 0.8, output: 4.0 },
	"kimi-k2": { input: 1.0, output: 3.0 },
};

function lookupPricing(modelId: string): { input: number; output: number } {
	const lower = modelId.toLowerCase();
	for (const [key, pricing] of Object.entries(FALLBACK_PRICING)) {
		if (lower.includes(key)) return pricing;
	}
	return { input: 3.0, output: 15.0 };
}

/**
 * Query invocation logs for a time window and extract token counts.
 */
async function queryInvocationLogs(
	startMs: number,
	endMs: number,
): Promise<
	Array<{
		requestId: string;
		timestamp: string;
		modelId: string;
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
	}>
> {
	try {
		const response = await logsClient.send(
			new FilterLogEventsCommand({
				logGroupName: INVOCATIONS_LOG_GROUP,
				startTime: startMs,
				endTime: endMs,
				limit: 100,
			}),
		);

		if (!response.events?.length) return [];

		return response.events
			.map((event) => {
				try {
					const log = JSON.parse(event.message || "{}");
					if (!log.requestId) return null; // skip non-invocation entries
					const input = log.input || {};
					const output = log.output || {};
					return {
						requestId: log.requestId || "",
						timestamp: log.timestamp || "",
						modelId: log.modelId || "",
						inputTokens: input.inputTokenCount || 0,
						outputTokens: output.outputTokenCount || 0,
						cacheReadTokens: input.cacheReadInputTokenCount || 0,
					};
				} catch {
					return null;
				}
			})
			.filter(Boolean) as any[];
	} catch (err) {
		const code = (err as { name?: string }).name;
		if (code === "ResourceNotFoundException") {
			console.log("[span-enrichment] Invocation log group not found — skipping");
			return [];
		}
		throw err;
	}
}

export async function handler(): Promise<void> {
	const endTime = Date.now();
	const startTime = endTime - LOOKBACK_MS;

	console.log(
		`[span-enrichment] Looking for estimated cost events in last ${LOOKBACK_MS / 60000} minutes`,
	);

	// 1. Find estimated LLM cost events that need enrichment
	const estimatedEvents = await db
		.select({
			id: costEvents.id,
			model: costEvents.model,
			createdAt: costEvents.created_at,
			traceId: costEvents.trace_id,
			metadata: costEvents.metadata,
		})
		.from(costEvents)
		.where(
			and(
				eq(costEvents.event_type, "llm"),
				sql`(metadata->>'estimated')::boolean = true`,
				gte(costEvents.created_at, new Date(startTime)),
			),
		)
		.limit(50);

	if (estimatedEvents.length === 0) {
		console.log("[span-enrichment] No estimated events to enrich");
		return;
	}

	console.log(`[span-enrichment] Found ${estimatedEvents.length} estimated events to enrich`);

	// 2. Query invocation logs for the full time window
	const invocations = await queryInvocationLogs(startTime, endTime);
	console.log(`[span-enrichment] Found ${invocations.length} invocation log entries`);

	if (invocations.length === 0) {
		console.log("[span-enrichment] No invocation logs available — will retry next run");
		return;
	}

	// Build a lookup by requestId for fast matching
	const invocationByRequestId = new Map<string, (typeof invocations)[0]>();
	for (const inv of invocations) {
		if (inv.requestId) invocationByRequestId.set(inv.requestId, inv);
	}

	// 3. Match each estimated event to invocation log(s)
	let enriched = 0;
	for (const event of estimatedEvents) {
		if (!event.createdAt) continue;

		const meta = (event.metadata || {}) as Record<string, any>;
		const bedrockRequestIds: string[] = meta.bedrock_request_ids || [];

		let matchedInvocations: (typeof invocations) = [];

		if (bedrockRequestIds.length > 0) {
			// DETERMINISTIC MATCH: use captured Bedrock request IDs
			for (const reqId of bedrockRequestIds) {
				const inv = invocationByRequestId.get(reqId);
				if (inv) matchedInvocations.push(inv);
			}
			if (matchedInvocations.length > 0) {
				console.log(`[span-enrichment] Matched event ${event.id} by ${matchedInvocations.length} request ID(s)`);
			}
		}

		if (matchedInvocations.length === 0) {
			// FALLBACK: timestamp proximity (for legacy events without request IDs)
			const eventMs = event.createdAt.getTime();
			let bestMatch: (typeof invocations)[0] | null = null;
			let bestDelta = Infinity;

			for (const inv of invocations) {
				const invMs = new Date(inv.timestamp).getTime();
				const delta = Math.abs(eventMs - invMs);
				if (delta > 30_000) continue;
				if (event.model && inv.modelId && !inv.modelId.includes(event.model.replace(/^us\./, ""))) continue;
				if (delta < bestDelta) { bestDelta = delta; bestMatch = inv; }
			}

			if (bestMatch) {
				matchedInvocations = [bestMatch];
				console.log(`[span-enrichment] Matched event ${event.id} by timestamp fallback (delta=${bestDelta}ms)`);
			}
		}

		if (matchedInvocations.length === 0) continue;

		// Sum tokens across all matched invocations (a turn may have multiple model calls)
		const totalIn = matchedInvocations.reduce((s, i) => s + i.inputTokens, 0);
		const totalOut = matchedInvocations.reduce((s, i) => s + i.outputTokens, 0);
		const totalCache = matchedInvocations.reduce((s, i) => s + i.cacheReadTokens, 0);
		const bestModel = matchedInvocations[0].modelId;

		if (totalIn === 0 && totalOut === 0) continue;

		// 4. Calculate real cost
		const pricing = lookupPricing(bestModel);
		const realCost =
			(totalIn * pricing.input +
				totalOut * pricing.output) /
			1_000_000;

		// 5. Update the cost event with real data
		await db
			.update(costEvents)
			.set({
				input_tokens: totalIn,
				output_tokens: totalOut,
				cached_read_tokens: totalCache,
				amount_usd: realCost.toFixed(6),
				metadata: sql`jsonb_set(COALESCE(metadata, '{}'::jsonb), '{estimated}', 'false')`,
			})
			.where(eq(costEvents.id, event.id));

		enriched++;
		console.log(
			`[span-enrichment] Enriched event ${event.id}: in=${totalIn} out=${totalOut} cost=$${realCost.toFixed(6)} (${matchedInvocations.length} invocation(s))`,
		);
	}

	console.log(
		`[span-enrichment] Enriched ${enriched}/${estimatedEvents.length} estimated events`,
	);
}
