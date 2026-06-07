import { ALL_CATEGORIES } from "./CustomizeToolbar";

/**
 * Single item in the Customize catalog. Same shape across Skills and
 * Workflows. `connected` reflects whether the caller's
 * Computer has an active binding row for this catalog entry.
 */
export interface CustomizeItem {
  /** Stable identifier — slug or row id; used for action callbacks. */
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  iconUrl?: string | null;
  /** First-letter or short label rendered when no `iconUrl` is supplied. */
  iconFallback?: string;
  /** Optional badge (e.g., "MCP") rendered next to the name. */
  typeBadge?: string;
  connected: boolean;
  /** Optional: when set, the item is preferred for "Discover" / "Popular" pinning. */
  featured?: boolean;
}

export interface FilterCustomizeItemsInput {
  items: CustomizeItem[];
  search: string;
  category: string;
}

export function filterCustomizeItems({
  items,
  search,
  category,
}: FilterCustomizeItemsInput): CustomizeItem[] {
  const needle = search.trim().toLowerCase();
  return items.filter((item) => {
    if (category !== ALL_CATEGORIES) {
      const itemCat = item.category ?? null;
      if (itemCat !== category) return false;
    }
    if (needle) {
      const haystack =
        `${item.name} ${item.description ?? ""} ${item.category ?? ""}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function uniqueCategories(items: CustomizeItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (item.category) set.add(item.category);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
