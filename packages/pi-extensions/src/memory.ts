import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { MemoryItem } from "@thinkwork/pi-runtime-core";
import { Type } from "typebox";

import {
  defineExtension,
  requireProvider,
  type ThinkworkExtension,
} from "./define-extension.js";

/**
 * Memory — the tracer-bullet capability (plan U5). The first thinkwork platform
 * capability authored as a Pi extension end-to-end: it registers the
 * agent-facing `recall`/`reflect` tools and a proactive `session_start`
 * grounding recall, reaching long-term memory ONLY through the host-supplied
 * {@link MemoryProvider} (no Hindsight/HTTP client of its own). The host wires
 * the provider with creds/endpoint, so this extension is identical on the cloud
 * and desktop hosts — the template every other capability follows in U7.
 *
 * Read-synthesis chain (feedback_hindsight_recall_reflect_pair): `recall`
 * surfaces raw memory units, `reflect` synthesizes them into a coherent answer.
 * The two tool descriptions are a load-bearing pair — edit them together.
 * Persisting what a turn learned is a SEPARATE host concern (end-of-turn
 * retain), not `reflect` (see memory-provider.ts).
 */

export interface MemoryExtensionOptions {
  /**
   * Query for the proactive `session_start` grounding recall — normally the
   * turn's user message, supplied by the host. When absent, the session_start
   * hook performs no proactive recall; the agent-driven `recall` tool remains
   * the path. Keeping the query host-supplied avoids the extension reaching for
   * turn state it does not own.
   */
  groundingQuery?: string;
  /** Max memories for the proactive grounding recall (default 5). */
  groundingLimit?: number;
}

const DEFAULT_GROUNDING_LIMIT = 5;
const MAX_RECALL_LIMIT = 10;

/** Render recalled units as a compact numbered list for a tool/context payload. */
function formatMemories(memories: MemoryItem[]): string {
  if (memories.length === 0) return "No relevant memories found.";
  return memories
    .map((memory, index) => `${index + 1}. ${memory.content}`)
    .join("\n");
}

/**
 * Build the memory extension. Returns a {@link ThinkworkExtension} the host
 * binds to a provider bundle and loads via the resource loader's
 * `extensionFactories` (the U1 serverless loading mechanism).
 */
export function createMemoryExtension(
  options: MemoryExtensionOptions = {},
): ThinkworkExtension {
  return defineExtension({
    name: "thinkwork-memory",
    register(pi, providers) {
      // Fail loud at load if the host forgot the provider — better than a
      // silent no-op mid-turn (the all-optional ProviderBundle invites that).
      const memory = requireProvider(providers, "memory", "thinkwork-memory");

      const recallTool: ToolDefinition = {
        name: "recall",
        label: "Recall",
        description:
          "Recall raw memory units relevant to a query from the user's long-term memory. " +
          "Use to check what is already known about the user or to surface prior context.\n\n" +
          "REQUIRED FOLLOW-UP: after recall you MUST call `reflect` on the same query to " +
          "synthesize the raw units into a coherent answer. Returning recall output without " +
          "reflect produces fragmented, low-quality responses.",
        parameters: Type.Object({
          query: Type.String({
            description: "What to recall from long-term memory.",
          }),
          limit: Type.Optional(
            Type.Integer({
              description: `Maximum memories to return (1-${MAX_RECALL_LIMIT}).`,
              minimum: 1,
              maximum: MAX_RECALL_LIMIT,
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const { query, limit } = params as { query: string; limit?: number };
          const trimmed = (query ?? "").trim();
          if (!trimmed) {
            throw new Error("recall called with an empty query parameter.");
          }
          const result = await memory.recall({ query: trimmed, limit });
          return {
            content: [{ type: "text", text: formatMemories(result.memories) }],
            details: { query: trimmed, count: result.memories.length },
          };
        },
      };

      const reflectTool: ToolDefinition = {
        name: "reflect",
        label: "Reflect",
        description:
          "Synthesize the memory units recalled for a query into a coherent answer. " +
          "Call this AFTER `recall` on the same query — reflect performs the actual reasoning " +
          "over the recalled units and returns the answer to act on.",
        parameters: Type.Object({
          query: Type.String({
            description:
              "The topic to synthesize. Should match the query you passed to recall.",
          }),
          context: Type.Optional(
            Type.String({
              description:
                "Optional surrounding turn context to focus the synthesis.",
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const { query, context } = params as {
            query: string;
            context?: string;
          };
          const trimmed = (query ?? "").trim();
          if (!trimmed) {
            throw new Error("reflect called with an empty query parameter.");
          }
          const result = await memory.reflect({ query: trimmed, context });
          const text =
            result.text?.trim() ||
            (result.ok ? "No synthesis produced." : "Reflection failed.");
          return {
            content: [{ type: "text", text }],
            details: { query: trimmed, ok: result.ok },
          };
        },
      };

      pi.registerTool(recallTool);
      pi.registerTool(reflectTool);

      // Proactive grounding: on session start, recall against the turn's query
      // (host-supplied) so prior memory is surfaced for the turn, then inject it
      // ONCE into the model context via the `context` event. This is
      // message-context injection — distinct from system-prompt composition,
      // which U6 owns through `before_agent_start`. When no grounding query is
      // supplied this is a no-op and the agent-driven recall tool is the path.
      let groundingText: string | undefined;
      let injected = false;

      pi.on("session_start", async () => {
        const query = options.groundingQuery?.trim();
        if (!query) return;
        const result = await memory.recall({
          query,
          limit: options.groundingLimit ?? DEFAULT_GROUNDING_LIMIT,
        });
        if (result.memories.length > 0) {
          groundingText = formatMemories(result.memories);
        }
      });

      pi.on("context", (event) => {
        if (injected || !groundingText) return;
        injected = true;
        // A complete pi-ai UserMessage (role/content/timestamp) so it slots into
        // the AgentMessage[] the context event carries without an SDK import.
        const groundingMessage = {
          role: "user" as const,
          content: `Relevant memory from prior context:\n${groundingText}`,
          timestamp: Date.now(),
        };
        return { messages: [groundingMessage, ...event.messages] };
      });
    },
  });
}
