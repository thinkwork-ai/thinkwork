/**
 * Living Artifacts (THINK-145 U10): parse a living-canvas artifact payload.
 *
 * A living canvas stores its head (and each pinned version) as the stably-
 * stringified persisted json-render PART — `{ type: "data-json-render", id,
 * data }` — NOT the retired promote-copy snapshot envelope. This
 * extracts the `{ id, data }` the thread json-render renderer consumes.
 */

const LIVING_CANVAS_PART_TYPE = "data-json-render";

export interface LivingCanvasPart {
  /** The part's stable id (used as the renderer partId). */
  id: string;
  /** The ThreadJsonRenderData payload the renderer validates + renders. */
  data: unknown;
}

export function parseLivingCanvasPart(
  content: string | null | undefined,
): LivingCanvasPart | null {
  if (!content) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.type !== LIVING_CANVAS_PART_TYPE ||
    typeof record.id !== "string" ||
    record.data === null ||
    typeof record.data !== "object"
  ) {
    return null;
  }
  return { id: record.id, data: record.data };
}

/** True when the artifact's metadata marks it a living GenUI canvas. */
export function isLivingCanvasMetadata(metadata: unknown): boolean {
  const record = coerceRecord(metadata);
  return record?.kind === "json_render_canvas";
}

function coerceRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return coerceRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
