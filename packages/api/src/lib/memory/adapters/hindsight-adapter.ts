/**
 * Hindsight memory adapter.
 *
 * Maps ThinkWork owner refs (tenant + user UUID) to Hindsight bank IDs
 * (`user_${userId}`) and normalizes Hindsight memory units / recall hits into
 * {@link ThinkWorkMemoryRecord}. Hindsight-specific fields (fact_type,
 * tags, confidence, occurred_start/end) land under `metadata`.
 *
 * Source for lifted logic:
 * - packages/api/src/graphql/resolvers/memory/memoryRecords.query.ts:239-318
 * - packages/api/src/graphql/resolvers/memory/memorySearch.query.ts:158-201
 */

import { sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import type {
  ListRecordsUpdatedSinceRequest,
  ListRecordsUpdatedSinceResult,
  MemoryAdapter,
} from "../adapter.js";
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
  RetainConversationRequest,
  RetainDailyMemoryRequest,
  RetainTurnRequest,
  ThinkWorkMemoryRecord,
} from "../types.js";

export type HindsightAdapterOptions = {
  endpoint: string;
  timeoutMs?: number;
  inspectLimit?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_INSPECT_LIMIT = 500;
const HINDSIGHT_FACT_TYPES = ["world", "experience", "observation"] as const;
const QUICK_RECALL_MAX_TOKENS = 500;
const DEEP_RECALL_MAX_TOKENS = 2_000;

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
    const primaryBankId = await this.resolveBankId(req.ownerId);
    const bankIds =
      req.hindsight?.includeLegacyBanks === true
        ? await this.resolveReadBankIds(req.ownerId, req.tenantId)
        : [primaryBankId];
    const limit = req.limit ?? 10;
    const quick = req.depth !== "deep";
    const maxTokens =
      req.hindsight?.maxTokens ??
      (quick
        ? QUICK_RECALL_MAX_TOKENS
        : (req.tokenBudget ?? DEEP_RECALL_MAX_TOKENS));
    const body: Record<string, unknown> = {
      query: req.query,
      budget: req.hindsight?.budget ?? (quick ? "low" : "mid"),
      max_tokens: Math.max(1, Math.floor(maxTokens)),
      types: req.hindsight?.types ?? HINDSIGHT_FACT_TYPES,
    };
    if (req.hindsight?.includeEntities === false || quick) {
      body.include = { entities: null };
    }
    if (req.hindsight?.trace === true) {
      body.trace = true;
    }

    const batches = await Promise.all(
      bankIds.map(async (bankId) => {
        const url = `${this.endpoint}/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`;
        let data: any;
        try {
          const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            console.warn(
              `[hindsight-adapter] recall ${resp.status} url=${url} body=${errText.slice(0, 400)}`,
            );
            return [];
          }
          data = await resp.json();
        } catch (err) {
          console.warn(
            `[hindsight-adapter] recall threw url=${url} message=${(err as Error)?.message}`,
          );
          return [];
        }

        const memories: any[] =
          data?.memory_units || data?.memories || data?.results || [];
        if (memories.length === 0) {
          console.log(
            `[hindsight-adapter] recall returned 0 hits bank=${bankId} query=${JSON.stringify(req.query).slice(0, 200)} keys=${Object.keys(data || {}).join(",")}`,
          );
        }
        return memories.map((m, idx): RecallResult => {
          const score =
            numberField(m.relevance_score) ??
            numberField(m.score) ??
            numberField(m.combined_score) ??
            numberField(m.weight) ??
            numberField(m.activation) ??
            numberField(m.cross_encoder_score_normalized) ??
            Math.max(0, 1 - idx * 0.05);
          return {
            record: this.mapUnit(m, req, bankId),
            score,
            whyRecalled: m.why || undefined,
            backend: "hindsight",
          };
        });
      }),
    );
    return dedupeRecordsById(batches.flat(), (r) => r.record.id)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async retain(req: RetainRequest): Promise<RetainResult> {
    const bankId = await this.resolveBankId(req.ownerId);
    const factType = resolveFactType(req);

    const { fact_type_override: _omitOverride, ...callerMetadata } =
      (req.metadata || {}) as Record<string, unknown>;
    const item: Record<string, unknown> = {
      content: req.content,
      context: req.sourceType,
    };
    const mergedMetadata: Record<string, unknown> = {
      ...callerMetadata,
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
      throw new Error(
        `[hindsight-adapter] retain failed: ${(err as Error)?.message}`,
      );
    }

    const unitList =
      data?.memory_units ||
      data?.items ||
      (data?.memory_unit ? [data.memory_unit] : []);
    const unit =
      Array.isArray(unitList) && unitList.length > 0 ? unitList[0] : data || {};
    const record = this.mapUnit(
      { ...unit, text: unit.text || req.content },
      req,
      bankId,
    );
    return { record, backend: "hindsight" };
  }

  async retainTurn(req: RetainTurnRequest): Promise<void> {
    // Deprecated compatibility path. New callers should use
    // retainConversation so Hindsight receives one replaceable item per
    // conversation rather than one item per message.
    const bankId = await this.resolveBankId(req.ownerId);
    const items = req.messages
      .filter((m) => m.content && m.content.trim().length > 0)
      .map((m) => ({
        content: m.content,
        context: "thread_turn",
        metadata: {
          ...(req.metadata || {}),
          role: m.role,
          thread_id: req.threadId,
        },
      }));
    if (items.length === 0) return;

    try {
      const resp = await fetch(
        `${this.endpoint}/v1/default/banks/${encodeURIComponent(bankId)}/memories`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (!resp.ok) {
        throw new Error(`hindsight retainTurn ${resp.status}`);
      }
    } catch (err) {
      throw new Error(
        `[hindsight-adapter] retainTurn failed: ${(err as Error)?.message}`,
      );
    }
  }

  async retainConversation(req: RetainConversationRequest): Promise<void> {
    const bankId = await this.resolveBankId(req.ownerId);
    const lines = req.messages
      .filter((m) => m.content && m.content.trim().length > 0)
      .map(
        (m) =>
          `${m.role} (${new Date(m.timestamp).toISOString()}): ${m.content.trim()}`,
      );
    if (lines.length === 0) return;

    const content = lines.join("\n");
    const item = {
      content,
      document_id: req.threadId,
      update_mode: "replace",
      context: "thinkwork_thread",
      metadata: {
        ...(req.metadata || {}),
        tenantId: req.tenantId,
        userId: req.ownerId,
        threadId: req.threadId,
        turnCount: lines.length,
        source: "thinkwork",
      },
    };
    await this.postItems(bankId, [item], "retainConversation");
    console.log(
      `[hindsight-adapter] retainConversation ok bank=${bankId.slice(0, 18)} thread=${req.threadId.slice(0, 12)} turns=${lines.length} bytes=${content.length}`,
    );
  }

  async retainDailyMemory(req: RetainDailyMemoryRequest): Promise<void> {
    const content = req.content.trim();
    if (!content) return;

    const bankId = await this.resolveBankId(req.ownerId);
    const item = {
      content,
      document_id: `workspace_daily:${req.ownerId}:${req.date}`,
      update_mode: "replace",
      context: "thinkwork_workspace_daily",
      metadata: {
        ...(req.metadata || {}),
        tenantId: req.tenantId,
        userId: req.ownerId,
        date: req.date,
        source: "thinkwork",
      },
    };
    await this.postItems(bankId, [item], "retainDailyMemory");
    console.log(
      `[hindsight-adapter] retainDailyMemory ok bank=${bankId.slice(0, 18)} date=${req.date} bytes=${content.length}`,
    );
  }

  async inspect(req: InspectRequest): Promise<ThinkWorkMemoryRecord[]> {
    const bankIds = await this.resolveReadBankIds(req.ownerId, req.tenantId);
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
				WHERE bank_id IN (${sql.join(
          bankIds.map((bankId) => sql`${bankId}`),
          sql`, `,
        )})
				ORDER BY created_at DESC
				LIMIT ${limit}
			`);
    } catch {
      return [];
    }

    return (result.rows || []).map((row: any) =>
      this.mapRow(row, req, row.bank_id),
    );
  }

  async export(req: ExportRequest): Promise<MemoryExportBundle> {
    const bankIds = await this.resolveReadBankIds(req.ownerId, req.tenantId);
    let result: any;
    try {
      result = await this.db.execute(sql`
				SELECT
					id, bank_id, text, context, fact_type,
					event_date, occurred_start, occurred_end,
					mentioned_at, tags, access_count, proof_count,
					metadata, created_at, updated_at
				FROM hindsight.memory_units
				WHERE bank_id IN (${sql.join(
          bankIds.map((bankId) => sql`${bankId}`),
          sql`, `,
        )})
				ORDER BY created_at ASC
			`);
    } catch (err) {
      console.warn(
        `[hindsight-adapter] export SQL failed: ${(err as Error)?.message}`,
      );
      result = { rows: [] };
    }

    const records = (result.rows || []).map((row: any) =>
      this.mapRow(row, req, row.bank_id),
    );
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

  async reflect(req: RecallRequest): Promise<RecallResult[]> {
    const bankId = await this.resolveBankId(req.ownerId);
    const quick = req.depth !== "deep";
    const maxTokens =
      req.hindsight?.maxTokens ??
      (quick
        ? QUICK_RECALL_MAX_TOKENS
        : (req.tokenBudget ?? DEEP_RECALL_MAX_TOKENS));
    const body: Record<string, unknown> = {
      query: req.query,
      budget: req.hindsight?.budget ?? (quick ? "low" : "mid"),
      max_tokens: Math.max(1, Math.floor(maxTokens)),
    };
    if (req.hindsight?.trace === true) {
      body.trace = true;
    }

    let data: any;
    try {
      const resp = await fetch(
        `${this.endpoint}/v1/default/banks/${encodeURIComponent(bankId)}/reflect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.warn(
          `[hindsight-adapter] reflect ${resp.status} bank=${bankId} body=${errText.slice(0, 400)}`,
        );
        return [];
      }
      data = await resp.json();
    } catch (err) {
      console.warn(
        `[hindsight-adapter] reflect threw bank=${bankId} message=${(err as Error)?.message}`,
      );
      return [];
    }

    const text = stringField(data?.text) ?? stringField(data?.answer);
    if (!text) return [];

    const referencedIds = Array.isArray(data?.based_on)
      ? data.based_on
          .map((item: any) => stringField(item?.id) ?? stringField(item))
          .filter((id: string | undefined): id is string => Boolean(id))
      : [];
    const idSource = `${bankId}:${req.query}:${text.slice(0, 200)}`;
    const record: ThinkWorkMemoryRecord = {
      id: `hindsight-reflect:${hashString(idSource)}`,
      tenantId: req.tenantId,
      ownerType: req.ownerType,
      ownerId: req.ownerId,
      threadId: req.threadId,
      kind: "reflection",
      sourceType: "system_reflection",
      status: "active",
      content: { text, summary: "Hindsight reflection" },
      backendRefs: [{ backend: "hindsight", ref: bankId }],
      createdAt: new Date().toISOString(),
      metadata: {
        bankId,
        basedOn: referencedIds,
        structuredOutput: data?.structured_output ?? null,
        usage: data?.usage ?? null,
      },
    };
    return [{ record, score: 1, backend: "hindsight" }];
  }

  async update(recordId: string, content: string): Promise<void> {
    await this.db.execute(sql`
			UPDATE hindsight.memory_units
			SET text = ${content}, updated_at = NOW()
			WHERE id = ${recordId}::uuid
		`);
  }

  /**
   * Incremental changed-record read for the compile pipeline. Results are
   * ordered by `(updated_at, id)` ascending so the compiler can advance a
   * durable cursor without missing or double-reading same-timestamp rows.
   *
   * `COALESCE(updated_at, created_at)` handles older memory_units that pre-date
   * the `updated_at` column being set on insert.
   */
  async listRecordsUpdatedSince(
    req: ListRecordsUpdatedSinceRequest,
  ): Promise<ListRecordsUpdatedSinceResult> {
    const bankIds = await this.resolveReadBankIds(req.ownerId, req.tenantId);
    const limit = Math.max(1, Math.min(req.limit, 500));
    const sinceTs = req.sinceUpdatedAt ?? new Date(0);
    const sinceId = req.sinceRecordId ?? "00000000-0000-0000-0000-000000000000";

    let result: any;
    try {
      // JS Date carries millisecond precision; Postgres timestamptz stores
      // microseconds. Truncate the DB side to ms so cursor `>` can't spin on
      // a sub-ms tail that JS can't represent and thus never catches up to.
      result = await this.db.execute(sql`
				SELECT
					id, bank_id, text, context, fact_type,
					event_date, occurred_start, occurred_end,
					mentioned_at, tags, access_count, proof_count,
					metadata, created_at, updated_at,
					date_trunc('milliseconds', COALESCE(updated_at, created_at)) AS cursor_ts
				FROM hindsight.memory_units
				WHERE bank_id IN (${sql.join(
          bankIds.map((bankId) => sql`${bankId}`),
          sql`, `,
        )})
				  AND (
					date_trunc('milliseconds', COALESCE(updated_at, created_at)) > ${sinceTs.toISOString()}::timestamptz
					OR (
						date_trunc('milliseconds', COALESCE(updated_at, created_at)) = ${sinceTs.toISOString()}::timestamptz
						AND id::text > ${sinceId}
					)
				  )
				ORDER BY cursor_ts ASC, id ASC
				LIMIT ${limit}
			`);
    } catch (err) {
      console.warn(
        `[hindsight-adapter] listRecordsUpdatedSince SQL failed: ${(err as Error)?.message}`,
      );
      return { records: [], nextCursor: null };
    }

    const rows: any[] = result.rows || [];
    if (rows.length === 0) {
      return { records: [], nextCursor: null };
    }

    const ownerRef = {
      tenantId: req.tenantId,
      ownerType: "user" as const,
      ownerId: req.ownerId,
    };
    const records = rows.map((row) => this.mapRow(row, ownerRef, row.bank_id));
    const last = rows[rows.length - 1];
    const nextCursor = {
      updatedAt: new Date(last.cursor_ts ?? last.updated_at ?? last.created_at),
      recordId: String(last.id),
    };
    return { records, nextCursor };
  }

  private async resolveReadBankIds(
    ownerId: string,
    tenantId?: string,
  ): Promise<string[]> {
    const primaryBankId = await this.resolveBankId(ownerId);
    const legacyBankIds = await this.resolveLegacyBankIds(ownerId, tenantId);
    return uniqueStrings([primaryBankId, ...legacyBankIds]);
  }

  private async resolveLegacyBankIds(
    ownerId: string,
    tenantId?: string,
  ): Promise<string[]> {
    try {
      const tenantFilter = tenantId ? sql`AND tenant_id = ${tenantId}` : sql``;
      const result = await this.db.execute(sql`
				SELECT id, slug, name
				FROM agents
				WHERE human_pair_id = ${ownerId}
				  AND source = 'user'
				  ${tenantFilter}
			`);
      const rows = (result.rows || []) as Array<{
        id: string;
        slug: string | null;
        name: string | null;
      }>;
      return rows
        .flatMap((row) => [
          row.slug || null,
          row.name ? slugifyLegacyBankName(row.name) : null,
          row.id,
          `user_${row.id}`,
        ])
        .filter((v): v is string => Boolean(v));
    } catch (err) {
      console.warn(
        `[hindsight-adapter] legacy bank lookup failed: ${(err as Error)?.message}`,
      );
      return [];
    }
  }

  private async resolveBankId(ownerId: string): Promise<string> {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(ownerId)) {
      throw new Error(
        "[hindsight-adapter] user-scoped bank requires a UUID userId",
      );
    }
    return `user_${ownerId}`;
  }

  private async postItems(
    bankId: string,
    items: Array<Record<string, unknown>>,
    action: string,
  ): Promise<void> {
    try {
      const resp = await fetch(
        `${this.endpoint}/v1/default/banks/${encodeURIComponent(bankId)}/memories`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(
          `hindsight ${action} ${resp.status}: ${body.slice(0, 300)}`,
        );
      }
    } catch (err) {
      throw new Error(
        `[hindsight-adapter] ${action} failed: ${(err as Error)?.message}`,
      );
    }
  }

  private mapUnit(
    unit: any,
    owner: {
      tenantId: string;
      ownerType: "user" | "agent";
      ownerId: string;
      threadId?: string;
    },
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
      ownerType: owner.ownerType,
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
    owner: {
      tenantId: string;
      ownerType: "user" | "agent";
      ownerId: string;
      threadId?: string;
    },
    bankId: string,
  ): ThinkWorkMemoryRecord {
    let meta: any = {};
    try {
      meta =
        typeof row.metadata === "string"
          ? JSON.parse(row.metadata)
          : row.metadata || {};
    } catch {
      meta = {};
    }
    return this.mapUnit({ ...row, metadata: meta }, owner, bankId);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function slugifyLegacyBankName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function dedupeRecordsById<T>(records: T[], getId: (record: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const record of records) {
    const id = getId(record);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(record);
  }
  return out;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function toISO(value: any): string | null {
  if (!value) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function factTypeToStrategy(
  factType: string | null,
): MemoryStrategy | undefined {
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

const LEGAL_FACT_TYPE_OVERRIDES = new Set([
  "world",
  "experience",
  "opinion",
  "observation",
]);

function resolveFactType(req: RetainRequest): string {
  const override = req.metadata?.fact_type_override;
  if (typeof override === "string" && LEGAL_FACT_TYPE_OVERRIDES.has(override)) {
    return override;
  }
  return sourceTypeToFactType(req.sourceType);
}

function inferSourceType(unit: any): ThinkWorkMemoryRecord["sourceType"] {
  const ctx = (unit.context || "").toString();
  if (ctx === "explicit_memory" || ctx === "explicit_remember")
    return "explicit_remember";
  if (ctx === "thread_turn") return "thread_turn";
  if (ctx === "system_reflection") return "system_reflection";
  if (unit.fact_type === "observation") return "system_reflection";
  return "thread_turn";
}
