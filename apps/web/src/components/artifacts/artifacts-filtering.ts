import type { AppArtifactPreview } from "@/lib/app-artifacts";

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
  /** Display name of the user who generated the artifact (resolved via the
   * source thread). Null when the artifact has no associated user. */
  userName: string | null;
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
    userName: preview.userName ?? null,
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
}

export function filterArtifactItems({
  items,
  search,
}: FilterArtifactItemsInput): ArtifactItem[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => {
    const haystack =
      `${item.title} ${item.modelId ?? ""} ${item.userName ?? ""}`.toLowerCase();
    return haystack.includes(needle);
  });
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
