import { randomUUID } from "node:crypto";
import {
  BatchCreateMemoryRecordsCommand,
  type BedrockAgentCoreClient,
  CreateEventCommand,
  ListMemoryRecordsCommand,
  RetrieveMemoryRecordsCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

/**
 * Plan §005 U6 — AgentCore Memory tools as Pi ToolDefs.
 *
 * AgentCore Memory `remember()` + `recall()` ToolDefs shaped for Pi's
 * `init({ tools })`. Writes flow through
 * `BatchCreateMemoryRecords` + `CreateEvent` so the conversational
 * extraction strategies process the new fact in the background;
 * `recall()` first tries semantic `RetrieveMemoryRecords` across every
 * actor-scoped namespace, then falls back to listing those same
 * namespaces if the semantic search returns nothing.
 *
 * Multi-tenant invariants (FR-4a):
 * - `tenantId` and `userId` come from the trusted-handler invocation
 *   scope. There is no agent-supplied override; missing values throw
 *   before any AWS call.
 * - Writes go to `user_<userId>`. Reads fan out over that namespace plus
 *   the managed extraction namespaces `assistant_<userId>` (semantic) and
 *   `preferences_<userId>` — all keyed on the user id, never the tenant.
 *
 * Async semantics (per `feedback_hindsight_async_tools` — the same
 * principle applies to AgentCore Memory even though the SDK is sync):
 * - Each tool invocation receives a fresh `BedrockAgentCoreClient`
 *   from the caller (U9 will pass one minted at handler entry). The
 *   tool itself does not cache clients across invocations.
 *
 * Inert-ship (U6): this module exports `buildMemoryTools`; nothing
 * imports it yet. U9's handler shell wires it into `init({ tools })`.
 */

const MAX_RECALL_RECORDS = 10;

export interface MemoryToolsContext {
  /** AgentCore client. U9 will mint one per invocation. */
  client: BedrockAgentCoreClient;
  /** AgentCore Memory id (resolves from `AGENTCORE_MEMORY_ID` at U9). */
  memoryId: string;
  /** Tenant id from invocation scope. Required. */
  tenantId: string;
  /** User id from invocation scope (the actor for AgentCore Memory). Required. */
  userId: string;
  /** Optional thread id used as the `sessionId` for `CreateEvent`. */
  threadId?: string;
}

export class MemoryToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryToolError";
  }
}

interface RememberParams {
  fact: string;
  category?: string;
}

interface RecallParams {
  query: string;
  top_k?: number;
}

interface NormalisedRecord {
  text: string;
  score?: number;
  memoryRecordId?: string;
  strategy?: string;
}

function requireScope(context: MemoryToolsContext): void {
  if (!context.tenantId || !context.tenantId.trim()) {
    throw new MemoryToolError(
      "AgentCore Memory tool invoked without a tenantId — the trusted handler must populate it.",
    );
  }
  if (!context.userId || !context.userId.trim()) {
    throw new MemoryToolError(
      "AgentCore Memory tool invoked without a userId — the trusted handler must populate it.",
    );
  }
  if (!context.memoryId || !context.memoryId.trim()) {
    throw new MemoryToolError(
      "AgentCore Memory tool invoked without a memoryId — the trusted handler must populate it.",
    );
  }
}

/**
 * Namespace the `remember` tool writes direct records into. AgentCore's
 * extraction strategies never write here — this is ThinkWork's own
 * "the user explicitly asked me to remember this" shelf.
 */
function namespaceFor(userId: string): string {
  return `user_${userId}`;
}

/**
 * Namespaces `recall` reads. The first two are where AgentCore's managed
 * extraction strategies file what they learn from conversations — see
 * terraform/modules/app/agentcore-memory/scripts/create_or_find_memory.sh:
 *
 *   semantic    -> assistant_{actorId}
 *   preferences -> preferences_{actorId}
 *
 * Reading only `user_{userId}` (as this tool did before THINK-404) meant
 * recall never saw a single automatically-extracted fact. Session-scoped
 * namespaces (`session_{sessionId}`, `episodes_{actorId}/{sessionId}`) are
 * deliberately excluded: they're per-thread and would drown cross-thread
 * lookups.
 */
function recallNamespaces(userId: string): string[] {
  return [`assistant_${userId}`, `preferences_${userId}`, namespaceFor(userId)];
}

/**
 * Merge fan-out results, keeping the highest-scoring copy of each record.
 * Extraction can file the same fact under more than one namespace, and the
 * SDK omits `memoryRecordId` on some shapes — fall back to the text so the
 * user never sees the same sentence twice.
 */
