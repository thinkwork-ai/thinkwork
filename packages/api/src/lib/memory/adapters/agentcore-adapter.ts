/**
 * AgentCore Memory adapter.
 *
 * Maps ThinkWork owner refs to AgentCore namespaces keyed on the user
 * UUID (which the agent container sets as `actorId` via `USER_ID`, and
 * which `memory-retain` passes as `ownerId` for `ownerType: "user"`)
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
  RetainTurnRequest,
  ThinkWorkMemoryRecord,
} from "../types.js";

export type AgentCoreAdapterOptions = {
  memoryId: string;
  region?: string;
  perNamespaceLimit?: number;
};

const DEFAULT_PER_NAMESPACE_LIMIT = 50;

/**
 * Actor-scoped namespaces that default recall/inspect fans out over.
 *
 * These MUST match the strategy namespace templates provisioned by
 * `terraform/modules/app/agentcore-memory/scripts/create_or_find_memory.sh`:
 *
 *   semantic     -> assistant_{actorId}
 *   preferences  -> preferences_{actorId}
 *   summaries    -> session_{sessionId}            (session-scoped, not here)
 *   episodes     -> episodes_{actorId}/{sessionId} (session-scoped, not here)
 *                   + reflections under episodes_{actorId}/
 *
 * `user_{actorId}` is not an extraction namespace: it's where the
 * `remember` tool and this adapter's own `retain()` write direct records
 * via BatchCreateMemoryRecords. It's read here so operator-visible memory
 * includes explicitly-remembered facts alongside extracted ones.
 *
 * Session-scoped namespaces stay OUT of the default fan-out (they're
 * per-thread and would swamp cross-thread recall); {@link
 * AgentCoreAdapter.listEpisodicRecords} exposes them for the UI.
 */
const ACTOR_NAMESPACES: Array<{
  prefix: (actorId: string) => string;
  strategy: MemoryStrategy;
}> = [
  { prefix: (actorId) => `assistant_${actorId}`, strategy: "semantic" },
  { prefix: (actorId) => `preferences_${actorId}`, strategy: "preferences" },
  { prefix: (actorId) => `user_${actorId}`, strategy: "semantic" },
];

/**
 * Derive the ThinkWork strategy label from the namespace a record was
 * actually filed under, rather than the namespace we happened to query.
 * A record can carry several namespaces; callers pass the first one.
 *
 * Reflection records land under the episodic strategy's
 * `reflectionConfiguration` namespace (`episodes_{actorId}/`), which has no
 * session segment — that absence is the only signal distinguishing them
 * from per-session episodes (`episodes_{actorId}/{sessionId}`).
 */
export function strategyForNamespace(
  namespace: string,
  fallback: MemoryStrategy = "semantic",
): MemoryStrategy {
  if (namespace.startsWith("assistant_")) return "semantic";
  if (namespace.startsWith("preferences_")) return "preferences";
  if (namespace.startsWith("session_")) return "summaries";
  if (namespace.startsWith("episodes_")) {
    const rest = namespace.slice("episodes_".length);
    const slash = rest.indexOf("/");
    const sessionSegment = slash === -1 ? "" : rest.slice(slash + 1);
    return sessionSegment.trim().length > 0 ? "episodes" : "reflections";
  }
  if (namespace.startsWith("user_")) return "semantic";
  return fallback;
}

/**
 * Merge per-namespace fan-out results, keeping the highest-scoring copy of
 * any record that appears in more than one namespace. Records without an
 * id can't be deduped, so they pass through untouched.
 */
function dedupeRecords(
  records: ThinkWorkMemoryRecord[],
): ThinkWorkMemoryRecord[] {
  const byId = new Map<string, ThinkWorkMemoryRecord>();
  const out: ThinkWorkMemoryRecord[] = [];
  for (const record of records) {
    const id = record.backendRefs?.[0]?.ref || "";
    if (!id) {
      out.push(record);
      continue;
    }
    if (!byId.has(id)) byId.set(id, record);
  }
  return [...out, ...byId.values()];
}

function dedupeResults(results: RecallResult[]): RecallResult[] {
  const byId = new Map<string, RecallResult>();
  const out: RecallResult[] = [];
  for (const result of results) {
    const id = result.record.backendRefs?.[0]?.ref || "";
    if (!id) {
      out.push(result);
      continue;
    }
    const existing = byId.get(id);
    if (!existing || result.score > existing.score) byId.set(id, result);
  }
  return [...out, ...byId.values()].sort((a, b) => b.score - a.score);
}

