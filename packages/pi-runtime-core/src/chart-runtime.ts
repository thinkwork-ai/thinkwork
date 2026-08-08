/**
 * `emit_analytics_chart` — the runtime seam that turns a numeric answer into a
 * durable `data-chart` UI message part (THINK-672).
 *
 * Mirrors the `emit_json_render_ui` shape deliberately: the tool validates the
 * model's payload through the ONE shared chart validator
 * (`@thinkwork/chart-renderer`), stamps a stable content-hash id, and hands the
 * part back on `details.chart_message_part`. The agent loop extracts it there
 * and merges it into `runResult.uiMessageParts`, which the finalize payload
 * carries to the API as `ui_message_parts` — so a chart the validator rejected
 * provably persists nothing.
 *
 * Unlike json-render, charts are **always on**: there is no per-agent opt-in
 * column and no capability gate. A chart is a presentation of data the agent
 * already computed — the deliberate scope decision (THINK-672) is that every
 * agent may draw one, so the host registers this tool unconditionally.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  CHART_MESSAGE_PART_TYPE,
  CHART_TYPES,
  validateChartDirectiveData,
  type ChartMessagePart,
} from "@thinkwork/chart-renderer";

export const EMIT_ANALYTICS_CHART_TOOL_NAME = "emit_analytics_chart" as const;

/** At most this many charts may be queued in a single turn. A turn that wants
 *  more is answering with a dashboard, not an answer. */
export const MAX_CHART_PARTS_PER_TURN = 4;

const CHART_PART_LIMIT_MESSAGE =
  `Chart limit reached: at most ${MAX_CHART_PARTS_PER_TURN} charts can be ` +
  "emitted per turn. Present any further numbers as prose or a markdown table.";

export function buildEmitAnalyticsChartTool(): AgentTool<any> {
  // Per-turn state: the host builds tools once per dispatch, so this closure is
  // scoped to exactly one turn.
  const emittedIds = new Set<string>();

  return {
    name: EMIT_ANALYTICS_CHART_TOOL_NAME,
    label: "Emit analytics chart",
    description:
      "When answering an analytics question with numeric results, emit the " +
      "result as a chart. The caption is the takeaway. The chart renders as a " +
      "card in the client, so do not also repeat the same numbers as a " +
      "markdown table in your prose. Pick the form that fits the question: " +
      "`bar` for comparison across categories, `line` for change over time, " +
      "`donut` for parts of a whole, `stat-strip` for a small row of headline " +
      "numbers, `sparkline` for a compact trend, `meter` for progress toward a " +
      "target (pass `max`), `funnel` for stage-to-stage drop-off. " +
      `At most ${MAX_CHART_PARTS_PER_TURN} charts per turn.`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["type", "title", "series"],
      properties: {
        type: {
          type: "string",
          enum: [...CHART_TYPES],
          description: "The chart form that fits the question.",
        },
        title: {
          type: "string",
          description: "What the chart shows, e.g. 'Pipeline by stage'.",
        },
        qualifier: {
          type: "string",
          description:
            "Optional scope line under the title, e.g. 'Last 30 days, EMEA'.",
        },
        series: {
          type: "array",
          minItems: 1,
          maxItems: 24,
          description: "1–24 data points, in the order they should be drawn.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value"],
            properties: {
              label: { type: "string" },
              value: { type: "number" },
            },
          },
        },
        caption: {
          type: "string",
          description:
            "The takeaway sentence, not a chart description. Say what the " +
            "numbers mean (e.g. 'Qualification is the biggest drop-off'), " +
            "never 'This chart shows revenue by region'.",
        },
        max: {
          type: "number",
          description: "Target value for `meter` charts. Ignored otherwise.",
        },
      },
    },
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const validated = validateChartDirectiveData(params);
      if (!validated.ok) {
        // Error string straight back to the model — the same self-repair loop
        // json-render rejections drive.
        return {
          content: [
            {
              type: "text",
              text: `Chart rejected: ${validated.error}`,
            },
          ],
          details: { ok: false, error: validated.error },
        };
      }

      const part: ChartMessagePart = {
        type: CHART_MESSAGE_PART_TYPE,
        id: chartPartId(validated.data),
        data: validated.data,
      };

      // The cap counts DISTINCT charts: a re-emit of an identical chart hashes
      // to the same id and is a no-op, not a strike against the budget.
      if (!emittedIds.has(part.id)) {
        if (emittedIds.size >= MAX_CHART_PARTS_PER_TURN) {
          return {
            content: [{ type: "text", text: CHART_PART_LIMIT_MESSAGE }],
            details: { ok: false, error: CHART_PART_LIMIT_MESSAGE },
          };
        }
        emittedIds.add(part.id);
      }

      return {
        content: [
          {
            type: "text",
            text:
              `Chart queued: ${part.data.title}. It renders as a card in the ` +
              "client — do not also describe the chart data in a table.",
          },
        ],
        details: { ok: true, chart_message_part: part },
      };
    },
  } as AgentTool<any>;
}

/**
 * Pull the validated chart part off an `emit_analytics_chart` tool result.
 * Returns null for a rejected emit (no `chart_message_part` in `details`), so a
 * rejection can never reach the durable part list.
 */
export function extractEmitAnalyticsChartToolPart(
  result: unknown,
): ChartMessagePart | null {
  const record = recordValue(result);
  const details = recordValue(record?.details);
  const candidate = details?.chart_message_part;
  const part = recordValue(candidate);
  if (!part || part.type !== CHART_MESSAGE_PART_TYPE) return null;
  const validated = validateChartDirectiveData(part.data);
  if (!validated.ok) return null;
  return {
    type: CHART_MESSAGE_PART_TYPE,
    id: String(part.id),
    data: validated.data,
  };
}

/** `chart:<hash>` — same `<family>:<shortHash>` id convention the json-render
 *  and mcp-app parts use, so identical re-emits dedupe by construction. */
function chartPartId(data: unknown): string {
  return `chart:${shortHash(JSON.stringify(data))}`;
}

function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
