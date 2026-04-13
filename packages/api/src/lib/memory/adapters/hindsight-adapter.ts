/**
 * Hindsight memory adapter.
 *
 * Maps ThinkWork owner refs (tenant + agent UUID) to Hindsight bank IDs
 * (agent slug) and normalizes Hindsight memory units / recall hits into
 * {@link ThinkWorkMemoryRecord}. Hindsight-specific fields (fact_type,
 * tags, confidence, occurred_start/end) land under `metadata`.
 *
 * Source for lifted logic:
 * - packages/api/src/graphql/resolvers/memory/memoryRecords.query.ts:239-318
 * - packages/api/src/graphql/resolvers/memory/memorySearch.query.ts:158-201
 */

import { eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents } from "@thinkwork/database-pg/schema";
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

export type HindsightAdapterOptions = {
	endpoint: string;
	timeoutMs?: number;
	inspectLimit?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_INSPECT_LIMIT = 500;

const HINDSIGHT_CAPABILITIES: MemoryCapabilities = {
	retain: true,
	recall: true,
	inspectRecords: true,
	inspectGraph: true,
	export: true,
	reflect: true,
	compact: false,
	forget: true,
};

export class HindsightAdapter implements MemoryAdapter {
	readonly kind = "hindsight" as const;

	private readonly endpoint: string;
	private readonly timeoutMs: number;
	private readonly inspectLimit: number;
	private readonly db = getDb();
	private readonly slugCache = new Map<string, string>();

	constructor(opts: HindsightAdapterOptions) {
		if (!opts.endpoint) {
			throw new Error("HindsightAdapter requires an endpoint");
		}
		this.endpoint = opts.endpoint.replace(/\/$/, "");
		this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.inspectLimit = opts.inspectLimit ?? DEFAULT_INSPECT_LIMIT;
	}

	async capabilities(): Promise<MemoryCapabilities> {
		return HINDSIGHT_CAPABILITIES;
	}

	async recall(req: RecallRequest): Promise<RecallResult[]> {
		const bankId = await this.resolveBankId(req.ownerId);
		const limit = req.limit ?? 10;

		let data: any;
		try {
			const resp = await fetch(
				`${this.endpoint}/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ query: req.query, max_results: limit }),
					signal: AbortSignal.timeout(this.timeoutMs),
				},
			);
			if (!resp.ok) {
				console.warn(`[hindsight-adapter] recall ${resp.status} for bank=${bankId}`);
				return [];
			}
			data = await resp.json();
		} catch (err) {
			console.warn(`[hindsight-adapter] recall threw: ${(err as Error)?.message}`);
			return [];
		}

		const memories: any[] = data?.memory_units || data?.memories || data?.results || [];
		return memories.map((m, idx): RecallResult => {
			const score = typeof m.relevance_score === "number"
				? m.relevance_score
				: typeof m.score === "number"
					? m.score
					: Math.max(0, 1 - idx * 0.05);
			return {
				record: this.mapUnit(m, req, bankId),
				score,
				whyRecalled: m.why || undefined,
				backend: "hindsight",
			};
		});
	}

	async retain(req: RetainRequest): Promise<RetainResult> {
		const bankId = await this.resolveBankId(req.ownerId);
		const factType = sourceTypeToFactType(req.sourceType);

		const item: Record<string, unknown> = {
			content: req.content,
			context: req.sourceType,
		};
		const mergedMetadata: Record<string, unknown> = {
			...(req.metadata || {}),
			fact_type: factType,
		};
		if (req.role) mergedMetadata.role = req.role;
		item.metadata = mergedMetadata;

		let data: any = null;
		try {
			const resp = await fetch(
				`${this.endpoint}/v1/default/banks/${encodeURIComponent(bankId)}/memories`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ items: [item] }),
					signal: AbortSignal.timeout(this.timeoutMs),
				},
			);
			if (!resp.ok) {
				throw new Error(`hindsight retain ${resp.status}`);
			}
			data = await resp.json();
		} catch (err) {
			throw new Error(`[hindsight-adapter] retain failed: ${(err as Error)?.message}`);
		}

		const unitList = data?.memory_units || data?.items || (data?.memory_unit ? [data.memory_unit] : []);
		const unit = Array.isArray(unitList) && unitList.length > 0 ? unitList[0] : data || {};
		const record = this.mapUnit({ ...unit, text: unit.text || req.content }, req, bankId);
		return { record, backend: "hindsight" };
	}

	async inspect(req: InspectRequest): Promise<ThinkWorkMemoryRecord[]> {
		const bankId = await this.resolveBankId(req.ownerId);
		const limit = Math.min(req.limit ?? this.inspectLimit, this.inspectLimit);

		let result: any;
		try {
			result = await this.db.execute(sql`
				SELECT
					id, bank_id, text, context, fact_type,
					event_date, occurred_start, occurred_end,
					mentioned_at, tags, access_count, proof_count,
					metadata, created_at, updated_at
				FROM hindsight.memory_units
				WHERE bank_id = ${bankId}
				ORDER BY created_at DESC
				LIMIT ${limit}
			`);
		} catch {
			return [];
		}

		return (result.rows || []).map((row: any) => this.mapRow(row, req, bankId));
	}

	async export(req: ExportRequest): Promise<MemoryExportBundle> {
		const bankId = await this.resolveBankId(req.ownerId);
		let result: any;
		try {
			result = await this.db.execute(sql`
				SELECT
					id, bank_id, text, context, fact_type,
					event_date, occurred_start, occurred_end,
					mentioned_at, tags, access_count, proof_count,
					metadata, created_at, updated_at
				FROM hindsight.memory_units
				WHERE bank_id = ${bankId}
				ORDER BY created_at ASC
			`);
		} catch (err) {
			console.warn(`[hindsight-adapter] export SQL failed: ${(err as Error)?.message}`);
			result = { rows: [] };
		}

		const records = (result.rows || []).map((row: any) => this.mapRow(row, req, bankId));
		return {
			version: "v1",
			exportedAt: new Date().toISOString(),
			engine: "hindsight",
			owner: {
				tenantId: req.tenantId,
				ownerType: req.ownerType,
				ownerId: req.ownerId,
				threadId: req.threadId,
			},
			capabilities: HINDSIGHT_CAPABILITIES,
			records,
		};
	}

	async forget(recordId: string): Promise<void> {
		await this.db.execute(
			sql`DELETE FROM hindsight.memory_units WHERE id = ${recordId}::uuid`,
		);
	}

	async update(recordId: string, content: string): Promise<void> {
		await this.db.execute(sql`
			UPDATE hindsight.memory_units
			SET text = ${content}, updated_at = NOW()
			WHERE id = ${recordId}::uuid
		`);
	}

	private async resolveBankId(ownerId: string): Promise<string> {
		const cached = this.slugCache.get(ownerId);
		if (cached) return cached;

		const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!uuidRe.test(ownerId)) {
			this.slugCache.set(ownerId, ownerId);
			return ownerId;
		}

		try {
			const [row] = await this.db
				.select({ slug: agents.slug })
				.from(agents)
				.where(eq(agents.id, ownerId))
				.limit(1);
			const slug = (row?.slug as string) || ownerId;
			this.slugCache.set(ownerId, slug);
			return slug;
		} catch {
			return ownerId;
		}
	}

	private mapUnit(
		unit: any,
		owner: { tenantId: string; ownerType: "agent"; ownerId: string; threadId?: string },
		bankId: string,
	): ThinkWorkMemoryRecord {
		const createdAt = toISO(unit.created_at) || new Date().toISOString();
		const updatedAt = toISO(unit.updated_at) || undefined;
		const metaFactType =
			unit.metadata && typeof unit.metadata === "object"
				? (unit.metadata as Record<string, unknown>).fact_type
				: undefined;
		const factType: string | null =
			(unit.fact_type as string | null | undefined) ||
			(typeof metaFactType === "string" ? metaFactType : null) ||
			null;
		return {
			id: String(unit.id || `hindsight-${bankId}-${createdAt}`),
			tenantId: owner.tenantId,
			ownerType: "agent",
			ownerId: owner.ownerId,
			threadId: owner.threadId,
			kind: "unit",
			sourceType: inferSourceType(unit),
			strategy: factTypeToStrategy(factType),
			status: "active",
			content: {
				text: String(unit.text || unit.content || ""),
				summary: unit.summary || undefined,
			},
			backendRefs: [{ backend: "hindsight", ref: String(unit.id || "") }],
			createdAt,
			updatedAt,
			metadata: {
				bankId,
				factType,
				tags: unit.tags || null,
				confidence: unit.confidence ?? unit.metadata?.confidence ?? null,
				eventDate: toISO(unit.event_date),
				occurredStart: toISO(unit.occurred_start),
				occurredEnd: toISO(unit.occurred_end),
				mentionedAt: toISO(unit.mentioned_at),
				accessCount: unit.access_count ?? null,
				proofCount: unit.proof_count ?? null,
				context: unit.context ?? null,
				raw: unit.metadata ?? null,
			},
		};
	}

	private mapRow(
		row: any,
		owner: { tenantId: string; ownerType: "agent"; ownerId: string; threadId?: string },
		bankId: string,
	): ThinkWorkMemoryRecord {
		let meta: any = {};
		try {
			meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata || {};
		} catch {
			meta = {};
		}
		return this.mapUnit({ ...row, metadata: meta }, owner, bankId);
	}
}

function toISO(value: any): string | null {
	if (!value) return null;
	try {
		return new Date(value).toISOString();
	} catch {
		return null;
	}
}

function factTypeToStrategy(factType: string | null): MemoryStrategy | undefined {
	switch (factType) {
		case "world":
			return "semantic";
		case "experience":
			return "episodes";
		case "opinion":
			return "preferences";
		case "observation":
			return "summaries";
		default:
			return factType ? "custom" : undefined;
	}
}

function sourceTypeToFactType(sourceType: string): string {
	switch (sourceType) {
		case "explicit_remember":
			return "world";
		case "thread_turn":
			return "experience";
		case "system_reflection":
			return "observation";
		default:
			return "world";
	}
}

function inferSourceType(unit: any): ThinkWorkMemoryRecord["sourceType"] {
	const ctx = (unit.context || "").toString();
	if (ctx === "explicit_memory" || ctx === "explicit_remember") return "explicit_remember";
	if (ctx === "thread_turn") return "thread_turn";
	if (ctx === "system_reflection") return "system_reflection";
	if (unit.fact_type === "observation") return "system_reflection";
	return "thread_turn";
}
