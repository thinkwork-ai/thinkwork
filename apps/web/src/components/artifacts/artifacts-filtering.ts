import type { AppArtifactPreview } from "@/lib/app-artifacts";

export const ALL_KINDS = "__all__" as const;
export const TAB_ALL = "all" as const;

/**
 * Single row in the Artifacts list. A flat projection of
 * `AppArtifactPreview` containing only the fields the table renders or
 * filters on. Built via `toArtifactItem`.
 */
export interface ArtifactItem {
  id: string;
  /** Underlying Artifact id (different from `id`, which is the App id).
   * Required for favorite/delete mutations on rows. */
  artifactId: string | null;
  title: string;
  /** "applet" today; future kinds (chart, document) extend without code change. */
  kind: string;
  modelId: string | null;
  stdlibVersion: string | null;
  /** ISO timestamp; may be empty when the upstream payload is missing it. */
  generatedAt: string;
  favoritedAt: string | null;
  version: number | null;
}

export function toArtifactItem(preview: AppArtifactPreview): ArtifactItem {
  return {
    id: preview.id,
    artifactId: preview.artifactId ?? null,
    title: preview.title,
    kind: preview.kind,
    modelId: preview.modelId ?? null,
    stdlibVersion: preview.stdlibVersionAtGeneration ?? null,
    generatedAt: preview.generatedAt ?? "",
    favoritedAt: preview.favoritedAt ?? null,
    version: preview.version ?? null,
  };
}

export interface FilterArtifactItemsInput {
  items: ArtifactItem[];
  search: string;
  /** ALL_KINDS or a concrete kind value. Applied on top of the tab. */
  kind: string;
  /** TAB_ALL or a concrete kind value. */
  tab: string;
}

export function filterArtifactItems({
  items,
  search,
  kind,
  tab,
}: FilterArtifactItemsInput): ArtifactItem[] {
  const needle = search.trim().toLowerCase();
  return items.filter((item) => {
    if (tab !== TAB_ALL && item.kind !== tab) return false;
    if (kind !== ALL_KINDS && item.kind !== kind) return false;
    if (needle) {
      const haystack =
        `${item.title} ${item.modelId ?? ""} ${item.kind}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function uniqueKinds(items: ArtifactItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (item.kind) set.add(item.kind);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// --- Sort ----------------------------------------------------------------

export const SORT_GENERATED = "generatedAt" as const;
export const SORT_NAME = "name" as const;
export type ArtifactSortBy = typeof SORT_GENERATED | typeof SORT_NAME;

export const DEFAULT_SORT_BY: ArtifactSortBy = SORT_GENERATED;

/**
 * Sort artifacts client-side. Two modes:
 *  - "name": title ascending, case-insensitive via localeCompare.
 *  - "generatedAt": full ISO timestamp descending (newest first), so two
 *    items created on the same calendar date are ordered by time-of-day
 *    even though the column only shows the date. Items with empty
 *    generatedAt sort last in both modes.
 */
export function sortArtifactItems(
  items: ArtifactItem[],
  sortBy: ArtifactSortBy,
): ArtifactItem[] {
  const sorted = items.slice();
  if (sortBy === SORT_NAME) {
    sorted.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
    return sorted;
  }
  // SORT_GENERATED — descending, empty timestamps last.
  sorted.sort((a, b) => {
    if (!a.generatedAt && !b.generatedAt) return 0;
    if (!a.generatedAt) return 1;
    if (!b.generatedAt) return -1;
    // ISO 8601 strings sort lexicographically the same way they sort as
    // dates, so plain string compare is correct here.
    if (a.generatedAt > b.generatedAt) return -1;
    if (a.generatedAt < b.generatedAt) return 1;
    return 0;
  });
  return sorted;
}
