/** Shared helpers for the Knowledge Model sub-views (Identity, Resolution Queue). */

/**
 * Defensive AWSJSON parser: candidates / conflicting claims arrive as JSON
 * strings from the API but may be malformed or shaped unexpectedly. Returns
 * only plain-object entries; anything else yields [].
 */
export function parseJsonObjectArray(
  value: unknown,
): Record<string, unknown>[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry),
    );
  } catch {
    return [];
  }
}

/**
 * Source-safe one-line summary of a resolution candidate. Only surfaces
 * identity-shaped string fields — never arbitrary payload content.
 */
export function candidateSummary(candidate: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of [
    "displayName",
    "name",
    "label",
    "canonicalEntityId",
    "sourceSystem",
    "namespace",
    "externalId",
  ]) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) {
      parts.push(
        key === "displayName" || key === "name" || key === "label"
          ? value
          : `${key}: ${value}`,
      );
    }
  }
  return parts.length > 0 ? parts.join(" · ") : "Unnamed candidate";
}

/** Compact relative age, e.g. "3d ago". Falls back to "—" for bad input. */
export function relativeAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
