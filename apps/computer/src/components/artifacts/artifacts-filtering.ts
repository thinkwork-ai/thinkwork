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
  title: string;
  /** "applet" today; future kinds (chart, document) extend without code change. */
  kind: string;
  modelId: string | null;
  stdlibVersion: string | null;
  /** ISO timestamp; may be empty when the upstream payload is missing it. */
  generatedAt: string;
  version: number | null;
}

export function toArtifactItem(preview: AppArtifactPreview): ArtifactItem {
  return {
    id: preview.id,
    title: preview.title,
    kind: preview.kind,
    modelId: preview.modelId ?? null,
    stdlibVersion: preview.stdlibVersionAtGeneration ?? null,
    generatedAt: preview.generatedAt ?? "",
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
