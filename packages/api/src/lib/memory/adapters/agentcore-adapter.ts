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

import { randomUUID } from "node:crypto";
import {
	BatchCreateMemoryRecordsCommand,
	BedrockAgentCoreClient,
	CreateEventCommand,
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
	RetainTurnRequest,
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
		const client = this.getClient();
		const actorId = req.ownerId;
		const namespace = `assistant_${actorId}`;
		const requestIdentifier = randomUUID().replace(/-/g, "").slice(0, 16);
		const timestamp = new Date();

		const resp = await client.send(
			new BatchCreateMemoryRecordsCommand({
				memoryId: this.memoryId,
				records: [
					{
						requestIdentifier,
						content: { text: req.content },
						namespaces: [namespace],
						timestamp,
					},
				],
			}),
		);

		const failed = resp.failedRecords || [];
		if (failed.length > 0) {
			throw new Error(
				`[agentcore-adapter] retain failed: ${JSON.stringify(failed[0])}`,
			);
		}

		const successful = resp.successfulRecords || [];
		const ref = successful[0]?.memoryRecordId || requestIdentifier;
		const record: ThinkWorkMemoryRecord = {
			id: ref,
			tenantId: req.tenantId,
			ownerType: "agent",
			ownerId: req.ownerId,
			threadId: req.threadId,
			kind: "unit",
			sourceType: req.sourceType,
			strategy: "semantic",
			status: "active",
			content: { text: req.content },
			backendRefs: [{ backend: "agentcore", ref }],
			createdAt: timestamp.toISOString(),
			metadata: {
				namespace,
				requestIdentifier,
				role: req.role,
				...(req.metadata || {}),
			},
		};
		return { record, backend: "agentcore" };
	}

	async retainTurn(req: RetainTurnRequest): Promise<void> {
		// AgentCore's CreateEvent ingests a conversational turn and feeds
		// the background extraction strategies (semantic / preferences /
		// summaries / episodes). This is the same shape store_turn_pair
		// in memory.py uses today; we lift it into the adapter so the
		// runtime can call it through the normalized layer instead of
		// reaching into the AgentCore SDK directly.
		const client = this.getClient();
		const actorId = req.ownerId;
		const sessionId = req.threadId;
		if (!sessionId) {
			throw new Error("[agentcore-adapter] retainTurn requires threadId");
		}

		const payload = req.messages
			.filter((m) => m.content && m.content.trim().length > 0)
			.map((m) => ({
				conversational: {
					content: { text: m.content },
					role: m.role.toUpperCase() as "USER" | "ASSISTANT" | "SYSTEM",
				},
			}));
		if (payload.length === 0) return;

		await client.send(
			new CreateEventCommand({
				memoryId: this.memoryId,
				actorId,
				sessionId,
				eventTimestamp: new Date(),
				// SDK declares the payload union with a `$unknown` member; the
				// concrete `conversational` shape is the only one we use.
				payload: payload as any,
			}),
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

	async update(_recordId: string, _content: string): Promise<void> {
		// AgentCore Memory's BatchUpdateMemoryRecords API returns SUCCEEDED
		// for extracted records but silently no-ops the content change.
		// Verified directly via `aws bedrock-agentcore batch-update-memory-records`
		// followed by `get-memory-record` showing the original text. Rather
		// than lie at the contract boundary, refuse the call so callers see
		// the real story. If AgentCore ever exposes a mutable record type we
		// can revisit. For now this is a footgun we'd rather throw than hide.
		throw new Error(
			"AgentCore memory records are immutable in this deployment. " +
				"Create a new memory instead.",
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
