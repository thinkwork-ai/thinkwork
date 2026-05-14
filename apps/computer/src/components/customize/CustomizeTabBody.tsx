import { useCallback, useMemo, useState } from "react";
import { Sheet } from "@thinkwork/ui";
import {
  ALL_CATEGORIES,
  CustomizeToolbar,
} from "./CustomizeToolbar";
import { CustomizeTable } from "./CustomizeTable";
import { CustomizeDetailSheet } from "./CustomizeDetailSheet";
import {
  filterCustomizeItems,
  uniqueCategories,
  type CustomizeItem,
} from "./customize-filtering";
import type { CUSTOMIZE_TABS } from "@/routes/_authed/_shell/customize";

export interface CustomizeTabBodyProps {
  activeTab: (typeof CUSTOMIZE_TABS)[number]["to"];
  items: CustomizeItem[];
  searchPlaceholder?: string;
  emptyMessage?: string;
  /** Stub for U4-U6 — receives the toggle event but does nothing in the inert shell. */
  onAction?: (id: string, nextConnected: boolean) => void;
}

/**
 * Shared body chrome for the Skills / Workflows tabs. Owns
 * the per-page toolbar (search left, tabs centered, category right),
 * the DataTable below it, and the side Sheet that opens when a row is
 * clicked. Real data wiring lands in U4-U6.
 */
export function CustomizeTabBody({
  activeTab,
  items,
  searchPlaceholder,
  emptyMessage,
  onAction,
}: CustomizeTabBodyProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [selected, setSelected] = useState<CustomizeItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const categories = useMemo(() => uniqueCategories(items), [items]);
  const filtered = useMemo(
    () =>
      filterCustomizeItems({ items, search, category }).slice().sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [items, search, category],
  );

  const handleRowClick = useCallback((item: CustomizeItem) => {
    setSelected(item);
    setSheetOpen(true);
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <CustomizeToolbar
        activeTab={activeTab}
        search={search}
        onSearchChange={setSearch}
        category={category}
        categories={categories}
        onCategoryChange={setCategory}
        searchPlaceholder={searchPlaceholder}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
        <CustomizeTable
          items={filtered}
          emptyMessage={emptyMessage}
          onRowClick={handleRowClick}
        />
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        {selected ? (
          <CustomizeDetailSheet item={selected} onAction={onAction} />
        ) : null}
      </Sheet>
    </div>
  );
}
