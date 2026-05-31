export function normalizeWorkspaceFolderName(
  value: string,
  fallback = "workspace",
): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

export function workspaceFolderName(
  displayName: string,
  existingSiblings: Iterable<string | null | undefined>,
  fallback = "workspace",
): string {
  const base = normalizeWorkspaceFolderName(displayName, fallback);
  const occupied = new Set(
    Array.from(existingSiblings)
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizeWorkspaceFolderName(value, fallback)),
  );

  if (!occupied.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }

  throw new Error(`Could not generate a unique workspace folder for ${base}`);
}
