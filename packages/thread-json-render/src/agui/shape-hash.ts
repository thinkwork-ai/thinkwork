/**
 * Result-shape hashing for data-source bindings (Living Artifacts / THINK-145,
 * KTD4).
 *
 * A binding records the tool call that produced a widget's data. On refresh
 * (U6) the saved call is re-invoked and its result-shape hash is compared
 * against the stored one: a match means the data slice can be re-applied to the
 * existing spec; a mismatch is a schema-refresh escalation (R7) — the spec must
 * be re-emitted, never re-rendered against a changed shape.
 *
 * The hash is over the SORTED KEY STRUCTURE of the value, never its values, so
 * it is stable across value changes (numbers/strings churn every refresh) and
 * changes only when the structure changes (keys added/removed, a field's type
 * flips, an array's element shape changes).
 */

/**
 * Canonical, value-free shape string for an arbitrary JSON value.
 *
 * - primitives → their type token (`string` | `number` | `boolean`)
 * - null / undefined → `null`
 * - arrays → `[<union of distinct element shapes, sorted>]` (empty → `[]`)
 * - objects → `{key:<shape>,…}` with keys sorted
 */
export function canonicalResultShape(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const variants = Array.from(
      new Set(value.map((item) => canonicalResultShape(item))),
    ).sort();
    return `[${variants.join("|")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, nested]) =>
          `${JSON.stringify(key)}:${canonicalResultShape(nested)}`,
      );
    return `{${entries.join(",")}}`;
  }
  // Primitive: encode the type, not the value.
  return typeof value;
}

/**
 * Stable FNV-1a hash of a value's canonical shape (mirrors the spec-hash style
 * in `hash.ts`). Same structure → same hash regardless of values.
 */
export function resultShapeHash(value: unknown): string {
  const serialized = canonicalResultShape(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `shape-fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
