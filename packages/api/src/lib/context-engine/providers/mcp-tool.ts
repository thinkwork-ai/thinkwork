import type {
	ContextHit,
	ContextProviderDescriptor,
	ContextProviderResult,
} from "../types.js";

export interface McpContextToolProviderConfig {
	id: string;
	displayName: string;
	serverName: string;
	toolName: string;
	defaultEnabled: boolean;
	callTool(args: {
		serverName: string;
		toolName: string;
		query: string;
		limit: number;
	}): Promise<{ content?: unknown; structuredContent?: unknown; isError?: boolean }>;
}

export function createMcpToolContextProvider(
	config: McpContextToolProviderConfig,
): ContextProviderDescriptor {
	return {
		id: config.id,
		family: "mcp",
		displayName: config.displayName,
		defaultEnabled: config.defaultEnabled,
		supportedScopes: ["personal", "team", "auto"],
		async query(request): Promise<ContextProviderResult> {
			const response = await config.callTool({
				serverName: config.serverName,
				toolName: config.toolName,
				query: request.query,
				limit: request.limit,
			});
			if (response.isError) {
				return {
					hits: [],
					status: {
						state: "error",
						error: "MCP tool returned an error result",
					},
				};
			}
			return {
				hits: normalizeMcpToolHits(config, response, request.scope),
			};
		},
	};
}

function normalizeMcpToolHits(
	config: McpContextToolProviderConfig,
	response: { content?: unknown; structuredContent?: unknown },
	scope: "personal" | "team" | "auto",
): ContextHit[] {
	const structured = response.structuredContent;
	const records = Array.isArray((structured as any)?.results)
		? ((structured as any).results as unknown[])
		: [];

	if (records.length > 0) {
		return records.map((record, index) => {
			const asRecord = (record ?? {}) as Record<string, unknown>;
			const title =
				stringValue(asRecord.title) ||
				stringValue(asRecord.name) ||
				`${config.displayName} result ${index + 1}`;
			const snippet =
				stringValue(asRecord.snippet) ||
				stringValue(asRecord.text) ||
				JSON.stringify(record);
			return {
				id: `mcp:${config.serverName}:${config.toolName}:${index}`,
				providerId: config.id,
				family: "mcp",
				title,
				snippet,
				score: typeof asRecord.score === "number" ? asRecord.score : 1 / (index + 1),
				scope,
				provenance: {
					label: config.displayName,
					sourceId: stringValue(asRecord.id) || undefined,
					metadata: {
						serverName: config.serverName,
						toolName: config.toolName,
					},
				},
				metadata: { raw: record },
			};
		});
	}

	const text = contentToText(response.content);
	if (!text) return [];
	return [
		{
			id: `mcp:${config.serverName}:${config.toolName}:text`,
			providerId: config.id,
			family: "mcp",
			title: config.displayName,
			snippet: text,
			score: 0.5,
			scope,
			provenance: {
				label: config.displayName,
				metadata: {
					serverName: config.serverName,
					toolName: config.toolName,
				},
			},
		},
	];
}

function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((item) => {
			const record = (item ?? {}) as Record<string, unknown>;
			return typeof record.text === "string" ? record.text : "";
		})
		.join("\n")
		.trim();
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}
