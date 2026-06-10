/**
 * Compact relative-time formatting ("now", "5m", "3h", "2d", "4w", "6mo",
 * "1y"). Shared by the chat sidebar thread rows and the answered
 * UserQuestionCard byline.
 */
export function formatTinyRelativeDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const elapsedMs = Math.max(Date.now() - date.getTime(), 0);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d`;
  const elapsedWeeks = Math.floor(elapsedDays / 7);
  if (elapsedWeeks < 5) return `${elapsedWeeks}w`;
  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) return `${Math.max(elapsedMonths, 1)}mo`;
  return `${Math.floor(elapsedDays / 365)}y`;
}
