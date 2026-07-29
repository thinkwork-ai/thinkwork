/**
 * Postgres rejects U+0000 in `text` and `jsonb` values (codes 22021/22P05).
 * A tool result that leaks NUL bytes into the turn transcript — e.g. a binary
 * attachment decoded as text — would otherwise fail the thread_turn update and
 * assistant-message insert, leaving the turn stuck in `running` until the
 * stall monitor mislabels it "Stall detected". Strip NULs from every string
 * before persistence so no tool output can wedge a turn.
 */
export function stripNulDeep<T>(value: T): T {
  if (typeof value === "string") {
    return value.replaceAll("\u0000", "") as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stripNulDeep(entry)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key.replaceAll("\u0000", "")] = stripNulDeep(entry);
    }
    return out as T;
  }
  return value;
}
