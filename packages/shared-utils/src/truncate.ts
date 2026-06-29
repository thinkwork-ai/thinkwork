/**
 * Truncate a string to a maximum length, appending an ellipsis if truncated.
 */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
