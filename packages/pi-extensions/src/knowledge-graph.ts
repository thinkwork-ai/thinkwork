import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
  KnowledgeGraphEntityItem,
  KnowledgeGraphRelationshipItem,
  KnowledgeGraphSearchResult,
} from "@thinkwork/pi-runtime-core";
import { Type } from "typebox";

import {
  defineExtension,
  requireProvider,
  type ThinkworkExtension,
} from "./define-extension.js";

/**
 * Knowledge Graph — the tenant's shared institutional graph as a Pi extension
 * (plan 2026-06-09-004 U8). Registers the agent-facing `knowledge_graph_search`
 * tool, reaching the graph ONLY through the host-supplied
 * {@link KnowledgeGraphProvider} (no GraphQL/HTTP client of its own), so the
 * extension is identical on the cloud and desktop hosts.
 *
 * Identity discipline (R15): the tool params carry NO tenant/user/thread
 * identifiers — identity is closed over in the host-supplied provider
 * (turn-bound credential), so a prompt-injected turn cannot flip tenants by
 * parameter. Tests assert the param schema stays identity-free.
 *
 * Positioning vs recall/reflect (the memory pair): the graph answers
 * entity/relationship questions over the company's SHARED institutional
 * knowledge — customers, projects, decisions and how they connect across the
 * whole tenant. `recall`/`reflect` remain the user's OWN episodic memory.
 * The memory.ts docstrings reference this tool; edit them together.
 *
 * Degradation: provider failure/timeout returns an explicit "Knowledge graph
 * is currently unavailable." tool result — it NEVER throws mid-turn.
 */

export interface KnowledgeGraphExtensionOptions {
  /**
   * Optional sink for non-fatal extension errors (a failed provider call that
   * degraded to the "unavailable" result). Makes the failure observable
   * instead of silent; the cloud host wires it to structured logging.
   */
  onError?: (error: unknown, context: { phase: string }) => void;
}

const MAX_SEARCH_LIMIT = 10;
const UNAVAILABLE_TEXT = "Knowledge graph is currently unavailable.";

function formatEntity(entity: KnowledgeGraphEntityItem, index: number): string {
  const type = entity.typeSlug ? ` (${entity.typeSlug})` : "";
  const summary = entity.summary?.trim() ? ` — ${entity.summary.trim()}` : "";
  const facts: string[] = [];
  if (entity.relationshipCount > 0) {
    facts.push(
      `${entity.relationshipCount} relationship${entity.relationshipCount === 1 ? "" : "s"}`,
    );
  }
  if (entity.observationIds.length > 0) {
    facts.push(
      `${entity.observationIds.length} supporting observation${entity.observationIds.length === 1 ? "" : "s"}`,
    );
  }
  const aliases =
    entity.aliases.length > 0 ? ` (aka: ${entity.aliases.join(", ")})` : "";
  const suffix = facts.length > 0 ? ` [${facts.join(", ")}]` : "";
  return `${index + 1}. ${entity.label}${type}${aliases}${summary}${suffix}`;
}

function formatRelationship(
  relationship: KnowledgeGraphRelationshipItem,
): string {
  return `- ${relationship.fromLabel} —[${relationship.label}]→ ${relationship.toLabel}`;
}

/** Render a search result as compact text for the model. */
function formatSearchResult(result: KnowledgeGraphSearchResult): string {
  if (result.entities.length === 0) {
    return "No matching entities in the knowledge graph.";
  }
  const sections: string[] = [
    "Entities:",
    ...result.entities.map((entity, index) => formatEntity(entity, index)),
  ];
  if (result.relationships.length > 0) {
    sections.push(
      "Relationships:",
      ...result.relationships.map((relationship) =>
        formatRelationship(relationship),
      ),
    );
  }
  return sections.join("\n");
}

/**
 * Build the knowledge-graph extension. Returns a {@link ThinkworkExtension}
 * the host binds to a provider bundle and loads via the resource loader's
 * `extensionFactories`.
 */
export function createKnowledgeGraphExtension(
  options: KnowledgeGraphExtensionOptions = {},
): ThinkworkExtension {
  return defineExtension({
    name: "thinkwork-knowledge-graph",
    // Must be folded into the createAgentSession allowlist or this tool
    // registers but never reaches the model (the SDK gates to the allowlist).
    toolNames: ["knowledge_graph_search"],
    register(pi, providers) {
      // Fail loud at load if the host forgot the provider — better than a
      // silent no-op mid-turn (the all-optional ProviderBundle invites that).
      const graph = requireProvider(
        providers,
        "knowledgeGraph",
        "thinkwork-knowledge-graph",
      );

      const searchTool: ToolDefinition = {
        name: "knowledge_graph_search",
        label: "Knowledge Graph",
        description:
          "Search the company's shared knowledge graph for institutional entities and how " +
          "they relate — customers, projects, people, decisions, and the relationships " +
          "between them, distilled from the whole company's promoted knowledge. Use this " +
          'for entity/relationship questions ("which projects is Acme tied to?", "who ' +
          'decided X?"). Results carry entity summaries and relationship edges with ' +
          "supporting-observation counts.\n\n" +
          "This is NOT the user's personal memory: for the current user's own episodic " +
          "memory and prior-conversation facts, use `recall` followed by `reflect` instead. " +
          "It is also not the wiki: for compiled narrative pages distilled from this same " +
          "knowledge, use the wiki context tools (`query_wiki_context`); this tool traverses " +
          "raw entities and relationship edges.",
        parameters: Type.Object({
          query: Type.String({
            description:
              "Entity name or alias to look up in the knowledge graph.",
          }),
          limit: Type.Optional(
            Type.Integer({
              description: `Maximum entities to return (1-${MAX_SEARCH_LIMIT}).`,
              minimum: 1,
              maximum: MAX_SEARCH_LIMIT,
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params, signal) {
          const { query, limit } = params as { query: string; limit?: number };
          const trimmed = (query ?? "").trim();
          if (!trimmed) {
            return {
              content: [
                {
                  type: "text",
                  text: "knowledge_graph_search requires a non-empty query.",
                },
              ],
              details: { ok: false },
            };
          }
          try {
            // Thread the turn's abort signal so a user abort / host timeout
            // tears down an in-flight backend call instead of orphaning it.
            const result = await graph.search(
              { query: trimmed, limit },
              signal,
            );
            return {
              content: [{ type: "text", text: formatSearchResult(result) }],
              details: {
                query: trimmed,
                entityCount: result.entities.length,
                relationshipCount: result.relationships.length,
              },
            };
          } catch (error) {
            // Degraded backend must never break the turn — surface an
            // explicit unavailable result instead of throwing (U8 contract).
            options.onError?.(error, { phase: "knowledge_graph_search" });
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