function mergeRecords(records: NormalisedRecord[]): NormalisedRecord[] {
  const byKey = new Map<string, NormalisedRecord>();
  for (const record of records) {
    const key = record.memoryRecordId ?? record.text;
    const existing = byKey.get(key);
    if (!existing || (record.score ?? 0) > (existing.score ?? 0)) {
      byKey.set(key, record);
    }
  }
  return [...byKey.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of [
    "text",
    "content",
    "memoryRecordContent",
    "summary",
    "value",
  ]) {
    const nested = record[key];
    if (typeof nested === "string" && nested.trim()) return nested.trim();
    if (nested && typeof nested === "object") {
      const text = extractText(nested);
      if (text) return text;
    }
  }
  return "";
}

function normalise(record: unknown): NormalisedRecord | null {
  if (!record || typeof record !== "object") return null;
  const text = extractText(record);
  if (!text) return null;
  const r = record as Record<string, unknown>;
  // The SDK exposes `memoryStrategyId` on `MemoryRecordSummary`; older
  // fixtures used `strategy`. Read both so legacy-shaped records and real SDK
  // responses both produce a meaningful tag.
  const strategy =
    typeof r.memoryStrategyId === "string"
      ? r.memoryStrategyId
      : typeof r.strategy === "string"
        ? r.strategy
        : "managed";
  return {
    text,
    score: typeof r.score === "number" ? r.score : undefined,
    memoryRecordId:
      typeof r.memoryRecordId === "string"
        ? r.memoryRecordId
        : typeof r.id === "string"
          ? r.id
          : undefined,
    strategy,
  };
}

function formatRecall(records: NormalisedRecord[]): string {
  if (records.length === 0) return "No relevant memories found.";
  return records
    .slice(0, MAX_RECALL_RECORDS)
    .map((r, i) => {
      const tag = r.strategy ? `[${r.strategy}] ` : "";
      return `${i + 1}. ${tag}${r.text}`;
    })
    .join("\n");
}

/**
 * Build the `remember` ToolDef. Writes a fact into the user's
 * AgentCore Memory namespace via `BatchCreateMemoryRecords` for
 * immediate searchability, and fires a `CreateEvent` so the
 * conversational extraction strategies can process it later.
 */
