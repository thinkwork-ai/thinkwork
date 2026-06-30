/**
 * Hindsight memory adapter.
 *
 * Maps ThinkWork owner refs to Hindsight bank IDs (`user_${userId}` or
 * `space_${spaceId}`) and normalizes Hindsight memory units / recall hits into
 * {@link ThinkWorkMemoryRecord}. Hindsight-native memory-domain fields such as
 * retain timestamps/tags/scopes, recall source facts, and reflect `based_on`
 * evidence are modeled explicitly at the memory boundary and normalized into
 * redacted `metadata.hindsight` details for downstream consumers.
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
  MemoryOwnerRef,
  MemoryExportBundle,
  MemoryStrategy,
  HindsightIncludeOptions,
  HindsightRecordDetail,
  HindsightRetainOptions,
  HindsightSourceFactsIncludeOptions,
  RecallRequest,
  RecallResult,
  RetainRequest,
  RetainResult,
  RetainConversationRequest,
  RetainDailyMemoryRequest,
  RetainTurnRequest,
  TenantInspectRequest,
  ThinkWorkMemoryRecord,
  UpsertMarkdownMemoryDocumentRequest,
} from "../types.js";

export type HindsightAdapterOptions = {
  endpoint: string;
  timeoutMs?: number;
  inspectLimit?: number;
  /**
   * Desired per-bank config overrides (observation mission, consolidation
   * settings) applied lazily before writes. `undefined` resolves from env via
   * {@link resolveBankConfigFromEnv}; `null` disables bank configuration.
   */
  bankConfig?: Record<string, unknown> | null;
};

export class HindsightRetainError extends Error {
  readonly action: string;
  readonly statusCode?: number;
  readonly retryable: boolean;

  constructor(input: {
    action: string;
    message: string;
    statusCode?: number;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(`[hindsight-adapter] ${input.action} failed: ${input.message}`);
    this.name = "HindsightRetainError";
    this.action = input.action;
    this.statusCode = input.statusCode;
    this.retryable =
      input.retryable ?? (!input.statusCode || input.statusCode >= 500);
    if (input.cause !== undefined) {
      this.cause = input.cause;
    }
  }
}

/**
 * Per-bank Hindsight config overrides from the handler environment. Returns
 * null when no override is set — banks then inherit the service-level
 * `HINDSIGHT_API_*` defaults set on the Hindsight ECS task, and the ensure
 * path is a no-op. Read lazily (never at module load) so Lambda env injected
 * after cold start is observed.
 */
export function resolveBankConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> | null {
  const config: Record<string, unknown> = {};
  const mission = env.HINDSIGHT_BANK_OBSERVATIONS_MISSION?.trim();
  if (mission) config.observations_mission = mission;
  const enableObservations = parseEnvBool(
    env.HINDSIGHT_BANK_ENABLE_OBSERVATIONS,
  );
  if (enableObservations !== undefined) {
    config.enable_observations = enableObservations;
  }
  const enableAutoConsolidation = parseEnvBool(
    env.HINDSIGHT_BANK_ENABLE_AUTO_CONSOLIDATION,
  );
  if (enableAutoConsolidation !== undefined) {
    config.enable_auto_consolidation = enableAutoConsolidation;
  }
  return Object.keys(config).length > 0 ? config : null;
}

function parseEnvBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === "") return undefined;
  const v = raw.toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return undefined;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_INSPECT_LIMIT = 500;
const BANK_CONFIG_FAILURE_COOLDOWN_MS = 60_000;
const HINDSIGHT_FACT_TYPES = ["world", "experience", "observation"] as const;
const QUICK_RECALL_MAX_TOKENS = 500;
const DEEP_RECALL_MAX_TOKENS = 2_000;

const HINDSIGHT_CAPABILITIES: MemoryCapabilities = {
  retain: true,
  recall: true,
  spaceMemory: true,
  inspectRecords: true,
  inspectGraph: true,
  export: true,
  reflect: true,
  compact: false,
  forget: true,
};

type HindsightBankOwner = Pick<MemoryOwnerRef, "ownerType" | "ownerId">;
type HindsightReadOwner = Pick<
  MemoryOwnerRef,
  "tenantId" | "ownerType" | "ownerId"
>;

export class HindsightAdapter implements MemoryAdapter {
  readonly kind = "hindsight" as const;

  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly inspectLimit: number;
  private readonly bankConfig: Record<string, unknown> | null;
  /** Banks confirmed configured this container lifetime — skips the GET. */
  private readonly configuredBanks = new Set<string>();
  /** Per-bank in-flight ensure, so concurrent writes share one GET/PUT. */
  private readonly bankConfigInFlight = new Map<string, Promise<void>>();
  /** Per-bank last-failure timestamp for the ensure cooldown. */
  private readonly bankConfigFailures = new Map<string, number>();
  private readonly db = getDb();

