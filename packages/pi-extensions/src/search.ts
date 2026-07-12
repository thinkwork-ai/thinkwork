import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
  SearchLegResult,
  SearchProviderResult,
} from "@thinkwork/pi-runtime-core";
import { Type } from "typebox";

import {
  defineExtension,
  requireProvider,
  type ThinkworkExtension,
} from "./define-extension.js";

/**
 * ThinkWork Search — the unified fan-out broker as a Pi extension
 * (THINK-263 U8). Registers the agent-facing `search` tool, reaching the
 * broker ONLY through the host-supplied {@link SearchProvider} (no
 * GraphQL/HTTP client of its own), so the extension is identical on the
 * cloud and desktop hosts and — crucially — resolves the SAME broker the web
 * palette calls (R2). This is the fix for the wrong-source problem: one tool
 * that fans out across threads, wiki, and entities in a single call, instead
 * of the model guessing between `recall`, `search_wiki`, and the graph tools.
 *
 * Identity discipline: the tool params carry NO tenant/user/thread ids —
 * identity is closed over in the host-supplied provider (turn-bound
 * credential), and the platform API resolves BOTH tenant and the invoking
 * user server-side. The broker then runs as the turn's user, so thread
 * visibility and memory scoping match what that user sees in the palette.
 *
 * Degradation: provider failure/timeout returns an explicit "unavailable"
 * tool result — it NEVER throws mid-turn.
 */

export interface SearchExtensionOptions {
  onError?: (error: unknown, context: { phase: string }) => void;
}

const MAX_LIMIT = 10;
const UNAVAILABLE_TEXT = "ThinkWork search is currently unavailable.";
const VALID_SOURCES = ["THREADS", "WIKI", "ENTITIES", "MEMORY"] as const;

function formatLeg(leg: SearchLegResult): string {
  const header =
    leg.status === "OK"
      ? `${leg.source}:`
      : `${leg.source} (${leg.status.toLowerCase()}):`;
  if (leg.status !== "OK") {
    return `${header} unavailable for this query`;
  }
  if (leg.lines.length === 0) {
    return `${header} no matches`;
  }
  return [header, ...leg.lines.map((line) => `  - ${line}`)].join("\n");
}

function formatResult(result: SearchProviderResult): string {
  if (result.legs.length === 0) {
    return "No results.";
  }
  return result.legs.map(formatLeg).join("\n");
}

/**
 * Build the search extension. Returns a {@link ThinkworkExtension} the host
 * binds to a provider bundle and loads via the resource loader.
 */
export function createSearchExtension(
  options: SearchExtensionOptions = {},
): ThinkworkExtension {
  return defineExtension({
    name: "thinkwork-search",
    // Must be folded into the createAgentSession allowlist or this tool
    // registers but never reaches the model (the SDK gates to the allowlist).
    toolNames: ["search"],
    register(pi, providers) {
      const search = requireProvider(providers, "search", "thinkwork-search");

      const searchTool: ToolDefinition = {
        name: "search",
        label: "Search",
        description:
          "Search everything ThinkWork knows for the current user in ONE call — " +
          "threads, compiled wiki pages, and knowledge-graph entities are all " +
          "fanned out together and returned as source-tagged results. Prefer this " +
          "over guessing between `recall`, `search_wiki`, or the knowledge-graph " +
          'tools for lookup questions ("what do we know about Acme?", "find the ' +
          'thread where we set pricing"). Results are scoped to what the current ' +
          "user can access. Set `sources` to narrow the legs; include `MEMORY` to " +
          "also search the user's own episodic memory (slower).",
        parameters: Type.Object({
          query: Type.String({
            description: "What to search for.",
          }),
          sources: Type.Optional(
            Type.Array(Type.Union(VALID_SOURCES.map((s) => Type.Literal(s))), {
              description:
                "Which legs to run (default: THREADS, WIKI, ENTITIES). " +
                "Add MEMORY to also search episodic memory.",
            }),
          ),
          limit: Type.Optional(
            Type.Integer({
              description: `Maximum hits per leg (1-${MAX_LIMIT}).`,
              minimum: 1,
              maximum: MAX_LIMIT,
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params, signal) {
          const { query, sources, limit } = params as {
            query: string;
            sources?: string[];
            limit?: number;
          };
          const trimmed = (query ?? "").trim();
          if (!trimmed) {
            return {
              content: [
                { type: "text", text: "search requires a non-empty query." },
              ],
              details: { ok: false },
            };
          }
          try {
            const result = await search.search(
              { query: trimmed, sources, limit },
              signal,
            );
            return {
              content: [{ type: "text", text: formatResult(result) }],
              details: {
                query: trimmed,
                legs: result.legs.map((leg) => ({
                  source: leg.source,
                  status: leg.status,
                  hitCount: leg.lines.length,
                })),
              },
            };
          } catch (error) {
            // Degraded backend must never break the turn.
            options.onError?.(error, { phase: "search" });
            return {
              content: [{ type: "text", text: UNAVAILABLE_TEXT }],
              details: { ok: false, query: trimmed },
            };
          }
        },
      };

      pi.registerTool(searchTool);
    },
  });
}
