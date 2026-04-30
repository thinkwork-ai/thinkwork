import { invokeClaudeJson, parseJsonResponse } from "../../wiki/bedrock.js";

const SOURCE_AGENT_MODEL_ID =
	process.env.COMPANY_BRAIN_SOURCE_AGENT_MODEL_ID ||
	process.env.CONTEXT_ENGINE_SOURCE_AGENT_MODEL_ID;

export interface SourceAgentModelRequest {
	system: string;
	user: string;
	maxTokens: number;
	temperature: number;
	signal?: AbortSignal;
}

export interface SourceAgentModelResponse {
	text: string;
	modelId?: string;
	inputTokens?: number;
	outputTokens?: number;
	stopReason?: string | null;
}

export type SourceAgentModel = (
	request: SourceAgentModelRequest,
) => Promise<SourceAgentModelResponse>;

export interface SourceAgentToolContext {
	query: string;
	turn: number;
	signal?: AbortSignal;
	observedSourceIds: ReadonlySet<string>;
	rememberSource(id: string, value: unknown): void;
	getSource<T = unknown>(id: string): T | undefined;
}

export interface SourceAgentToolResult {
	observation: unknown;
	summary?: string;
	citedSourceIds?: string[];
}

export interface SourceAgentTool {
	name: string;
	description: string;
	execute(
		input: Record<string, unknown>,
		context: SourceAgentToolContext,
	): Promise<SourceAgentToolResult>;
}

export interface SourceAgentTraceStep {
	id: string;
	type: "model" | "tool" | "final" | "error";
	turn: number;
	status: "ok" | "error";
	durationMs?: number;
	summary: string;
	tool?: string;
	toolCallId?: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	modelId?: string;
	inputTokens?: number;
	outputTokens?: number;
	stopReason?: string | null;
}

export interface SourceAgentFinalResult {
	sourceId: string;
	title?: string;
	summary?: string;
	confidence?: number;
	sourceToolCallIds?: string[];
}

export interface SourceAgentRunResult {
	state: "ok" | "error";
	reason?: string;
	finalResults: SourceAgentFinalResult[];
	trace: SourceAgentTraceStep[];
	observedSourceIds: string[];
	model: {
		id?: string;
		inputTokens: number;
		outputTokens: number;
		turns: number;
	};
	toolCallCount: number;
}

interface SourceAgentAction {
	tool_calls?: SourceAgentToolCall[];
	tool_call?: SourceAgentToolCall;
	final?: {
		answer?: string;
		results?: Array<Record<string, unknown>>;
	};
}

interface SourceAgentToolCall {
	id?: string;
	tool?: string;
	input?: Record<string, unknown>;
}

