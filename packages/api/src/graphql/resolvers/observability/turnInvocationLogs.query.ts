/**
 * PRD-20C: Query Bedrock model invocation logs for a specific turn.
 *
 * Looks up the turn's time window (started_at → finished_at), then queries
 * /thinkwork/bedrock/model-invocations for all model calls in that window.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, threadTurns } from "../../utils.js";
import {
	CloudWatchLogsClient,
	FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

const logsClient = new CloudWatchLogsClient({ region: "us-east-1" });
const INVOCATIONS_LOG_GROUP = "/thinkwork/bedrock/model-invocations";

// Fallback pricing for cost calculation (per million tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
	"claude-sonnet-4-5": { input: 3.0, output: 15.0 },
	"claude-sonnet-4-6": { input: 3.0, output: 15.0 },
	"claude-haiku-4-5": { input: 0.8, output: 4.0 },
	"claude-3-haiku": { input: 0.25, output: 1.25 },
	"kimi-k2": { input: 1.0, output: 3.0 },
};

function lookupPricing(modelId: string): { input: number; output: number } {
	const lower = modelId.toLowerCase();
	for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
		if (lower.includes(key)) return pricing;
	}
	return { input: 3.0, output: 15.0 }; // default
}

function shortenModelId(modelId: string): string {
	// "arn:aws:bedrock:...:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0"
	const parts = modelId.split("/");
	const name = parts[parts.length - 1] || modelId;
	return name.replace(/^us\.anthropic\./, "").replace(/-v\d+:\d+$/, "");
}

function extractInputPreview(inputBodyJson: any): string {
	if (!inputBodyJson) return "";

	const parts: string[] = [];

	// System prompt (full)
	if (inputBodyJson.system) {
		const sys = Array.isArray(inputBodyJson.system)
			? inputBodyJson.system.map((s: any) => s.text || "").join("\n")
			: String(inputBodyJson.system);
		if (sys) parts.push(`[System]\n${sys}`);
	}

	// All messages
	if (inputBodyJson.messages) {
		for (const msg of inputBodyJson.messages) {
			const role = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : msg.role;
			const content = msg.content;
			if (typeof content === "string") {
				parts.push(`[${role}] ${content}`);
			} else if (Array.isArray(content)) {
				const textParts: string[] = [];
				for (const b of content) {
					if (b.type === "text" && b.text) textParts.push(b.text);
					if (b.type === "tool_use") textParts.push(`[tool_use: ${b.name}(${JSON.stringify(b.input).slice(0, 200)})]`);
					if (b.type === "tool_result") textParts.push(`[tool_result: ${JSON.stringify(b.content).slice(0, 200)}]`);
					if (b.toolUse) textParts.push(`[tool_use: ${b.toolUse.name}]`);
					if (b.toolResult) {
						const trContent = b.toolResult.content;
						let trText = "";
						if (Array.isArray(trContent)) {
							trText = trContent.map((c: any) => {
								if (c.text) return c.text;
								if (c.json) return JSON.stringify(c.json);
								return JSON.stringify(c);
							}).join("\n").slice(0, 5000);
						} else if (typeof trContent === "string") {
							trText = trContent.slice(0, 5000);
						} else if (trContent) {
							trText = JSON.stringify(trContent).slice(0, 5000);
						}
						textParts.push(`[tool_result: ${trText || "(no content)"}]`);
					}
				}
				if (textParts.length) parts.push(`[${role}] ${textParts.join("\n")}`);
			}
		}
	}

	// Tool config summary
	if (inputBodyJson.toolConfig?.tools) {
		const toolNames = inputBodyJson.toolConfig.tools.map((t: any) => t.toolSpec?.name || "?").join(", ");
		parts.push(`[Tools] ${toolNames}`);
	}

	return parts.join("\n\n") || "";
}

function extractOutputPreview(outputBodyJson: any): string {
	if (!outputBodyJson) return "";

	// Non-streaming format: { output: { message: { content: [...] } }, stopReason, ... }
	if (typeof outputBodyJson === "object" && !Array.isArray(outputBodyJson)) {
		const content = outputBodyJson.output?.message?.content || outputBodyJson.content || [];
		if (Array.isArray(content)) {
			const textParts: string[] = [];
			for (const block of content) {
				if (block.type === "text" && block.text) textParts.push(block.text);
				if (block.type === "tool_use") textParts.push(`[tool: ${block.name}]`);
			}
			if (textParts.length > 0) return textParts.join("\n").slice(0, 10000);
		}
	}

	// Streaming format: array of content_block_delta events
	if (Array.isArray(outputBodyJson)) {
		const textParts: string[] = [];
		for (const chunk of outputBodyJson) {
			if (chunk.type === "content_block_delta" && chunk.delta?.text) {
				textParts.push(chunk.delta.text);
			}
		}
		return textParts.join("").slice(0, 10000);
	}

	return "";
}

export const turnInvocationLogs = async (_parent: any, args: any, _ctx: GraphQLContext) => {
	// 1. Look up the turn's time window
	const [turn] = await db
		.select({
			startedAt: threadTurns.started_at,
			finishedAt: threadTurns.finished_at,
			createdAt: threadTurns.created_at,
		})
		.from(threadTurns)
		.where(eq(threadTurns.id, args.turnId))
		.limit(1);

	if (!turn) return [];

	const startTime = turn.startedAt || turn.createdAt;
	const endTime = turn.finishedAt || new Date();
	if (!startTime) return [];

	// Add 1s buffer on each side for clock skew
	const startMs = startTime.getTime() - 1000;
	const endMs = endTime.getTime() + 5000;

	// 2. Query CloudWatch for invocation logs in this window
	try {
		const response = await logsClient.send(
			new FilterLogEventsCommand({
				logGroupName: INVOCATIONS_LOG_GROUP,
				startTime: startMs,
				endTime: endMs,
				limit: 20,
			}),
		);

		if (!response.events?.length) return [];

		// 3. Parse and transform each log event
		return response.events
			.map((event) => {
				try {
					const log = JSON.parse(event.message || "{}");
					const input = log.input || {};
					const output = log.output || {};
					const modelId = log.modelId || "";
					const pricing = lookupPricing(modelId);

					const inputTokens = input.inputTokenCount || 0;
					const outputTokens = output.outputTokenCount || 0;
					const cacheReadTokens = input.cacheReadInputTokenCount || 0;

					const costUsd =
						(inputTokens * pricing.input + outputTokens * pricing.output) /
						1_000_000;

					// Extract tool uses from output
				const outputContent = output.outputBodyJson?.output?.message?.content || [];
				const toolUses: string[] = [];
				for (const block of Array.isArray(outputContent) ? outputContent : []) {
					if (block?.toolUse?.name) toolUses.push(block.toolUse.name);
				}

				// Check if input has tool results (means this call processes a tool's return)
				const hasToolResult = (input.inputBodyJson?.messages || []).some((m: any) =>
					Array.isArray(m?.content) && m.content.some((b: any) => b?.toolResult),
				);

				// Heuristic: detect sub-agent calls by checking system prompt content.
				// Parent prompts contain "Workspace Map" (AGENTS.md) or personality files (SOUL.md).
				// Sub-agent prompts contain "What This Workspace Is" (workspace CONTEXT.md) or are
				// short role descriptions (legacy sub-agents).
				const systemPrompt = input.inputBodyJson?.system || [];
				const systemText = Array.isArray(systemPrompt)
					? systemPrompt.map((s: any) => s.text || "").join(" ")
					: String(systemPrompt);
				const systemLen = systemText.length;
				const hasParentMarkers = systemText.includes("Workspace Map") ||
					systemText.includes("Task Router") ||
					systemText.includes("# Soul") ||
					systemText.includes("# Identity");
				const isLikelySubAgent = systemLen > 0 && !hasParentMarkers;

				// Extract sub-agent name from CONTEXT.md heading (e.g., "# Research")
				let branch = "parent";
				if (isLikelySubAgent) {
					const nameMatch = systemText.match(/^#\s+(.+)$/m) || systemText.match(/#\s+(.+?)(?:\n|$)/);
					const subAgentName = nameMatch ? nameMatch[1].trim().toLowerCase().replace(/\s+/g, "-") : "unknown";
					branch = `sub-agent:${subAgentName}`;
				}

				return {
						requestId: log.requestId || "",
						modelId: shortenModelId(modelId),
						timestamp: log.timestamp || new Date(event.timestamp || 0).toISOString(),
						inputTokenCount: inputTokens,
						outputTokenCount: outputTokens,
						cacheReadTokenCount: cacheReadTokens,
						inputPreview: extractInputPreview(input.inputBodyJson),
						outputPreview: extractOutputPreview(output.outputBodyJson),
						toolCount: input.inputBodyJson?.tools?.length || 0,
						costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
						toolUses,
						hasToolResult,
						branch,
					};
				} catch {
					return null;
				}
			})
			.filter(Boolean);
	} catch (err) {
		const code = (err as { name?: string }).name;
		if (code === "ResourceNotFoundException") {
			return []; // Log group doesn't exist yet
		}
		console.error("[turnInvocationLogs] Error querying CloudWatch:", err);
		return [];
	}
};