  constructor(opts: HindsightAdapterOptions) {
    if (!opts.endpoint) {
      throw new Error("HindsightAdapter requires an endpoint");
    }
    this.endpoint = opts.endpoint.replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.inspectLimit = opts.inspectLimit ?? DEFAULT_INSPECT_LIMIT;
    this.bankConfig =
      opts.bankConfig !== undefined
        ? opts.bankConfig
        : resolveBankConfigFromEnv();
  }

  async capabilities(): Promise<MemoryCapabilities> {
    return HINDSIGHT_CAPABILITIES;
  }

  async recall(req: RecallRequest): Promise<RecallResult[]> {
    const bankIds = await this.resolveRecallBankIds(req);
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
    applyHindsightQueryOptions(body, req);
    const include = buildRecallInclude(req.hindsight?.include, {
      disableEntities: req.hindsight?.includeEntities === false || quick,
    });
    if (include) body.include = include;
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
        const recallDetail = buildRecallDetail(data);
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
            record: this.mapUnit(m, req, bankId, recallDetail),
            score,
            whyRecalled: m.why || undefined,
            backend: "hindsight",
          };
        });
      }),
    );
    // Score descending; at equal score consolidated observations rank ahead
    // of raw facts (they are deduplicated, evidence-weighted beliefs).
    return dedupeRecordsById(batches.flat(), (r) => r.record.id)
      .sort(
        (a, b) => b.score - a.score || observationRank(a) - observationRank(b),
      )
      .slice(0, limit);
  }

  /**
   * Trigger Hindsight consolidation for the owner's bank. An empty body
   * processes all unconsolidated memories — the backfill path for banks whose
   * corpus predates the observation mission. Throws on failure so callers
   * (ops scripts) can surface per-bank errors.
   */
  async consolidateBank(ownerId: string): Promise<void> {
    const bankId = await this.resolveBankId({
      ownerType: "user",
      ownerId,
    });
    await this.consolidateBankById(bankId);
  }

  /** Raw-bank-id variant for ops scripts sweeping legacy banks. */
  async consolidateBankById(bankId: string): Promise<void> {
    try {
      const resp = await fetch(
        `${this.endpoint}/v1/default/banks/${encodeURIComponent(bankId)}/consolidate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(
          `hindsight consolidate ${resp.status}: ${body.slice(0, 300)}`,
        );
      }
    } catch (err) {
      throw new Error(
        `[hindsight-adapter] consolidate failed bank=${bankId.slice(0, 18)}: ${(err as Error)?.message}`,
      );
    }
  }

  async retain(req: RetainRequest): Promise<RetainResult> {
    const bankId = await this.resolveBankId(req);
    await this.ensureBankConfiguredById(bankId);
    const factType = resolveFactType(req);
    const ignoredFactTypeOverride = resolveIgnoredFactTypeOverride(req);

    const {
      fact_type_override: _omitOverride,
      hindsight_async: retainAsync,
      tags: callerTags,
      ...callerMetadata
    } = (req.metadata || {}) as Record<string, unknown>;
    const item: Record<string, unknown> = {
      content: req.content,
      context: req.sourceType,
    };
    applyHindsightRetainOptions(item, req.hindsight);
    const mergedMetadata = toHindsightMetadata({
      ...callerMetadata,
      ...ownerMetadata(req),
      fact_type: factType,
      ...(ignoredFactTypeOverride
        ? { ignored_fact_type_override: ignoredFactTypeOverride }
        : {}),
    });
    if (req.role) mergedMetadata.role = req.role;
    item.metadata = mergedMetadata;
    const tags = uniqueStrings([
      ...toHindsightTags(callerTags),
      ...toHindsightTags(req.hindsight?.tags),
    ]);
    if (tags.length > 0) item.tags = tags;
    const documentTags = toHindsightTags(req.hindsight?.documentTags);

    let data: any = null;
    try {
      const resp = await fetch(
        `${this.endpoint}/v1/default/banks/${encodeURIComponent(bankId)}/memories`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [item],
            ...(documentTags.length > 0 ? { document_tags: documentTags } : {}),
            ...(retainAsync === true || retainAsync === "true"
              ? { async: true }
              : {}),
          }),
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
    const bankId = await this.resolveBankId(req);
    await this.ensureBankConfiguredById(bankId);
    const items = req.messages
      .filter((m) => m.content && m.content.trim().length > 0)
      .map((m) => ({
        content: m.content,
        context: "thread_turn",
        metadata: toHindsightMetadata({
          ...(req.metadata || {}),
          ...ownerMetadata(req),
          role: m.role,
          thread_id: req.threadId,
        }),
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
    const bankId = await this.resolveBankId(req);
    const lines = req.messages
      .filter((m) => m.content && m.content.trim().length > 0)
      .map(
        (m) =>
          `${m.role} (${new Date(m.timestamp).toISOString()}): ${m.content.trim()}`,
      );
    if (lines.length === 0) return;

    const content = lines.join("\n");
    const item: Record<string, unknown> = {
      content,
      document_id: req.threadId,
      update_mode: "replace",
      context: "thinkwork_thread",
      metadata: toHindsightMetadata({
        ...(req.metadata || {}),
        tenantId: req.tenantId,
        userId: req.ownerId,
        threadId: req.threadId,
        turnCount: lines.length,
        source: "thinkwork",
      }),
    };
    applyHindsightRetainOptions(item, req.hindsight);
    await this.postItems(bankId, [item], "retainConversation", {
      documentTags: req.hindsight?.documentTags,
    });
    console.log(
      `[hindsight-adapter] retainConversation ok bank=${bankId.slice(0, 18)} thread=${req.threadId.slice(0, 12)} turns=${lines.length} bytes=${content.length}`,
    );
  }

  async retainDailyMemory(req: RetainDailyMemoryRequest): Promise<void> {
    const content = req.content.trim();
    if (!content) return;

    const bankId = await this.resolveBankId(req);
    const item: Record<string, unknown> = {
      content,
      document_id: `workspace_daily:${req.ownerId}:${req.date}`,
      update_mode: "replace",
      context: "thinkwork_workspace_daily",
      metadata: toHindsightMetadata({
        ...(req.metadata || {}),
        tenantId: req.tenantId,
        userId: req.ownerId,
        date: req.date,
        source: "thinkwork",
      }),
    };
    applyHindsightRetainOptions(item, req.hindsight);
    await this.postItems(bankId, [item], "retainDailyMemory", {
      documentTags: req.hindsight?.documentTags,
    });
    console.log(
      `[hindsight-adapter] retainDailyMemory ok bank=${bankId.slice(0, 18)} date=${req.date} bytes=${content.length}`,
    );
  }

  async upsertMarkdownMemoryDocument(
    req: UpsertMarkdownMemoryDocumentRequest,
  ): Promise<void> {
    const content = req.content.trim();
    if (!content) return;

    const bankId = await this.resolveBankId(req);
    const item: Record<string, unknown> = {
      content,
      document_id: req.documentId,
      update_mode: "replace",
      context: req.context,
      metadata: toHindsightMetadata({
        ...(req.metadata || {}),
        ...ownerMetadata(req),
        path: req.path,
        source:
          stringField((req.metadata || {}).source) ??
          defaultMarkdownDocumentSource(req.context),
      }),
    };
    applyHindsightRetainOptions(item, req.hindsight);
    await this.postItems(bankId, [item], "upsertMarkdownMemoryDocument", {
      async: req.async !== false,
      documentTags: req.hindsight?.documentTags,
    });
    console.log(
      `[hindsight-adapter] upsertMarkdownMemoryDocument ok bank=${bankId.slice(0, 18)} document=${req.documentId.slice(0, 64)} bytes=${content.length}`,
    );
  }

  async inspect(req: InspectRequest): Promise<ThinkWorkMemoryRecord[]> {
    const bankIds = await this.resolveReadBankIds(req);
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

  async inspectTenant(
    req: TenantInspectRequest,
  ): Promise<ThinkWorkMemoryRecord[]> {
    const limit = Math.min(req.limit ?? this.inspectLimit, this.inspectLimit);
    const query = req.query?.trim();
    const searchPattern = query ? `%${escapeLikePattern(query)}%` : null;

    let result: any;
    try {
      result = await this.db.execute(sql`
        WITH tenant_banks AS (
          SELECT DISTINCT
            ('user_' || principal_id::text) AS bank_id,
            'user'::text AS owner_type,
            principal_id::text AS owner_id
          FROM tenant_members
          WHERE tenant_id = ${req.tenantId}
            AND lower(principal_type) = 'user'
            AND status = 'active'
          UNION
          SELECT DISTINCT
            ('space_' || id::text) AS bank_id,
            'space'::text AS owner_type,
            id::text AS owner_id
          FROM spaces
          WHERE tenant_id = ${req.tenantId}
          UNION
          SELECT DISTINCT
            id::text AS bank_id,
            'agent'::text AS owner_type,
            id::text AS owner_id
          FROM agents
          WHERE tenant_id = ${req.tenantId}
          UNION
          SELECT DISTINCT
            slug::text AS bank_id,
            'agent'::text AS owner_type,
            id::text AS owner_id
          FROM agents
          WHERE tenant_id = ${req.tenantId}
            AND slug IS NOT NULL
            AND slug <> ''
        )
        SELECT
          m.id, m.bank_id, m.text, m.context, m.fact_type,
          m.event_date, m.occurred_start, m.occurred_end,
          m.mentioned_at, m.tags, m.access_count, m.proof_count,
          m.metadata, m.created_at, m.updated_at,
          COALESCE(
            m.metadata->>'ownerType',
            b.owner_type,
            CASE
              WHEN m.bank_id LIKE 'space_%' THEN 'space'
              WHEN m.bank_id LIKE 'user_%' THEN 'user'
              ELSE 'agent'
            END
          ) AS inferred_owner_type,
          CASE COALESCE(
            m.metadata->>'ownerType',
            b.owner_type,
            CASE
              WHEN m.bank_id LIKE 'space_%' THEN 'space'
              WHEN m.bank_id LIKE 'user_%' THEN 'user'
              ELSE 'agent'
            END
          )
            WHEN 'space' THEN COALESCE(m.metadata->>'spaceId', b.owner_id)
            WHEN 'agent' THEN COALESCE(m.metadata->>'agentId', b.owner_id)
            ELSE COALESCE(m.metadata->>'userId', b.owner_id)
          END AS inferred_owner_id
        FROM hindsight.memory_units m
        LEFT JOIN tenant_banks b ON b.bank_id = m.bank_id
        WHERE (m.metadata->>'tenantId' = ${req.tenantId} OR b.bank_id IS NOT NULL)
          ${
            searchPattern
              ? sql`AND (
                  m.text ILIKE ${searchPattern} ESCAPE '\\'
                  OR m.bank_id ILIKE ${searchPattern} ESCAPE '\\'
                  OR COALESCE(m.context, '') ILIKE ${searchPattern} ESCAPE '\\'
                  OR COALESCE(m.fact_type, '') ILIKE ${searchPattern} ESCAPE '\\'
                )`
              : sql``
          }
        ORDER BY COALESCE(m.updated_at, m.created_at) DESC, m.created_at DESC
        LIMIT ${limit}
      `);
    } catch (err) {
      console.warn(
        `[hindsight-adapter] inspectTenant SQL failed: ${(err as Error)?.message}`,
      );
      return [];
    }

    return (result.rows || []).map((row: any) =>
      this.mapOperatorRow(row, req.tenantId),
    );
  }

  async export(req: ExportRequest): Promise<MemoryExportBundle> {
    const bankIds = await this.resolveReadBankIds(req);
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
    const bankId = await this.resolveBankId(req);
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
    applyHindsightQueryOptions(body, req);
    if (req.hindsight?.responseSchema) {
      body.response_schema = req.hindsight.responseSchema;
    }
    const include = buildReflectInclude(req.hindsight?.include);
    if (include) body.include = include;
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

    const basedOnEvidence = buildBasedOnEvidence(data?.based_on);
    const referencedIds = basedOnEvidence.memoryIds;
    const idSource = `${bankId}:${req.query}:${text.slice(0, 200)}`;
    const hindsightDetail = omitEmptyHindsightDetail({
      evidence:
        basedOnEvidence.memoryIds.length > 0 ||
        basedOnEvidence.mentalModelIds.length > 0 ||
        basedOnEvidence.directiveIds.length > 0
          ? { basedOn: basedOnEvidence }
          : undefined,
      trace: data?.trace ?? null,
      usage: data?.usage ?? null,
    });
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
        ...(hindsightDetail ? { hindsight: hindsightDetail } : {}),
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
    const ownerType = req.ownerType ?? "user";
    const owner = { ...req, ownerType };
    const bankIds = await this.resolveReadBankIds(owner);
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
      ownerType,
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
    owner: HindsightReadOwner,
  ): Promise<string[]> {
    const primaryBankId = await this.resolveBankId(owner);
    const legacyBankIds =
      owner.ownerType === "user"
        ? await this.resolveLegacyBankIds(owner.ownerId, owner.tenantId)
        : [];
    return uniqueStrings(
      [primaryBankId, ...legacyBankIds].filter((value): value is string =>
        Boolean(value),
      ),
    );
  }

  private async resolveRecallBankIds(req: RecallRequest): Promise<string[]> {
    if (req.hindsight?.includeLegacyBanks === true) {
      return this.resolveReadBankIds(req);
    }
    const primaryBankId = await this.resolveBankId(req);
    return [primaryBankId];
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

  private async resolveBankId(owner: HindsightBankOwner): Promise<string> {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ownerId = owner.ownerId;
    if (!uuidRe.test(ownerId)) {
      throw new Error(
        `[hindsight-adapter] ${owner.ownerType}-scoped bank requires a UUID ${owner.ownerType}Id`,
      );
    }
    if (owner.ownerType === "space") {
      return `space_${ownerId}`;
    }
    return `user_${ownerId}`;
  }

  /**
   * Idempotently apply the desired per-bank config overrides. No-op when no
   * overrides are configured (service-level env defaults apply) or the bank
   * was already confirmed this container lifetime. Never throws — config
   * failures log and the triggering write proceeds unconfigured.
   */
  async ensureBankConfigured(ownerId: string): Promise<void> {
    let bankId: string;
    try {
      bankId = await this.resolveBankId({ ownerType: "user", ownerId });
    } catch (err) {
      // The interface contract is never-throws — a non-UUID owner logs and
      // returns rather than failing the caller.
      console.warn(
        `[hindsight-adapter] ensureBankConfigured skipped: ${(err as Error)?.message}`,
      );
      return;
    }
    await this.ensureBankConfiguredById(bankId);
  }

  private async ensureBankConfiguredById(bankId: string): Promise<void> {
    const desired = this.bankConfig;
    if (!desired || Object.keys(desired).length === 0) return;
    if (this.configuredBanks.has(bankId)) return;
    // Failure cooldown: while the config endpoint is degraded, don't tax every
    // write with a fresh GET that can hang up to timeoutMs.
    const failedAt = this.bankConfigFailures.get(bankId);
    if (
      failedAt !== undefined &&
      Date.now() - failedAt < BANK_CONFIG_FAILURE_COOLDOWN_MS
    ) {
      return;
    }
    // In-flight dedup: concurrent writes in one container share one ensure.
    const inFlight = this.bankConfigInFlight.get(bankId);
    if (inFlight) return inFlight;

    const run = this.applyBankConfig(bankId, desired).finally(() => {
      this.bankConfigInFlight.delete(bankId);
    });
    this.bankConfigInFlight.set(bankId, run);
    return run;
  }

  private async applyBankConfig(
    bankId: string,
    desired: Record<string, unknown>,
  ): Promise<void> {
    const configUrl = `${this.endpoint}/v1/default/banks/${encodeURIComponent(bankId)}/config`;
    try {
      const getResp = await fetch(configUrl, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!getResp.ok) {
        throw new Error(`config GET ${getResp.status}`);
      }
      const data: any = await getResp.json().catch(() => ({}));
      const overrides = (data?.overrides ?? {}) as Record<string, unknown>;
      const effective = (data?.config ?? {}) as Record<string, unknown>;
      // String-coerced comparison: the server may echo booleans/numbers as
      // strings; strict equality would report perpetual drift and re-PUT on
      // every cold start.
      const drifted = Object.entries(desired).some(([key, value]) => {
        const current =
          overrides[key] !== undefined ? overrides[key] : effective[key];
        return current === undefined || String(current) !== String(value);
      });
      if (drifted) {
        const putResp = await fetch(configUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(desired),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!putResp.ok) {
          const body = await putResp.text().catch(() => "");
          throw new Error(
            `config PUT ${putResp.status}: ${body.slice(0, 200)}`,
          );
        }
        console.log(
          `[hindsight-adapter] bank config applied bank=${bankId.slice(0, 18)} keys=${Object.keys(desired).join(",")}`,
        );
      }
      this.configuredBanks.add(bankId);
      this.bankConfigFailures.delete(bankId);
    } catch (err) {
      this.bankConfigFailures.set(bankId, Date.now());
      console.warn(
        `[hindsight-adapter] ensureBankConfigured failed (write proceeds) bank=${bankId.slice(0, 18)} message=${(err as Error)?.message}`,
      );
    }
  }

  private async postItems(
    bankId: string,
    items: Array<Record<string, unknown>>,
    action: string,
    opts: { async?: boolean; documentTags?: string[] } = {},
  ): Promise<void> {
    await this.ensureBankConfiguredById(bankId);
    const documentTags = toHindsightTags(opts.documentTags);
    try {
      const resp = await fetch(
        `${this.endpoint}/v1/default/banks/${encodeURIComponent(bankId)}/memories`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items,
            ...(documentTags.length > 0 ? { document_tags: documentTags } : {}),
            ...(opts.async ? { async: true } : {}),
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new HindsightRetainError({
          action,
          statusCode: resp.status,
          retryable: resp.status >= 500,
          message: `hindsight ${action} ${resp.status}: ${body.slice(0, 300)}`,
        });
      }
    } catch (err) {
      if (err instanceof HindsightRetainError) {
        throw err;
      }
      const message = (err as Error)?.message || String(err);
      throw new HindsightRetainError({
        action,
        retryable: true,
        message,
        cause: err,
      });
    }
  }

  private mapUnit(
    unit: any,
    owner: {
      tenantId: string;
      ownerType: ThinkWorkMemoryRecord["ownerType"];
      ownerId: string;
      threadId?: string;
    },
    bankId: string,
    detail?: HindsightRecordDetail | null,
  ): ThinkWorkMemoryRecord {
    const createdAt = toISO(unit.created_at) || new Date().toISOString();
    const updatedAt = toISO(unit.updated_at) || undefined;
    const metaFactType =
      unit.metadata && typeof unit.metadata === "object"
        ? (unit.metadata as Record<string, unknown>).fact_type
        : undefined;
    // SQL rows carry `fact_type`; the deployed recall HTTP response carries
    // `type` instead (verified empirically on dev, Hindsight 0.5.0).
    const factType: string | null =
      (unit.fact_type as string | null | undefined) ||
      (typeof unit.type === "string" ? unit.type : null) ||
      (typeof metaFactType === "string" ? metaFactType : null) ||
      null;
    const sourceFactIds = toStringArray(unit.source_fact_ids);
    const sourceFacts = resolveSourceFacts(sourceFactIds, detail);
    const unitDetail = omitEmptyHindsightDetail({
      evidence:
        sourceFactIds.length > 0 || sourceFacts.length > 0
          ? {
              ...(sourceFactIds.length > 0 ? { sourceFactIds } : {}),
              ...(sourceFacts.length > 0 ? { sourceFacts } : {}),
            }
          : undefined,
      trace: detail?.trace ?? null,
    });
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
        // Observation freshness trend. NOT exposed by the deployed 0.5.0
        // recall response (verified empirically on dev) — parsed defensively
        // for forward-compat with image bumps; null until then.
        freshness:
          stringField(unit.freshness) ??
          stringField(unit.trend) ??
          stringField(unit.metadata?.freshness) ??
          stringField(unit.metadata?.trend) ??
          null,
        tags: unit.tags || null,
        confidence: unit.confidence ?? unit.metadata?.confidence ?? null,
        eventDate: toISO(unit.event_date),
        occurredStart: toISO(unit.occurred_start),
        occurredEnd: toISO(unit.occurred_end),
        mentionedAt: toISO(unit.mentioned_at),
        accessCount: unit.access_count ?? null,
        // SQL rows carry proof_count; recall HTTP responses carry the proof
        // set itself as `source_fact_ids` (verified empirically on dev).
        proofCount:
          coerceCount(unit.proof_count) ??
          coerceCount(unit.evidence_count) ??
          coerceCount(unit.metadata?.proof_count) ??
          (Array.isArray(unit.source_fact_ids)
            ? unit.source_fact_ids.length
            : null) ??
          null,
        context: unit.context ?? null,
        raw: unit.metadata ?? null,
        ...(unitDetail ? { hindsight: unitDetail } : {}),
      },
    };
  }

  private mapRow(
    row: any,
    owner: {
      tenantId: string;
      ownerType: ThinkWorkMemoryRecord["ownerType"];
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

  private mapOperatorRow(row: any, tenantId: string): ThinkWorkMemoryRecord {
    let meta: any = {};
    try {
      meta =
        typeof row.metadata === "string"
          ? JSON.parse(row.metadata)
          : row.metadata || {};
    } catch {
      meta = {};
    }
    const bankId = String(row.bank_id || "");
    const ownerType = inferOwnerType(row.inferred_owner_type, bankId);
    const ownerId =
      inferOwnerIdFromBank(bankId, ownerType) ||
      stringField(row.inferred_owner_id) ||
      bankId;

    return this.mapUnit(
      { ...row, metadata: meta },
      { tenantId, ownerType, ownerId },
      bankId,
    );
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function ownerMetadata(owner: MemoryOwnerRef): Record<string, unknown> {
  const base = {
    tenantId: owner.tenantId,
    ownerType: owner.ownerType,
  };
  if (owner.ownerType === "space") {
    return { ...base, spaceId: owner.ownerId };
  }
  if (owner.ownerType === "agent") {
    return { ...base, agentId: owner.ownerId };
  }
  return { ...base, userId: owner.ownerId };
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

function defaultMarkdownDocumentSource(context: string): string {
  if (context === "thinkwork_requester_memory") {
    return "requester_memory_markdown";
  }
  if (context === "thinkwork_requester_thread_digest") {
    return "requester_thread_digest";
  }
  if (context === "thinkwork_high_confidence_fact") {
    return "high_confidence_fact";
  }
  if (context === "thinkwork_space_document") {
    return "space_memory_document";
  }
  return "thinkwork_memory_document";
}

function observationRank(result: RecallResult): number {
  return result.record.metadata?.factType === "observation" ? 0 : 1;
}

function applyHindsightQueryOptions(
  body: Record<string, unknown>,
  req: RecallRequest,
): void {
  if (req.hindsight?.queryTimestamp) {
    body.query_timestamp = req.hindsight.queryTimestamp;
  }
  const tags = toHindsightTags(req.hindsight?.tags);
  if (tags.length > 0) {
    body.tags = tags;
  }
  if (req.hindsight?.tagsMatch) {
    body.tags_match = req.hindsight.tagsMatch;
  }
  if (
    Array.isArray(req.hindsight?.tagGroups) &&
    req.hindsight.tagGroups.length > 0
  ) {
    body.tag_groups = req.hindsight.tagGroups;
  }
}

function buildRecallInclude(
  include: HindsightIncludeOptions | undefined,
  opts: { disableEntities: boolean },
): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  const entities = include?.entities;
  if (entities === false || entities === null || opts.disableEntities) {
    body.entities = null;
  } else if (isRecord(entities)) {
    body.entities = mapMaxTokens(entities);
  }
  const chunks = include?.chunks;
  if (chunks === true) {
    body.chunks = {};
  } else if (chunks === false || chunks === null) {
    body.chunks = null;
  } else if (isRecord(chunks)) {
    body.chunks = mapMaxTokens(chunks);
  }
  const sourceFacts = include?.sourceFacts;
  if (sourceFacts === true) {
    body.source_facts = {};
  } else if (sourceFacts === false || sourceFacts === null) {
    body.source_facts = null;
  } else if (isRecord(sourceFacts)) {
    body.source_facts = mapSourceFactsInclude(sourceFacts);
  }
  return Object.keys(body).length > 0 ? body : null;
}

function buildReflectInclude(
  include: HindsightIncludeOptions | undefined,
): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  if (include?.facts === true) {
    body.facts = {};
  } else if (include?.facts === false || include?.facts === null) {
    body.facts = null;
  }
  const toolCalls = include?.toolCalls;
  if (toolCalls === true) {
    body.tool_calls = {};
  } else if (toolCalls === false || toolCalls === null) {
    body.tool_calls = null;
  } else if (isRecord(toolCalls)) {
    body.tool_calls = {
      ...(typeof toolCalls.output === "boolean"
        ? { output: toolCalls.output }
        : {}),
    };
  }
  return Object.keys(body).length > 0 ? body : null;
}

function mapMaxTokens(input: { maxTokens?: number }): Record<string, unknown> {
  return typeof input.maxTokens === "number"
    ? { max_tokens: input.maxTokens }
    : {};
}

function mapSourceFactsInclude(
  input: HindsightSourceFactsIncludeOptions,
): Record<string, unknown> {
  return {
    ...(typeof input.maxTokens === "number"
      ? { max_tokens: input.maxTokens }
      : {}),
    ...(typeof input.maxTokensPerObservation === "number"
      ? { max_tokens_per_observation: input.maxTokensPerObservation }
      : {}),
  };
}

function applyHindsightRetainOptions(
  item: Record<string, unknown>,
  opts: HindsightRetainOptions | undefined,
): void {
  if (!opts) return;
  if (opts.timestamp !== undefined) {
    item.timestamp = opts.timestamp;
  }
  const tags = toHindsightTags(opts.tags);
  if (tags.length > 0) {
    item.tags = tags;
  }
  if (opts.observationScopes !== undefined) {
    item.observation_scopes = opts.observationScopes;
  }
}

function buildRecallDetail(data: any): HindsightRecordDetail | null {
  const sourceFactsById = parseSourceFacts(data?.source_facts);
  return omitEmptyHindsightDetail({
    evidence:
      sourceFactsById.size > 0
        ? {
            sourceFacts: [...sourceFactsById.values()],
          }
        : undefined,
    trace: data?.trace ?? null,
  });
}

function resolveSourceFacts(
  sourceFactIds: string[],
  detail: HindsightRecordDetail | null | undefined,
): NonNullable<NonNullable<HindsightRecordDetail["evidence"]>["sourceFacts"]> {
  const sourceFacts = detail?.evidence?.sourceFacts ?? [];
  if (sourceFactIds.length === 0) return [];
  const byId = new Map(sourceFacts.map((fact) => [fact.id, fact]));
  return sourceFactIds
    .map((id) => byId.get(id))
    .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact));
}

function parseSourceFacts(value: unknown): Map<string, RedactedHindsightFact> {
  const facts = new Map<string, RedactedHindsightFact>();
  if (!isRecord(value)) return facts;
  for (const [id, raw] of Object.entries(value)) {
    const descriptor = toRedactedHindsightFact(raw, id);
    if (descriptor) facts.set(descriptor.id, descriptor);
  }
  return facts;
}

type RedactedHindsightFact = NonNullable<
  NonNullable<HindsightRecordDetail["evidence"]>["sourceFacts"]
>[number];

function toRedactedHindsightFact(
  raw: unknown,
  fallbackId?: string,
): RedactedHindsightFact | null {
  if (!isRecord(raw)) {
    return fallbackId ? { id: fallbackId } : null;
  }
  const id = stringField(raw.id) ?? fallbackId;
  if (!id) return null;
  const metadata = redactHindsightMetadata(raw.metadata);
  return {
    id,
    type: stringField(raw.type) ?? stringField(raw.fact_type) ?? null,
    context: stringField(raw.context) ?? null,
    documentId: stringField(raw.document_id) ?? null,
    chunkId: stringField(raw.chunk_id) ?? null,
    tags: toStringArray(raw.tags),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function buildBasedOnEvidence(
  value: unknown,
): NonNullable<NonNullable<HindsightRecordDetail["evidence"]>["basedOn"]> {
  const memories = isRecord(value)
    ? toRedactedFactList(value.memories)
    : toRedactedFactList(value);
  const mentalModels = isRecord(value)
    ? toRedactedFactList(value.mental_models)
    : [];
  const directives = isRecord(value)
    ? toRedactedFactList(value.directives)
    : [];
  return {
    memoryIds: memories.map((fact) => fact.id),
    mentalModelIds: mentalModels.map((fact) => fact.id),
    directiveIds: directives.map((fact) => fact.id),
    ...(memories.length > 0 ? { memories } : {}),
    ...(mentalModels.length > 0 ? { mentalModels } : {}),
    ...(directives.length > 0 ? { directives } : {}),
  };
}

function toRedactedFactList(value: unknown): RedactedHindsightFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toRedactedHindsightFact(item, stringField(item)))
    .filter((item): item is RedactedHindsightFact => Boolean(item));
}

function redactHindsightMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const allowed = new Set([
    "tenantId",
    "ownerType",
    "userId",
    "spaceId",
    "agentId",
    "threadId",
    "source",
    "path",
    "date",
    "capture_source",
    "captured_at",
    "captured_by_user_id",
    "client_capture_id",
    "document_id",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      out[key] = raw;
    }
  }
  return out;
}

function omitEmptyHindsightDetail(
  detail: HindsightRecordDetail,
): HindsightRecordDetail | null {
  const out: HindsightRecordDetail = {};
  if (detail.evidence && Object.keys(detail.evidence).length > 0) {
    out.evidence = detail.evidence;
  }
  if (detail.trace !== undefined && detail.trace !== null) {
    out.trace = detail.trace;
  }
  if (detail.usage !== undefined && detail.usage !== null) {
    out.usage = detail.usage;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Numeric count tolerating pg-driver strings ("5") alongside numbers. */
function coerceCount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function inferOwnerType(
  value: unknown,
  bankId: string,
): ThinkWorkMemoryRecord["ownerType"] {
  if (value === "user" || value === "agent" || value === "space") {
    return value;
  }
  if (bankId.startsWith("space_")) return "space";
  return "user";
}

function inferOwnerIdFromBank(
  bankId: string,
  ownerType: ThinkWorkMemoryRecord["ownerType"],
): string | undefined {
  if (ownerType === "space" && bankId.startsWith("space_")) {
    return bankId.slice("space_".length);
  }
  if (ownerType === "user" && bankId.startsWith("user_")) {
    return bankId.slice("user_".length);
  }
  return undefined;
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

function resolveIgnoredFactTypeOverride(
  req: RetainRequest,
): string | undefined {
  const override = req.metadata?.fact_type_override;
  if (typeof override !== "string") return undefined;
  return LEGAL_FACT_TYPE_OVERRIDES.has(override) ? undefined : override;
}

function toHindsightMetadata(
  metadata: Record<string, unknown>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      normalized[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      normalized[key] = String(value);
    } else {
      normalized[key] = JSON.stringify(value);
    }
  }
  return normalized;
}

function toHindsightTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function inferSourceType(unit: any): ThinkWorkMemoryRecord["sourceType"] {
  const ctx = (unit.context || "").toString();
  if (ctx === "explicit_memory" || ctx === "explicit_remember")
    return "explicit_remember";
  if (ctx === "thread_turn") return "thread_turn";
  if (ctx === "system_reflection") return "system_reflection";
  // SQL rows carry fact_type; recall HTTP responses carry `type`.
  if (unit.fact_type === "observation" || unit.type === "observation")
    return "system_reflection";
  return "thread_turn";
}