export function buildRememberTool(context: MemoryToolsContext): AgentTool<any> {
  return {
    name: "remember",
    label: "Remember",
    description:
      "Store an important fact about the user or conversation in long-term memory. " +
      "Use when the user shares a preference, important context, or asks the agent to remember something. " +
      "The memory persists across all future conversations for this user.",
    parameters: Type.Object({
      fact: Type.String({
        description:
          "The fact or preference to remember. Be specific and concise.",
      }),
      category: Type.Optional(
        Type.String({
          description:
            "Optional category hint such as 'preference', 'context', or 'instruction'.",
        }),
      ),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      requireScope(context);
      const { fact, category } = params as RememberParams;
      const trimmedFact = (fact ?? "").trim();
      if (!trimmedFact) {
        throw new MemoryToolError(
          "remember called with an empty fact parameter.",
        );
      }
      const namespace = namespaceFor(context.userId);
      const tag = category ? `[${category.trim()}] ` : "";
      const text = `${tag}${trimmedFact}`;
      const requestId = randomUUID().replace(/-/g, "").slice(0, 16);
      const now = new Date();

      await context.client.send(
        new BatchCreateMemoryRecordsCommand({
          memoryId: context.memoryId,
          records: [
            {
              requestIdentifier: requestId,
              content: { text },
              namespaces: [namespace],
              timestamp: now,
            },
          ],
        }),
      );

      const sessionId =
        context.threadId && context.threadId.trim()
          ? context.threadId.trim()
          : `memory_user_${context.userId}`;
      await context.client.send(
        new CreateEventCommand({
          memoryId: context.memoryId,
          actorId: context.userId,
          sessionId,
          eventTimestamp: now,
          payload: [
            {
              conversational: {
                content: {
                  text: `The user asked me to remember: ${trimmedFact}`,
                },
                role: "USER",
              },
            },
          ],
        }),
      );

      return {
        content: [{ type: "text", text: `Remembered: ${trimmedFact}` }],
        details: {
          tenantId: context.tenantId,
          userId: context.userId,
          namespace,
          category: category ?? null,
        },
      };
    },
  };
}

/**
 * Build the `recall` ToolDef. Searches every actor-scoped AgentCore Memory
 * namespace via `RetrieveMemoryRecords` (semantic search) — the managed
 * extraction namespaces plus the explicit-`remember` namespace — merges
 * and dedupes the hits, and falls back to `ListMemoryRecords` over the
 * same namespaces if semantic search yields nothing.
 */
export function buildRecallTool(context: MemoryToolsContext): AgentTool<any> {
  return {
    name: "recall",
    label: "Recall",
    description:
      "Search long-term memory for relevant information about the current user. " +
      "Covers both facts the platform extracted automatically from past " +
      "conversations (facts and preferences) and facts stored explicitly with " +
      "`remember`. Use when checking what the agent already knows about the " +
      "user, recalling past conversations, or finding previously stored " +
      "facts. Returns up to " +
      `${MAX_RECALL_RECORDS} matching memories or a 'no memories found' message.`,
    parameters: Type.Object({
      query: Type.String({
        description: "What to search for in long-term memory.",
      }),
      top_k: Type.Optional(
        Type.Integer({
          description: `Maximum records to return (1-${MAX_RECALL_RECORDS}).`,
          minimum: 1,
          maximum: MAX_RECALL_RECORDS,
        }),
      ),
    }),
    executionMode: "parallel",
    execute: async (_toolCallId, params) => {
      requireScope(context);
      const { query, top_k } = params as RecallParams;
      const trimmed = (query ?? "").trim();
      if (!trimmed) {
        throw new MemoryToolError(
          "recall called with an empty query parameter.",
        );
      }
      const topK = Math.max(
        1,
        Math.min(top_k ?? MAX_RECALL_RECORDS, MAX_RECALL_RECORDS),
      );
      const namespaces = recallNamespaces(context.userId);

      // Each namespace is queried independently: a namespace that has no
      // records yet (extraction hasn't run) must not blank out the ones
      // that do. Only a total failure is an error.
      let semanticErr: unknown;
      const semanticHits = await Promise.all(
        namespaces.map(async (namespace) => {
          try {
            const semantic = await context.client.send(
              new RetrieveMemoryRecordsCommand({
                memoryId: context.memoryId,
                namespace,
                searchCriteria: {
                  searchQuery: trimmed,
                  topK,
                },
              }),
            );
            const summaries = semantic.memoryRecordSummaries ?? [];
            return summaries
              .map((r) => normalise(r))
              .filter((r): r is NormalisedRecord => r !== null);
          } catch (err) {
            // Capture the error so the list-fallback path can re-raise if
            // every list call also fails, preserving the original cause.
            semanticErr ??= err;
            return null;
          }
        }),
      );
      let records = mergeRecords(
        semanticHits.flatMap((hits) => hits ?? []),
      ).slice(0, topK);

      if (records.length === 0) {
        const listHits = await Promise.all(
          namespaces.map(async (namespace) => {
            try {
              const list = await context.client.send(
                new ListMemoryRecordsCommand({
                  memoryId: context.memoryId,
                  namespace,
                  maxResults: topK,
                }),
              );
              const summaries = list.memoryRecordSummaries ?? [];
              return summaries
                .map((r) => normalise(r))
                .filter((r): r is NormalisedRecord => r !== null);
            } catch (listErr) {
              void listErr;
              return null;
            }
          }),
        );
        if (listHits.every((hits) => hits === null)) {
          // Every namespace failed on both calls. Prefer surfacing the
          // original semantic error — that's the call the caller intended.
          throw new MemoryToolError(
            `recall failed against memory id '${context.memoryId}': ${
              semanticErr instanceof Error
                ? semanticErr.message
                : String(semanticErr ?? "all namespaces failed")
            }`,
          );
        }
        // List responses don't populate `score`; mergeRecords' sort is
        // defensive in case a future SDK revision adds it. Otherwise the
        // stable server order survives.
        records = mergeRecords(listHits.flatMap((hits) => hits ?? [])).slice(
          0,
          topK,
        );
      }

      const top = records.slice(0, topK);
      return {
        content: [{ type: "text", text: formatRecall(top) }],
        details: {
          tenantId: context.tenantId,
          userId: context.userId,
          namespaces,
          query: trimmed,
          recordCount: top.length,
        },
      };
    },
  };
}

/**
 * Build both AgentCore Memory ToolDefs: `[remember, recall]`.
 */
export function buildMemoryTools(
  context: MemoryToolsContext,
): AgentTool<any>[] {
  return [buildRememberTool(context), buildRecallTool(context)];
}
