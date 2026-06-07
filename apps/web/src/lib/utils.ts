export { cn } from "@thinkwork/ui";

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeTime(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffSec = Math.round((now - then) / 1000);

  // Future dates
  if (diffSec < 0) {
    const absSec = Math.abs(diffSec);
    if (absSec < 60) return "in a moment";
    const absMin = Math.round(absSec / 60);
    if (absMin < 60) return `in ${absMin}m`;
    const absHr = Math.round(absMin / 60);
    if (absHr < 24) return `in ${absHr}h`;
    const absDay = Math.round(absHr / 24);
    if (absDay < 30) return `in ${absDay}d`;
    return formatDate(date);
  }

  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return formatDate(date);
}
