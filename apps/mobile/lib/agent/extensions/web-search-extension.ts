// web-search — mobile-safe built-in Pi capability.
//
// The phone should expose a direct `web_search` tool like the desktop/local Pi host,
// but provider API keys must stay server-side. This extension registers the direct
// model-visible tool and dispatches through the authenticated platform proxy, where
// ThinkWork resolves tenant config + secrets for the caller's agent.

import {
  PlatformToolClientError,
  callPlatformWebSearch,
  platformToolContentToText,
  type PlatformToolDeps,
} from "../../platform-tools-client";
import { defineExtension } from "./define-extension";
import type { ExtensionFactory } from "./types";
import type { JsonSchema, ToolResult } from "../types";

export interface WebSearchExtensionOptions {
  /** The thread's agent id. The platform gates web search against this agent. */
  agentId: string;
  /** Injected for tests: token resolution / fetch / apiBase, plus the proxy fn. */
  deps?: PlatformToolDeps & {
    callTool?: typeof callPlatformWebSearch;
  };
}

const WEB_SEARCH_PARAMETERS: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "string",
      description: "Specific search query.",
    },
    num_results: {
      type: "number",
      description: "Number of results to return, from 1 to 10.",
    },
  },
  required: ["query"],
};

function formatWebSearchError(err: unknown): ToolResult {
  if (err instanceof PlatformToolClientError) {
    if (err.kind === "auth") {
      return {
        content:
          "web_search failed: your session is unavailable or expired. Sign in again, then retry.",
        isError: true,
      };
    }
    if (err.status === 404) {
      return {
        content:
          "web_search is not enabled for this agent or tenant. Enable Web Search in ThinkWork, then retry.",
        isError: true,
      };
    }
    if (err.kind === "transport") {
      return {
        content: `web_search failed: provider transport error. ${err.message}`,
        isError: true,
      };
    }
  }

  return {
    content: `web_search failed: ${
      err instanceof Error ? err.message : String(err)
    }`,
    isError: true,
  };
}

export function webSearchExtension(
  options: WebSearchExtensionOptions,
): ExtensionFactory {
  const deps = options.deps ?? {};
  const callTool = deps.callTool ?? callPlatformWebSearch;

  return defineExtension({
    name: "web-search",
    description: "Exposes ThinkWork Web Search to the mobile Pi harness.",
    toolNames: ["web_search"],
    register(pi) {
      pi.registerTool({
        name: "web_search",
        description:
          "Search the web for current information (locations, business hours, current events, prices, schedules, news, definitions). Prefer this for ordinary factual lookups before browser automation.",
        parameters: WEB_SEARCH_PARAMETERS,
        execute: async (args) => {
          const query = typeof args.query === "string" ? args.query.trim() : "";
          if (!query) {
            return {
              content: "web_search requires a non-empty query.",
              isError: true,
            };
          }

          const numResults = Math.max(
            1,
            Math.min(Math.trunc(Number(args.num_results) || 5), 10),
          );

          try {
            const result = await callTool(
              {
                agentId: options.agentId,
                query,
                numResults,
              },
              deps,
            );
            return {
              content: platformToolContentToText(result.content),
              isError: result.isError === true,
            };
          } catch (err) {
            return formatWebSearchError(err);
          }
        },
      });

      pi.on("before_agent_start", async (event) => ({
        systemPrompt:
          `${event.systemPrompt}\n\nYou have a direct \`web_search\` tool for current web information. ` +
          "Use it for current events, locations, business hours, prices, schedules, and ordinary factual lookup instead of answering from memory.",
      }));
    },
  });
}
