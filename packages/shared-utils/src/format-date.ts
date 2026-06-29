/**
 * Format a date as "Mon DD, YYYY" (e.g. "Jan 5, 2025").
 */
export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a date as "Mon DD, YYYY HH:MM AM/PM" (e.g. "Jan 5, 2025, 3:45 PM").
 */
export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