export async function runSourceAgent(args: {
	name: string;
	system: string;
	query: string;
	tools: SourceAgentTool[];
	allowedTools: string[];
	depthCap: number;
	model?: SourceAgentModel;
	maxTokens?: number;
	temperature?: number;
	signal?: AbortSignal;
}): Promise<SourceAgentRunResult> {
	assertRuntimeArgs(args.depthCap, args.tools, args.allowedTools);

	const model = args.model ?? bedrockSourceAgentModel;
	const trace: SourceAgentTraceStep[] = [];
	const sourceMemory = new Map<string, unknown>();
	const observedSourceIds = new Set<string>();
	const observations: Array<{
		turn: number;
		toolCallId: string;
		tool: string;
		summary: string;
		observation: unknown;
	}> = [];
	const toolMap = new Map(args.tools.map((tool) => [tool.name, tool]));
	let inputTokens = 0;
	let outputTokens = 0;
	let modelId: string | undefined;
	let toolCallCount = 0;

	for (let turn = 1; turn <= args.depthCap; turn++) {
		const modelStart = Date.now();
		let response: SourceAgentModelResponse;
		try {
			response = await model({
				system: args.system,
				user: buildUserTurnPrompt({
					name: args.name,
					query: args.query,
					tools: args.tools,
					observations,
				}),
				maxTokens: args.maxTokens ?? 2048,
				temperature: args.temperature ?? 0,
				signal: args.signal,
			});
		} catch (err) {
			const message = errorMessage(err);
			trace.push({
				id: `turn-${turn}:model`,
				type: "model",
				turn,
				status: "error",
				durationMs: Date.now() - modelStart,
				summary: `model call failed: ${message}`,
				error: message,
			});
			return errorResult({
				trace,
				reason: `model call failed: ${message}`,
				observedSourceIds,
				inputTokens,
				outputTokens,
				modelId,
				turns: turn,
				toolCallCount,
			});
		}

		modelId = response.modelId ?? modelId;
		inputTokens += response.inputTokens ?? 0;
		outputTokens += response.outputTokens ?? 0;
		trace.push({
			id: `turn-${turn}:model`,
			type: "model",
			turn,
			status: "ok",
			durationMs: Date.now() - modelStart,
			summary: summarizeModelResponse(response.text),
			modelId: response.modelId,
			inputTokens: response.inputTokens,
			outputTokens: response.outputTokens,
			stopReason: response.stopReason,
		});

		const action = parseAction(response.text);
		if (!action.ok) {
			trace.push({
				id: `turn-${turn}:parse`,
				type: "error",
				turn,
				status: "error",
				summary: action.error,
				error: action.error,
			});
			return errorResult({
				trace,
				reason: action.error,
				observedSourceIds,
				inputTokens,
				outputTokens,
				modelId,
				turns: turn,
				toolCallCount,
			});
		}

		if (action.value.final) {
			const normalizedResults = normalizeFinalResults(action.value.final.results);
			const finalResults = normalizedResults.filter((result) =>
				observedSourceIds.has(result.sourceId),
			);
			const rejectedCount = normalizedResults.length - finalResults.length;
			trace.push({
				id: `turn-${turn}:final`,
				type: "final",
				turn,
				status: finalResults.length > 0 ? "ok" : "error",
				summary:
					finalResults.length > 0
						? `accepted ${finalResults.length} cited result${
								finalResults.length === 1 ? "" : "s"
							}${rejectedCount ? `; rejected ${rejectedCount} uncited` : ""}`
						: "final answer did not cite any observed source ids",
				output: { results: finalResults },
			});
			if (finalResults.length > 0) {
				return {
					state: "ok",
					finalResults,
					trace,
					observedSourceIds: [...observedSourceIds],
					model: {
						id: modelId,
						inputTokens,
						outputTokens,
						turns: turn,
					},
					toolCallCount,
				};
			}
			return errorResult({
				trace,
				reason: "final answer did not cite any observed source ids",
				observedSourceIds,
				inputTokens,
				outputTokens,
				modelId,
				turns: turn,
				toolCallCount,
			});
		}

		const toolCalls = normalizeToolCalls(action.value);
		if (toolCalls.length === 0) {
			const reason = "model returned neither tool_calls nor final";
			trace.push({
				id: `turn-${turn}:empty-action`,
				type: "error",
				turn,
				status: "error",
				summary: reason,
				error: reason,
			});
			return errorResult({
				trace,
				reason,
				observedSourceIds,
				inputTokens,
				outputTokens,
				modelId,
				turns: turn,
				toolCallCount,
			});
		}

		for (const [index, call] of toolCalls.entries()) {
			const toolName = call.tool ?? "";
			const toolCallId = call.id || `turn-${turn}:tool-${index + 1}`;
			const tool = toolMap.get(toolName);
			if (!args.allowedTools.includes(toolName) || !tool) {
				const reason = `tool ${toolName || "<missing>"} is not allowed`;
				trace.push({
					id: `turn-${turn}:${toolCallId}`,
					type: "tool",
					turn,
					status: "error",
					summary: reason,
					tool: toolName || undefined,
					toolCallId,
					input: call.input ?? {},
					error: reason,
				});
				return errorResult({
					trace,
					reason,
					observedSourceIds,
					inputTokens,
					outputTokens,
					modelId,
					turns: turn,
					toolCallCount,
				});
			}

			const toolStart = Date.now();
			try {
				const result = await tool.execute(call.input ?? {}, {
					query: args.query,
					turn,
					signal: args.signal,
					observedSourceIds,
					rememberSource(id, value) {
						observedSourceIds.add(id);
						sourceMemory.set(id, value);
					},
					getSource<T = unknown>(id: string): T | undefined {
						return sourceMemory.get(id) as T | undefined;
					},
				});
				for (const sourceId of result.citedSourceIds ?? []) {
					observedSourceIds.add(sourceId);
				}
				const summary = result.summary ?? summarizeObservation(result.observation);
				observations.push({
					turn,
					toolCallId,
					tool: tool.name,
					summary,
					observation: result.observation,
				});
				toolCallCount += 1;
				trace.push({
					id: `turn-${turn}:${toolCallId}`,
					type: "tool",
					turn,
					status: "ok",
					durationMs: Date.now() - toolStart,
					summary,
					tool: tool.name,
					toolCallId,
					input: call.input ?? {},
					output: compactObservation(result.observation),
				});
			} catch (err) {
				const message = errorMessage(err);
				trace.push({
					id: `turn-${turn}:${toolCallId}`,
					type: "tool",
					turn,
					status: "error",
					durationMs: Date.now() - toolStart,
					summary: `tool ${tool.name} failed: ${message}`,
					tool: tool.name,
					toolCallId,
					input: call.input ?? {},
					error: message,
				});
				return errorResult({
					trace,
					reason: `tool ${tool.name} failed: ${message}`,
					observedSourceIds,
					inputTokens,
					outputTokens,
					modelId,
					turns: turn,
					toolCallCount,
				});
			}
		}
	}

	return errorResult({
		trace,
		reason: `source agent reached depth cap (${args.depthCap}) before final answer`,
		observedSourceIds,
		inputTokens,
		outputTokens,
		modelId,
		turns: args.depthCap,
		toolCallCount,
	});
}