const AGENTCORE_CAPABILITIES: MemoryCapabilities = {
  retain: true,
  recall: true,
  spaceMemory: false,
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
    this.perNamespaceLimit =
      opts.perNamespaceLimit ?? DEFAULT_PER_NAMESPACE_LIMIT;
  }

  async capabilities(): Promise<MemoryCapabilities> {
    return AGENTCORE_CAPABILITIES;
  }

  async recall(req: RecallRequest): Promise<RecallResult[]> {
    const client = this.getClient();
    const actorId = req.ownerId;
    const limit = req.limit ?? 10;

    // Fan out over every actor-scoped namespace. Each call fails
    // independently — a namespace that doesn't exist yet (no extraction
    // has run) must not blank out the namespaces that do.
    const calls = ACTOR_NAMESPACES.map(async ({ prefix, strategy }) => {
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
    return dedupeResults(results.flat()).slice(0, limit);
  }

  async retain(req: RetainRequest): Promise<RetainResult> {
    const client = this.getClient();
    const actorId = req.ownerId;
    const namespace = `user_${actorId}`;
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
      ownerType: req.ownerType,
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

    const calls = ACTOR_NAMESPACES.map(async ({ prefix, strategy }) => {
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
    return dedupeRecords(out);
  }

  /**
   * List the actor's session-scoped episodic records (and the cross-session
   * reflections filed alongside them) for UI surfaces that want to show
   * "what happened in past threads".
   *
   * These are deliberately excluded from {@link recall} and {@link inspect}:
   * episodes are per-thread and would drown cross-thread lookups.
   *
   * ListMemoryRecords supports prefix listing via `namespacePath` (verified
   * against @aws-sdk/client-bedrock-agentcore's `ListMemoryRecordsInput`,
   * which declares both `namespace` and `namespacePath`), so a single call
   * covers `episodes_{actorId}/{sessionId}` for every session plus the
   * `episodes_{actorId}/` reflection namespace. Strategy is derived
   * per-record from the namespace it came back under.
   */
  async listEpisodicRecords(
    req: InspectRequest,
  ): Promise<ThinkWorkMemoryRecord[]> {
    const client = this.getClient();
    const namespacePath = `episodes_${req.ownerId}/`;
    try {
      const resp = await client.send(
        new ListMemoryRecordsCommand({
          memoryId: this.memoryId,
          namespacePath,
          maxResults: req.limit ?? this.perNamespaceLimit,
        }),
      );
      return dedupeRecords(
        (resp.memoryRecordSummaries || []).map((r) =>
          this.mapSummary(r, req, "episodes", namespacePath),
        ),
      );
    } catch (err) {
      console.debug(
        `[agentcore-adapter] episodic list failed path=${namespacePath}:`,
        (err as Error)?.message,
      );
      return [];
    }
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
    owner: {
      tenantId: string;
      ownerType: ThinkWorkMemoryRecord["ownerType"];
      ownerId: string;
      threadId?: string;
    },
    fallbackStrategy: MemoryStrategy,
    fallbackNamespace: string,
  ): ThinkWorkMemoryRecord {
    const text =
      (r.content && typeof (r.content as any).text === "string"
        ? (r.content as any).text
        : "") || "";
    const ns =
      r.namespaces && r.namespaces.length > 0
        ? r.namespaces[0]
        : fallbackNamespace;
    const createdAt = r.createdAt
      ? r.createdAt.toISOString()
      : new Date().toISOString();
    // Trust the namespace the record actually carries over the namespace we
    // queried: extraction can file one record under several namespaces, and
    // prefix listings return records from many namespaces at once.
    const strategy = strategyForNamespace(ns, fallbackStrategy);
    return {
      id: r.memoryRecordId || `agentcore-${ns}-${createdAt}`,
      tenantId: owner.tenantId,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      threadId: owner.threadId,
      kind: "unit",
      sourceType: "thread_turn",
      strategy,
      status: "active",
      content: { text },
      backendRefs: [{ backend: "agentcore", ref: r.memoryRecordId || "" }],
      createdAt,
      metadata: {
        namespace: ns,
        memoryStrategyId: r.memoryStrategyId || null,
        score: typeof r.score === "number" ? r.score : null,
      },
    };
  }

  /**
   * AgentCore doesn't expose a monotonic `updated_at` on memory records
   * (ListMemoryRecords returns a flat listing keyed by createdAt only), so
   * the compile pipeline can't safely drive an incremental cursor against it
   * in v1. The memory-retain compile-enqueue path checks the adapter kind and
   * skips enqueue when it isn't Hindsight, so this method should never be
   * called at runtime — but we throw explicitly to make any misconfiguration
   * fail loudly rather than produce silent zero-row compiles.
   */
  async listRecordsUpdatedSince(
    _req: ListRecordsUpdatedSinceRequest,
  ): Promise<ListRecordsUpdatedSinceResult> {
    throw new Error(
      "[agentcore-adapter] listRecordsUpdatedSince is not implemented in v1. " +
        "The Compounding Memory compile pipeline is Hindsight-only — see " +
        ".prds/compounding-memory-v1-build-plan.md.",
    );
  }
}
