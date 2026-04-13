/**
 * AgentCore Memory adapter.
 *
 * Maps ThinkWork owner refs to AgentCore namespaces keyed on the agent
 * UUID (which the agent container sets as `actorId` via `_ASSISTANT_ID`)
 * and normalizes AgentCore `MemoryRecordSummary` shapes into
 * {@link ThinkWorkMemoryRecord}. Honest about capability gaps: no graph
 * inspection, no reflect, no compact, no forget (AgentCore Memory has
 * no public delete/update API).
 *
 * Source for lifted logic:
 * - packages/api/src/graphql/resolvers/memory/memoryRecords.query.ts:144-233
 * - packages/api/src/graphql/resolvers/memory/memorySearch.query.ts:97-152
 */

import {
	BatchUpdateMemoryRecordsCommand,
	BedrockAgentCoreClient,
	DeleteMemoryRecordCommand,
	ListMemoryRecordsCommand,
	RetrieveMemoryRecordsCommand,
	type MemoryRecordSummary,
} from "@aws-sdk/client-bedrock-agentcore";
import type { MemoryAdapter } from "../adapter.js";
import type {
	ExportRequest,
	InspectRequest,
	MemoryCapabilities,
	MemoryExportBundle,
	MemoryStrategy,
	RecallRequest,
	RecallResult,
	RetainRequest,
	RetainResult,
	ThinkWorkMemoryRecord,
} from "../types.js";

export type AgentCoreAdapterOptions = {
	memoryId: string;
	region?: string;
	perNamespaceLimit?: number;
};

const DEFAULT_PER_NAMESPACE_LIMIT = 50;

const NAMESPACE_PREFIXES: Array<{
	prefix: (actorId: string) => string;
	strategy: MemoryStrategy;
}> = [
	{ prefix: (actorId) => `assistant_${actorId}`, strategy: "semantic" },
	{ prefix: (actorId) => `preferences_${actorId}`, strategy: "preferences" },
];

const AGENTCORE_CAPABILITIES: MemoryCapabilities = {
	retain: true,
	recall: true,
	inspectRecords: true,
	inspectGraph: false,
	export: true,
	reflect: false,
	compact: false,
	forget: true,
};

export class AgentCoreAdapter implements MemoryAdapter {
	readonly kind = "agentcore" as const;

	private readonly memoryId: string;
	private readonly perNamespaceLimit: number;
	private _client: BedrockAgentCoreClient | null = null;
	private readonly region: string;

	constructor(opts: AgentCoreAdapterOptions) {
		if (!opts.memoryId) {
			throw new Error("AgentCoreAdapter requires a memoryId");
		}
		this.memoryId = opts.memoryId;
		this.region = opts.region || process.env.AWS_REGION || "us-east-1";
		this.perNamespaceLimit = opts.perNamespaceLimit ?? DEFAULT_PER_NAMESPACE_LIMIT;
	}

	async capabilities(): Promise<MemoryCapabilities> {
		return AGENTCORE_CAPABILITIES;
	}

	async recall(req: RecallRequest): Promise<RecallResult[]> {
		const client = this.getClient();
		const actorId = req.ownerId;
		const limit = req.limit ?? 10;

		const calls = NAMESPACE_PREFIXES.map(async ({ prefix, strategy }) => {
			try {
				const resp = await client.send(
					new RetrieveMemoryRecordsCommand({
						memoryId: this.memoryId,
						namespace: prefix(actorId),
						searchCriteria: { searchQuery: req.query, topK: limit },
						maxResults: limit,
					}),
				);
				return (resp.memoryRecordSummaries || []).map(
					(r): RecallResult => ({
						record: this.mapSummary(r, req, strategy, prefix(actorId)),
						score: typeof r.score === "number" ? r.score : 0,
						backend: "agentcore",
					}),
				);
			} catch (err) {
				console.debug(
					`[agentcore-adapter] recall failed ns=${prefix(actorId)}:`,
					(err as Error)?.message,
				);
				return [];
			}
		});
		const results = await Promise.all(calls);
		return results.flat();
	}