async function bedrockSourceAgentModel(
	request: SourceAgentModelRequest,
): Promise<SourceAgentModelResponse> {
	const response = await invokeClaudeJson<SourceAgentAction>({
		...request,
		...(SOURCE_AGENT_MODEL_ID ? { modelId: SOURCE_AGENT_MODEL_ID } : {}),
		parse: parseSourceAgentActionForRetry,
	});
	return {
		text: response.text,
		modelId: response.modelId,
		inputTokens: response.inputTokens,
		outputTokens: response.outputTokens,
		stopReason: response.stopReason,
	};
}

function buildUserTurnPrompt(args: {
	name: string;
	query: string;
	tools: SourceAgentTool[];
	observations: Array<{
		turn: number;
		toolCallId: string;
		tool: string;
		summary: string;
		observation: unknown;
	}>;
}): string {
	return [
		`Source agent: ${args.name}`,
		`User query: ${args.query}`,
		"",
		"Allowed tools:",
		...args.tools.map(
			(tool) => `- ${tool.name}: ${tool.description}`,
		),
		"",
		"Return only JSON in one of these shapes:",
		`{"tool_calls":[{"id":"call-1","tool":"tool.name","input":{}}]}`,
		`{"final":{"answer":"short answer","results":[{"source_id":"observed-source-id","title":"title","summary":"why it matches","confidence":0.9,"source_tool_call_ids":["call-1"]}]}}`,
		"",
		args.observations.length
			? "You may call another tool or return final JSON using only observed source ids."
			: "No sources have been observed yet. Your first response must call at least one allowed tool.",
		"",
		"Citation rule: final.results must only cite source ids returned by earlier tool observations.",
		"",
		"Tool observations so far:",
		args.observations.length
			? JSON.stringify(
					args.observations.map((observation) => ({
						turn: observation.turn,
						tool_call_id: observation.toolCallId,
						tool: observation.tool,
						summary: observation.summary,
						observation: compactForPrompt(observation.observation),
					})),
					null,
					2,
				)
			: "[]",
	].join("\n");
}

function parseSourceAgentActionForRetry(text: string): SourceAgentAction {
	const action = coerceSourceAgentAction(parseJsonResponse<unknown>(text));
	if (action) {
		return action;
	}
	throw new Error(
		"parseJsonResponse: source agent action must include tool_calls or final",
	);
}

function parseAction(
	text: string,
): { ok: true; value: SourceAgentAction } | { ok: false; error: string } {
	try {
		const parsed = coerceSourceAgentAction(parseJsonResponse<unknown>(text));
		if (!parsed) return { ok: false, error: "model response was not an action" };
		return { ok: true, value: parsed };
	} catch (err) {
		return {
			ok: false,
			error: `model response was not valid action JSON: ${errorMessage(err)}`,
		};
	}
}

function coerceSourceAgentAction(value: unknown): SourceAgentAction | null {
	if (!value || typeof value !== "object") return null;
	if (Array.isArray(value)) {
		const toolCalls = value.filter(isSourceAgentToolCall);
		return toolCalls.length ? { tool_calls: toolCalls } : null;
	}
	if (isSourceAgentToolCall(value)) {
		return { tool_calls: [value] };
	}
	const action = value as SourceAgentAction;
	if (action.final || normalizeToolCalls(action).length > 0) {
		return action;
	}
	return null;
}

