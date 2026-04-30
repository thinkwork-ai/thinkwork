import { invokeClaude } from "../../wiki/bedrock.js";
import type {
	ContextEngineProviderRequest,
	ContextHit,
	ContextProviderDescriptor,
	ContextEngineScope,
	ContextProviderResult,
	ContextProviderStatusState,
} from "../types.js";

export interface SubAgentContextProviderConfig {
	id: string;
	displayName: string;
	promptRef: string;
	prompt?: {
		title: string;
		summary: string;
		instructions?: string[];
	};
	resources?: Array<{
		id: string;
		label: string;
		type: string;
		description: string;
		access: "read" | "write" | "read-write";
	}>;
	skills?: Array<{
		id: string;
		label: string;
		description: string;
	}>;
	toolAllowlist: string[];
	depthCap: number;
	processModel?: "deterministic-retrieval" | "lambda-bedrock-converse" | "agentcore";
	defaultEnabled?: boolean;
	timeoutMs?: number;
	seamState?: "inert" | "live";
	seam?: SubAgentSeam;
	supportedScopes?: ContextEngineScope[];
}

export interface SubAgentSeamResult {
	hits: ContextHit[];
	state: ContextProviderStatusState;
	reason?: string;
	freshness?: {
		asOf: string;
		ttlSeconds: number;
	};
}

export type SubAgentSeam = (
	request: ContextEngineProviderRequest,
	config: SubAgentContextProviderConfig,
) => Promise<SubAgentSeamResult>;

export function createSubAgentContextProvider(
	config: SubAgentContextProviderConfig,
): ContextProviderDescriptor {
	assertToolAllowlist(config.toolAllowlist);
	const seam = config.seam ?? inertSubAgentSeam;
	return {
		id: config.id,
		family: "sub-agent",
		displayName: config.displayName,
		defaultEnabled: config.defaultEnabled ?? false,
		supportedScopes: config.supportedScopes ?? ["team", "auto"],
		timeoutMs: config.timeoutMs ?? 1_000,
		subAgent: {
			promptRef: config.promptRef,
			prompt: config.prompt,
			resources: config.resources,
			skills: config.skills,
			toolAllowlist: config.toolAllowlist,
			depthCap: config.depthCap,
			processModel:
				config.processModel ??
				(config.seam ? "deterministic-retrieval" : "agentcore"),
			seamState: config.seamState ?? (config.seam ? "live" : "inert"),
		},
		async query(request): Promise<ContextProviderResult> {
			const result = await seam(request, config);
			return {
				hits: result.hits,
				status: {
					state: result.state,
					reason: result.reason,
					freshness: result.freshness,
				},
			};
		},
	};
}

export async function invokeSubAgent(args: {
	request: ContextEngineProviderRequest;
	system: string;
	user: string;
	toolAllowlist: string[];
	depthCap: number;
}): Promise<ContextHit[]> {
	assertToolAllowlist(args.toolAllowlist);
	if (args.depthCap < 1) {
		throw new Error("sub-agent depth cap must be at least 1");
	}
	const response = await invokeClaude({
		system: args.system,
		user: args.user,
		maxTokens: 2048,
	});
	return [
		{
			id: `sub-agent:${args.request.caller.tenantId}:${Date.now()}`,
			providerId: "sub-agent",
			family: "sub-agent",
			title: "Sub-agent context",
			snippet: response.text.trim(),
			score: 0.5,
			scope: args.request.scope,
			provenance: {
				label: "Bedrock Converse sub-agent",
				metadata: {
					toolAllowlist: args.toolAllowlist,
					depthCap: args.depthCap,
					modelId: response.modelId,
				},
			},
		},
	];
}

async function inertSubAgentSeam(
	_request: ContextEngineProviderRequest,
	config: SubAgentContextProviderConfig,
): Promise<SubAgentSeamResult> {
	return {
		hits: [],
		state: "skipped",
		reason: `${config.displayName} not yet wired (v0 inert seam)`,
	};
}

function assertToolAllowlist(toolAllowlist: string[]): void {
	const unique = new Set(toolAllowlist);
	if (unique.size !== toolAllowlist.length) {
		throw new Error("sub-agent tool allowlist contains duplicates");
	}
	for (const tool of toolAllowlist) {
		if (!/^[a-z0-9:_.-]+$/i.test(tool)) {
			throw new Error(`invalid sub-agent tool name: ${tool}`);
		}
	}
}
