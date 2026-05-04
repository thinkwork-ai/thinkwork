import { randomUUID } from "node:crypto";
import {
  BatchCreateMemoryRecordsCommand,
  type BedrockAgentCoreClient,
  CreateEventCommand,
  ListMemoryRecordsCommand,
  RetrieveMemoryRecordsCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";

/**
 * Plan §005 U6 — AgentCore Memory tools as Flue ToolDefs.
 *
 * Ports `packages/agentcore-strands/agent-container/container-sources/
 * memory_tools.py`'s `remember()` + `recall()` to TypeScript ToolDefs
 * shaped for Flue's `init({ tools })`. Strands writes through
 * `BatchCreateMemoryRecords` + `CreateEvent` so the conversational
 * extraction strategies process the new fact in the background;
 * `recall()` first tries semantic `RetrieveMemoryRecords`, then falls
 * back to listing if the semantic search returns nothing.
 *
 * Multi-tenant invariants (FR-4a):
 * - `tenantId` and `userId` come from the trusted-handler invocation
 *   scope. There is no agent-supplied override; missing values throw
 *   before any AWS call.
 * - The namespace key is `user_<userId>` to match the Strands writer.
 *   Cross-runtime parity matters because a Strands user can flip to
 *   Flue and continue with the same memory store.
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

function namespaceFor(userId: string): string {
  return `user_${userId}`;
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
  return {
    text,
    score: typeof r.score === "number" ? r.score : undefined,
    memoryRecordId:
      typeof r.memoryRecordId === "string"
        ? r.memoryRecordId
        : typeof r.id === "string"
          ? r.id
          : undefined,
    strategy: typeof r.strategy === "string" ? r.strategy : "managed",
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
export function buildRememberTool(
  context: MemoryToolsContext,
): AgentTool<any> {
  return {
    name: "remember",
    label: "Remember",
    description:
      "Store an important fact about the user or conversation in long-term memory. " +
      "Use when the user shares a preference, important context, or asks the agent to remember something. " +
      "The memory persists across all future conversations for this user.",
    parameters: Type.Object({
      fact: Type.String({
        description: "The fact or preference to remember. Be specific and concise.",
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
                content: { text: `The user asked me to remember: ${trimmedFact}` },
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
 * Build the `recall` ToolDef. Searches the user's AgentCore Memory
 * namespace via `RetrieveMemoryRecords` (semantic search) and falls
 * back to `ListMemoryRecords` if the semantic call yields no results.
 */
export function buildRecallTool(context: MemoryToolsContext): AgentTool<any> {
  return {
    name: "recall",
    label: "Recall",
    description:
      "Search long-term memory for relevant information about the current user. " +
      "Use when checking what the agent already knows about the user, recalling " +
      "past conversations, or finding previously stored facts. Returns up to " +
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
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      requireScope(context);
      const { query, top_k } = params as RecallParams;
      const trimmed = (query ?? "").trim();
      if (!trimmed) {
        throw new MemoryToolError(
          "recall called with an empty query parameter.",
        );
      }
      const topK = Math.max(1, Math.min(top_k ?? MAX_RECALL_RECORDS, MAX_RECALL_RECORDS));
      const namespace = namespaceFor(context.userId);

      let records: NormalisedRecord[] = [];
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
        records = summaries
          .map((r) => normalise(r))
          .filter((r): r is NormalisedRecord => r !== null);
      } catch {
        // Fall through to list. Strands does the same — semantic
        // search may not be configured for this memory id, in which
        // case list is the only option.
        records = [];
      }

      if (records.length === 0) {
        const list = await context.client.send(
          new ListMemoryRecordsCommand({
            memoryId: context.memoryId,
            namespace,
          }),
        );
        const summaries = list.memoryRecordSummaries ?? [];
        records = summaries
          .map((r) => normalise(r))
          .filter((r): r is NormalisedRecord => r !== null);
        records.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      }

      const top = records.slice(0, topK);
      return {
        content: [{ type: "text", text: formatRecall(top) }],
        details: {
          tenantId: context.tenantId,
          userId: context.userId,
          namespace,
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