function isSourceAgentToolCall(value: unknown): value is SourceAgentToolCall {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as SourceAgentToolCall).tool === "string"
	);
}

function normalizeToolCalls(action: SourceAgentAction): SourceAgentToolCall[] {
	const calls = action.tool_calls ?? (action.tool_call ? [action.tool_call] : []);
	return calls.filter((call): call is SourceAgentToolCall => {
		return !!call && typeof call === "object";
	});
}

function normalizeFinalResults(
	results: Array<Record<string, unknown>> | undefined,
): SourceAgentFinalResult[] {
	return (results ?? [])
		.map((result) => {
			const sourceId =
				stringValue(result.source_id) ??
				stringValue(result.sourceId) ??
				stringValue(result.page_id) ??
				stringValue(result.pageId);
			if (!sourceId) return null;
			const normalized: SourceAgentFinalResult = { sourceId };
			const title = stringValue(result.title);
			const summary = stringValue(result.summary);
			const confidence = numberValue(result.confidence);
			const sourceToolCallIds = arrayOfStrings(
				result.source_tool_call_ids ?? result.sourceToolCallIds,
			);
			if (title) normalized.title = title;
			if (summary) normalized.summary = summary;
			if (confidence !== undefined) normalized.confidence = confidence;
			if (sourceToolCallIds) normalized.sourceToolCallIds = sourceToolCallIds;
			return normalized;
		})
		.filter((result): result is SourceAgentFinalResult => result !== null);
}

function assertRuntimeArgs(
	depthCap: number,
	tools: SourceAgentTool[],
	allowedTools: string[],
): void {
	if (depthCap < 1) {
		throw new Error("source agent depth cap must be at least 1");
	}
	const toolNames = new Set<string>();
	for (const tool of tools) {
		if (toolNames.has(tool.name)) {
			throw new Error(`duplicate source agent tool: ${tool.name}`);
		}
		toolNames.add(tool.name);
	}
	for (const allowed of allowedTools) {
		if (!toolNames.has(allowed)) {
			throw new Error(`allowed source agent tool is not registered: ${allowed}`);
		}
	}
}

function errorResult(args: {
	trace: SourceAgentTraceStep[];
	reason: string;
	observedSourceIds: Set<string>;
	inputTokens: number;
	outputTokens: number;
	modelId?: string;
	turns: number;
	toolCallCount: number;
}): SourceAgentRunResult {
	return {
		state: "error",
		reason: args.reason,
		finalResults: [],
		trace: args.trace,
		observedSourceIds: [...args.observedSourceIds],
		model: {
			id: args.modelId,
			inputTokens: args.inputTokens,
			outputTokens: args.outputTokens,
			turns: args.turns,
		},
		toolCallCount: args.toolCallCount,
	};
}

function summarizeModelResponse(text: string): string {
	const compact = text.replace(/\s+/g, " ").trim();
	return compact.length > 160 ? `${compact.slice(0, 160)}...` : compact;
}

function summarizeObservation(value: unknown): string {
	if (typeof value === "string") return truncate(value, 160);
	if (Array.isArray(value)) return `${value.length} item observation`;
	if (value && typeof value === "object") return "structured observation";
	return String(value);
}

function compactObservation(value: unknown): unknown {
	if (typeof value === "string") return truncate(value, 500);
	if (Array.isArray(value)) return value.slice(0, 10);
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).slice(0, 12);
		return Object.fromEntries(entries);
	}
	return value;
}

function compactForPrompt(value: unknown, depth = 0): unknown {
	if (typeof value === "string") return truncate(value, 2000);
	if (typeof value === "number" || typeof value === "boolean" || value == null) {
		return value;
	}
	if (Array.isArray(value)) {
		if (depth >= 3) return `${value.length} item array`;
		return value.slice(0, 8).map((item) => compactForPrompt(item, depth + 1));
	}
	if (typeof value === "object") {
		if (depth >= 3) return "nested object";
		const entries = Object.entries(value as Record<string, unknown>).slice(0, 12);
		return Object.fromEntries(
			entries.map(([key, entryValue]) => [
				key,
				compactForPrompt(entryValue, depth + 1),
			]),
		);
	}
	return String(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const strings = value.filter((item): item is string => typeof item === "string");
	return strings.length ? strings : undefined;
}

function truncate(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
