/**
 * Bounds the serialized size of message payload fields (parts, toolCalls,
 * toolResults, metadata, content) on the GraphQL read path.
 *
 * Rows persist tool output verbatim, so a single agent turn that ingests a
 * large report can leave multi-megabyte tool_results on a message. A thread
 * of such messages serializes past Lambda's hard 6MB response limit and the
 * invocation dies with RequestEntityTooLarge — the client then renders
 * "[Network] No Content" and the thread is unopenable. The database keeps
 * the full data; only the wire representation is capped here.
 *
 * Strategy per field:
 *   1. Under FIELD_BYTE_CAP serialized → returned untouched (same reference).
 *   2. Over the cap → deep-copy with string leaves truncated to
 *      STRING_LEAF_CAP characters.
 *   3. Still over the cap (many small leaves) → replace the field wholesale:
 *      `parts` becomes a single renderable text part (clients render parts
 *      directly, so the replacement must stay a valid parts array); opaque
 *      JSON fields become `{ __truncated: true, originalBytes }`.
 */

export const FIELD_BYTE_CAP = 262_144; // 256 KiB per payload field
export const STRING_LEAF_CAP = 16_384; // per string leaf, in UTF-8 bytes
export const TRUNCATION_MARKER = "… [truncated]";

function byteSize(value: unknown): number {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return serialized ? Buffer.byteLength(serialized, "utf8") : 0;
}

// Largest prefix whose UTF-8 byte length fits maxBytes. Caps are byte
// budgets, but String.prototype.slice counts UTF-16 code units — a char
// slice under-truncates multi-byte content by up to 4x. Bisect on
// character index so we never cut mid-codepoint (same pattern as
// sanitizeStringField in lib/compliance/redaction.ts).
function truncateToBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (Buffer.byteLength(value.slice(0, mid), "utf8") <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return value.slice(0, lo) + TRUNCATION_MARKER;
}

function truncateStringLeaves(value: unknown): unknown {
  if (typeof value === "string") {
    return truncateToBytes(value, STRING_LEAF_CAP);
  }
  if (Array.isArray(value)) return value.map(truncateStringLeaves);
  if (value && typeof value === "object") {
    // Null prototype so a "__proto__" key in arbitrary tool JSON copies
    // as an own property instead of silently vanishing into [[Prototype]].
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value)) {
      out[k] = truncateStringLeaves(v);
    }
    return out;
  }
  return value;
}

type FieldKind = "parts" | "json" | "text";

function capField(value: unknown, kind: FieldKind): unknown {
  if (value === null || value === undefined) return value;

  // jsonb fields normally arrive as parsed objects, but tolerate rows where
  // the payload is a pre-serialized JSON string: cap the parsed form and
  // re-serialize so we never slice mid-JSON.
  if (kind !== "text" && typeof value === "string") {
    if (byteSize(value) <= FIELD_BYTE_CAP) return value;
    try {
      return JSON.stringify(capField(JSON.parse(value), kind));
    } catch {
      // Not JSON after all — fall through to plain text handling.
      return capField(value, "text");
    }
  }

  const originalBytes = byteSize(value);
  if (originalBytes <= FIELD_BYTE_CAP) return value;

  if (kind === "text") {
    return truncateToBytes(value as string, FIELD_BYTE_CAP);
  }

  const trimmed = truncateStringLeaves(value);
  if (byteSize(trimmed) <= FIELD_BYTE_CAP) return trimmed;

  if (kind === "parts") {
    return [
      {
        type: "text",
        text: `[Message payload truncated: ${Math.round(originalBytes / 1024)} KB exceeds the response size limit.]`,
      },
    ];
  }
  // Preserve the container shape: consumers iterate these AWSJSON fields
  // (e.g. mobile ChatBubble filters message.toolResults), so an array
  // must stay an array or the client render throws.
  const stub = { __truncated: true, originalBytes };
  return Array.isArray(value) ? [stub] : stub;
}

const PAYLOAD_FIELDS: [key: string, kind: FieldKind][] = [
  ["parts", "parts"],
  ["toolCalls", "json"],
  ["toolResults", "json"],
  ["metadata", "json"],
  ["content", "text"],
];

/**
 * Caps the payload fields of a camelCase GraphQL message node. Returns the
 * node unchanged (same reference) when every field is under the cap.
 */
export function capMessagePayloads(
  node: Record<string, unknown>,
): Record<string, unknown> {
  let result: Record<string, unknown> | null = null;
  for (const [key, kind] of PAYLOAD_FIELDS) {
    const value = node[key];
    const capped = capField(value, kind);
    if (capped !== value) {
      result ??= { ...node };
      result[key] = capped;
    }
  }
  return result ?? node;
}
