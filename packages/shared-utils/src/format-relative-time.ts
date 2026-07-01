/**
 * Format a timestamp as a human-readable relative time string (e.g. "just now", "5m ago", "3d ago").
 * Accepts ISO date strings, epoch-ms numbers, or Date objects.
 */
export function formatRelativeTime(
  value: string | number | Date | null | undefined,
): string {
  if (value == null) return "";
  const ts = typeof value === "number" ? value : new Date(value).getTime();
  if (!Number.isFinite(ts)) return "";

  const diff = Date.now() - ts;
  const absDiff = Math.abs(diff);
  const mins = Math.floor(absDiff / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (diff < 0) {
    if (mins < 1) return "in a moment";
    if (mins < 60) return `in ${mins}m`;
    if (hours < 24) return `in ${hours}h`;
    if (days < 30) return `in ${days}d`;
    return formatDateCompact(new Date(ts));
  }

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return formatDateCompact(new Date(ts));
}

function formatDateCompact(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
