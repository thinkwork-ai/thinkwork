import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  createAnalyticsDisplaySummary,
  validateAnalyticsDisplayPayload,
  type AnalyticsDisplayRenderPayload,
} from "@thinkwork/analytics-display";
import { createAnalyticsDisplayGenUIPart } from "@thinkwork/genui";
import { Type } from "typebox";

import { defineExtension, type ThinkworkExtension } from "./define-extension.js";

const SHOW_ANALYTICS_DISPLAY_TOOL = "show_analytics_display";

export function createAnalyticsDisplayExtension(): ThinkworkExtension {
  return defineExtension({
    name: "thinkwork-analytics-display",
    toolNames: [SHOW_ANALYTICS_DISPLAY_TOOL],
    register(pi) {
      const tool: ToolDefinition = {
        name: SHOW_ANALYTICS_DISPLAY_TOOL,
        label: "Show Analytics Display",
        description:
          "Render a compact inline Thread chart/table/metric from source data. " +
          "Use this after you have rows from a connected source, MCP tool, workspace file, or prior thread context. " +
          "Do not invent CRM, sales, finance, or operational values. If the source is unavailable, explain what source access is needed instead of calling this tool. " +
          "The payload must be an analytics.display/v1 object with bounded rows, columns, elements, freshness, provenance, and sensitivity metadata. " +
          "For requests like 'display a chart of Twenty CRM opportunity value by owner', query or use the available Twenty CRM data first, then call this tool with a chart element grouped by owner.",
        parameters: Type.Object({
          id: Type.Optional(
            Type.String({
              description:
                "Stable data-genui part id. Defaults to a deterministic analytics id from the payload title.",
            }),
          ),
          payload: Type.Any({
            description:
              "analytics.display/v1 payload: { kind:'analytics.display', analyticsDisplayVersion:'analytics-display/v1', spec:{ title, columns, elements, filters? }, data:{ rows }, freshness, provenance, sensitivity? }.",
          }),
          artifactTitle: Type.Optional(
            Type.String({
              description:
                "Optional title used when the inline chart is promoted to an artifact.",
            }),
          ),
          artifactSummary: Type.Optional(
            Type.String({
              description:
                "Optional summary used when the inline chart is promoted to an artifact.",
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const input = params as {
            id?: string;
            payload?: unknown;
            artifactTitle?: string;
            artifactSummary?: string;
          };
          const result = validateAnalyticsDisplayPayload(input.payload);
          if (!result.ok) {
            throw new Error(
              `show_analytics_display received an invalid analytics payload: ${result.diagnostics
                .map((diagnostic) => diagnostic.message)
                .join("; ")}`,
            );
          }

          const summary = createAnalyticsDisplaySummary(result.payload);
          const part = createAnalyticsDisplayGenUIPart({
            id: input.id || analyticsPartId(result.payload),
            payload: result.payload,
            promotion:
              input.artifactTitle || input.artifactSummary
                ? {
                    artifactTitle: input.artifactTitle || summary.title,
                    artifactSummary:
                      input.artifactSummary || summary.lines[0] || summary.title,
                  }
                : undefined,
          });

          return {
            content: [
              {
                type: "text",
                text: `Rendered ${summary.title} as an inline analytical display.`,
              },
            ],
            details: {
              threadGenUI: part,
              analyticsDisplaySummary: summary,
            },
          };
        },
      };

      pi.registerTool(tool);
    },
  });
}

function analyticsPartId(payload: AnalyticsDisplayRenderPayload): string {
  return `genui:analytics:${payload.spec.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)}`;
}
