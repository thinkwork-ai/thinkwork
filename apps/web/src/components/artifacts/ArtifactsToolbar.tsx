import { useMemo, useState } from "react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { User } from "lucide-react";
import { CollapsedFilterSearch } from "./CollapsedFilterSearch";
import {
  DataTableTokenFilter,
  type DataTableTokenFilterColumn,
} from "@thinkwork/ui";

export interface ArtifactsToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  /**
   * Operator-only: a "User" token filter. Distinct from the content `search`
   * field — this scopes the list to one user's applets via the admin query.
   * Hidden for non-operators.
   */
  showUserFilter?: boolean;
  userIdFilter?: string;
  onUserIdFilterChange?: (value: string) => void;
  /** Tenant members the operator can pick from (value = user id). */
  userOptions?: Array<{ value: string; label: string }>;
  usersLoading?: boolean;
}

const FILTER_COLUMNS = {
  user: "filterUser",
} as const;

/** Extract the picked user id from the single-select option filter value. */
function selectedUserIdOf(filters: ColumnFiltersState, id: string): string {
  const value = filters.find((filter) => filter.id === id)?.value;
  if (!value || typeof value !== "object" || !("value" in value)) return "";
  const raw = (value as { value: unknown }).value;
  if (typeof raw === "string") return raw;
  return Array.isArray(raw) && typeof raw[0] === "string" ? raw[0] : "";
}

/**
 * Work Items-convention toolbar (collapsed search icon + token filters).
 * The filter table carries no rows — filtering happens upstream (content
 * search client-side, the user filter via the admin query) — it exists so
 * DataTableTokenFilter has state to drive.
 */
export function ArtifactsToolbar({
  search,
  onSearchChange,
  showUserFilter = false,
  onUserIdFilterChange,
  userOptions = [],
  usersLoading = false,
}: ArtifactsToolbarProps) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const filterColumns = useMemo<ColumnDef<Record<string, never>>[]>(
    () => [{ id: FILTER_COLUMNS.user, accessorFn: () => "" }],
    [],
  );

  const filterTable = useReactTable({
    data: EMPTY_ROWS,
    columns: filterColumns,
    state: { columnFilters },
    onColumnFiltersChange: (updater) => {
      setColumnFilters((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        onUserIdFilterChange?.(selectedUserIdOf(next, FILTER_COLUMNS.user));
        return next;
      });
    },
    getCoreRowModel: getCoreRowModel(),
  });

  const tokenFilterColumns = useMemo<DataTableTokenFilterColumn[]>(
    () =>
      showUserFilter
        ? [
            {
              id: FILTER_COLUMNS.user,
              label: "User",
              type: "option",
              singleSelect: true,
              icon: <User className="size-4" />,
              options: userOptions,
              loading: usersLoading,
              loadingMessage: "Loading users...",
              emptyMessage: "No users found.",
            },
          ]
        : [],
    [showUserFilter, userOptions, usersLoading],
  );

  return (
    <div
      className="relative z-10 flex shrink-0 flex-wrap items-center gap-2 px-6 pb-3"
      data-testid="artifacts-toolbar"
    >
      <CollapsedFilterSearch
        value={search}
        onChange={onSearchChange}
        label="Search artifacts"
        placeholder="Search artifacts..."
      />
      {showUserFilter ? (
        <DataTableTokenFilter
          table={filterTable}
          columns={tokenFilterColumns}
          addLabel="Filter"
          showAddLabel={false}
          clearLabel="Clear filters"
          flattenToolbar
          className="max-w-full"
          popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
        />
      ) : null}
    </div>
  );
}

const EMPTY_ROWS: Record<string, never>[] = [];
