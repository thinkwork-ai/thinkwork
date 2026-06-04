import type {
  AgentToolResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";

export interface BrowserAutomationRequest {
  url: string;
  task: string;
}

export type BrowserAutomationRunner = (
  request: BrowserAutomationRequest,
  signal?: AbortSignal,
) => Promise<AgentToolResult<unknown>>;

export interface BrowserAutomationExtensionOptions {
  enabled: boolean;
  run: BrowserAutomationRunner;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createBrowserAutomationExtension(
  options: BrowserAutomationExtensionOptions,
): ThinkworkExtension {
  return defineExtension({
    name: "thinkwork-browser-automation",
    toolNames: options.enabled ? ["browser_automation"] : [],
    register(pi) {
      if (!options.enabled) return;

      const tool: ToolDefinition = {
        name: "browser_automation",
        label: "Browser",
        description:
          "Heavyweight browser-automation session — open a managed AgentCore " +
          "Browser, navigate to a public HTTPS URL, interact with the page, and " +
          "capture evidence. DO NOT use for ordinary information lookups or " +
          "normal page reading. Prefer `web_search` to find candidate URLs and " +
          "`web_extract` to read, summarize, analyze, or quote a known public " +
          "page as clean content. Only reach for `browser_automation` when the " +
          "task genuinely requires page interaction (filling forms, clicking " +
          "through an auth flow, rendered-state inspection, scraping JS-rendered " +
          "content that extraction cannot read, or following a multi-step user " +
          "journey). This tool is expensive and slow; if `web_search` or " +
          "`web_extract` would answer the question, use those instead.",
        parameters: Type.Object({
          url: Type.String({ description: "Starting public HTTPS URL." }),
          task: Type.Optional(
            Type.String({
              description:
                "Short browser task or what to verify after opening the URL.",
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params, signal) {
          const typed = (params ?? {}) as Record<string, unknown>;
          return options.run(
            {
              url: asString(typed.url),
              task: asString(typed.task),
            },
            signal,
          );
        },
      };

      pi.registerTool(tool);
    },
  });
}
