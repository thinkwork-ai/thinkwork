/**
 * Convert a string to a URL/filesystem-safe slug.
 * Lowercases, replaces non-alphanumeric runs with hyphens, trims leading/trailing hyphens,
 * and caps at `maxLength` characters (default 80).
 */
export function slugify(value: string, maxLength = 80): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}
