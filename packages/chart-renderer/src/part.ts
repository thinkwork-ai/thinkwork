/**
 * The `data-chart` message part — the wire shape that carries one validated
 * chart from the agent runtime to any client surface (THINK-672).
 *
 * Follows the `data-json-render` part convention: a typed entry in the
 * message's `parts` jsonb array. The server is the single validator — a part
 * that reaches a client is trusted shape-wise; clients still render defensively.
 */

import type { ChartDirectiveData } from "./types.js";
import { validateChartDirectiveData } from "./validate.js";

export const CHART_MESSAGE_PART_TYPE = "data-chart" as const;

export interface ChartMessagePart {
  type: typeof CHART_MESSAGE_PART_TYPE;
  /** Stable per-message part id (used for dedupe and keys). */
  id: string;
  data: ChartDirectiveData;
}

/**
 * Validate an unknown value as a ChartMessagePart. Returns the normalized
 * part, or null when the value is not a valid chart part (callers decide
 * whether that means "skip" or "reject").
 */
export function validateChartMessagePart(
  part: unknown,
): ChartMessagePart | null {
  if (typeof part !== "object" || part === null || Array.isArray(part)) {
    return null;
  }
  const rec = part as Record<string, unknown>;
  if (rec.type !== CHART_MESSAGE_PART_TYPE) return null;
  if (typeof rec.id !== "string" || rec.id.trim() === "") return null;
  const result = validateChartDirectiveData(rec.data);
  if (!result.ok) return null;
  return { type: CHART_MESSAGE_PART_TYPE, id: rec.id, data: result.data };
}