	async retain(req: RetainRequest): Promise<RetainResult> {
		throw new Error(
			"[agentcore-adapter] retain via normalized path is not implemented yet; " +
				"use runtime store_turn_pair or direct batch_create_memory_records",
		);
	}

	async inspect(req: InspectRequest): Promise<ThinkWorkMemoryRecord[]> {
		const client = this.getClient();
		const actorId = req.ownerId;
		const out: ThinkWorkMemoryRecord[] = [];

		const calls = NAMESPACE_PREFIXES.map(async ({ prefix, strategy }) => {
			try {
				const resp = await client.send(
					new ListMemoryRecordsCommand({
						memoryId: this.memoryId,
						namespace: prefix(actorId),
						maxResults: req.limit ?? this.perNamespaceLimit,
					}),
				);
				return (resp.memoryRecordSummaries || []).map((r) =>
					this.mapSummary(r, req, strategy, prefix(actorId)),
				);
			} catch (err) {
				console.debug(
					`[agentcore-adapter] list failed ns=${prefix(actorId)}:`,
					(err as Error)?.message,
				);
				return [] as ThinkWorkMemoryRecord[];
			}
		});
		const results = await Promise.all(calls);
		for (const arr of results) out.push(...arr);
		return out;
	}

	async forget(recordId: string): Promise<void> {
		const client = this.getClient();
		await client.send(
			new DeleteMemoryRecordCommand({
				memoryId: this.memoryId,
				memoryRecordId: recordId,
			}),
		);
	}

	async update(recordId: string, content: string): Promise<void> {
		const client = this.getClient();
		await client.send(
			new BatchUpdateMemoryRecordsCommand({
				memoryId: this.memoryId,
				records: [
					{
						memoryRecordId: recordId,
						timestamp: new Date(),
						content: { text: content },
					},
				],
			}),
		);
	}

	async export(req: ExportRequest): Promise<MemoryExportBundle> {
		const records = await this.inspect({
			tenantId: req.tenantId,
			ownerType: req.ownerType,
			ownerId: req.ownerId,
			threadId: req.threadId,
		});
		return {
			version: "v1",
			exportedAt: new Date().toISOString(),
			engine: "agentcore",
			owner: {
				tenantId: req.tenantId,
				ownerType: req.ownerType,
				ownerId: req.ownerId,
				threadId: req.threadId,
			},
			capabilities: AGENTCORE_CAPABILITIES,
			records,
		};
	}

	private getClient(): BedrockAgentCoreClient {
		if (!this._client) {
			this._client = new BedrockAgentCoreClient({ region: this.region });
		}
		return this._client;
	}

	private mapSummary(
		r: MemoryRecordSummary,
		owner: { tenantId: string; ownerType: "agent"; ownerId: string; threadId?: string },
		strategy: MemoryStrategy,
		fallbackNamespace: string,
	): ThinkWorkMemoryRecord {
		const text =
			(r.content && typeof (r.content as any).text === "string"
				? (r.content as any).text
				: "") || "";
		const ns = r.namespaces && r.namespaces.length > 0 ? r.namespaces[0] : fallbackNamespace;
		const createdAt = r.createdAt ? r.createdAt.toISOString() : new Date().toISOString();
		return {
			id: r.memoryRecordId || `agentcore-${ns}-${createdAt}`,
			tenantId: owner.tenantId,
			ownerType: "agent",
			ownerId: owner.ownerId,
			threadId: owner.threadId,
			kind: "unit",
			sourceType: "thread_turn",
			strategy,
			status: "active",
			content: { text },
			backendRefs: [
				{ backend: "agentcore", ref: r.memoryRecordId || "" },
			],
			createdAt,
			metadata: {
				namespace: ns,
				memoryStrategyId: r.memoryStrategyId || null,
				score: typeof r.score === "number" ? r.score : null,
			},
		};
	}
}
