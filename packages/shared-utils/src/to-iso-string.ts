/**
 * Safely convert a Date, date-string, or nullish value to an ISO string.
 * Returns null if the input is nullish or results in an invalid date.
 */
export function toIsoString(
  value: Date | string | number | null | undefined,
): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}
