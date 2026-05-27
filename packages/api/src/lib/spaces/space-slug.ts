export function normalizeSpaceSlug(value: string, fallback = "space"): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || fallback
  );
}

export function normalizeExplicitSpaceSlug(value: string): string {
  return normalizeSpaceSlug(value, "");
}
