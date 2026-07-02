import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type Table as TanStackTable,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Check, CircleMinus, Layers3, Search, Target, X } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  DataTableTokenFilter,
  Input,
  dataTableTokenFilterFns,
  type DataTableTokenFilterColumn,
} from "@thinkwork/ui";

import type { EngagementAccount } from "../data/useTwentyEngagementData";

const ACCOUNT_INDEX_PAGE_SIZE = 50;

const ACCOUNT_FILTER_COLUMNS = {
  search: "filterSearch",
  readiness: "filterReadiness",
  opportunities: "filterOpportunities",
  mapped: "filterMapped",
} as const;

type AccountRow = {
  id: string;
  name: string;
  domain: string;
  opportunities: number;
  mappedLayers: number;
  readyLayers: number;
};

export function AccountIndexPage({
  accounts,
  onSelectAccount,
}: {
  accounts: EngagementAccount[];
  onSelectAccount: (accountId: string) => void;
}) {
  const rows = useMemo<AccountRow[]>(
    () =>
      accounts.map((account) => {
        const metrics = accountMetrics(account);
        return {
          id: account.company.id,
          name: account.company.name,
          domain: account.company.domainName ?? "No domain",
          opportunities: metrics.opportunities,
          mappedLayers: metrics.mappedLayers,
          readyLayers: metrics.readyLayers,
        };
      }),
    [accounts],
  );

  const tokenFilterColumns = useMemo(buildAccountTokenFilterColumns, []);
  const filterColumns = useMemo(buildAccountFilterColumns, []);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const filterTable = useReactTable({
    data: rows,
    columns: filterColumns,
    autoResetPageIndex: false,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const filteredRows = filterTable
    .getFilteredRowModel()
    .rows.map((row) => row.original);

  const columns = useMemo<ColumnDef<AccountRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Account",
        meta: {
          headClassName: "w-1/2 min-w-0",
          cellClassName: "w-1/2 min-w-0 max-w-0",
        },
        cell: ({ row }) => (
          <span
            className="block truncate text-sm font-semibold text-foreground"
            title={row.original.name}
          >
            {row.original.name}
          </span>
        ),
      },
      {
        accessorKey: "domain",
        header: "Domain",
        meta: {
          headClassName: "w-1/2 min-w-0",
          cellClassName: "w-1/2 min-w-0 max-w-0",
        },
        cell: ({ row }) => (
          <span
            className="block truncate text-sm text-muted-foreground"
            title={row.original.domain}
          >
            {row.original.domain}
          </span>
        ),
      },
      {
        accessorKey: "opportunities",
        header: "Opportunities",
        meta: {
          headClassName: "w-px whitespace-nowrap text-center",
          cellClassName: "w-px whitespace-nowrap text-center",
        },
        cell: ({ row }) => (
          <span className="text-sm font-medium text-foreground">
            {row.original.opportunities}
          </span>
        ),
      },
      {
        accessorKey: "mappedLayers",
        header: "Mapped",
        meta: {
          headClassName: "w-px whitespace-nowrap text-center",
          cellClassName: "w-px whitespace-nowrap text-center",
        },
        cell: ({ row }) => (
          <span className="text-sm font-medium text-foreground">
            {row.original.mappedLayers}
          </span>
        ),
      },
      {
        accessorKey: "readyLayers",
        header: "Ready",
        meta: {
          headClassName: "w-px whitespace-nowrap text-center",
          cellClassName: "w-px whitespace-nowrap text-center",
        },
        cell: ({ row }) => (
          <Badge variant="outline" className="min-w-8 justify-center">
            {row.original.readyLayers}
          </Badge>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background p-6">
      <header className="mb-8 shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Client Engagement
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review Twenty CRM accounts, opportunity coverage, mapped layers, and
          readiness.
        </p>
      </header>

      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <AccountToolbarSearch table={filterTable} />
        <DataTableTokenFilter
          table={filterTable}
          columns={tokenFilterColumns}
          addLabel="Filter"
          showAddLabel={false}
          clearLabel="Clear filters"
          flattenToolbar
          className="max-w-full [&_[data-token-filter-token]]:shrink-0"
          popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <DataTable
          columns={columns}
          data={filteredRows}
          onRowClick={(row) => onSelectAccount(row.id)}
          allowHorizontalScroll={false}
          pageSize={ACCOUNT_INDEX_PAGE_SIZE}
          scrollable
          tableClassName="w-full table-auto"
          emptyState="No Twenty CRM accounts found."
          emptyStatePlacement="container"
        />
      </div>
    </div>
  );
}

function accountMetrics(account: EngagementAccount) {
  return {
    opportunities: account.opportunities.length,
    mappedLayers: account.opportunities.reduce(
      (total, item) => total + item.layers.length,
      0,
    ),
    readyLayers: account.opportunities.reduce(
      (total, item) =>
        total +
        item.layers.filter(
          (layer) =>
            layer.layerStatus === "READY_FOR_SOW" ||
            layer.layerStatus === "APPROVED",
        ).length,
      0,
    ),
  };
}

function AccountToolbarSearch({ table }: { table: TanStackTable<AccountRow> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const searchFilter = table
    .getState()
    .columnFilters.find(
      (filter) => filter.id === ACCOUNT_FILTER_COLUMNS.search,
    )?.value;
  const searchValue =
    isTextFilterValue(searchFilter) && typeof searchFilter.value === "string"
      ? searchFilter.value
      : "";
  const isOpen = expanded || searchValue.length > 0;

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const setSearchValue = (value: string) => {
    const trimmed = value.trimStart();
    table.getColumn(ACCOUNT_FILTER_COLUMNS.search)?.setFilterValue(
      trimmed
        ? {
            operator: "contains",
            value: trimmed,
          }
        : undefined,
    );
    table.setPageIndex(0);
  };

  const clearSearch = () => {
    setSearchValue("");
    setExpanded(false);
  };

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="h-8 w-8 rounded-md"
        aria-label="Search accounts"
        onClick={() => setExpanded(true)}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className="relative flex h-8 w-[min(16rem,calc(100vw-2rem))] items-center">
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        aria-label="Search accounts"
        placeholder="Search accounts..."
        className="h-8 rounded-md border-transparent bg-transparent pl-8 pr-8 text-sm shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        value={searchValue}
        onChange={(event) => setSearchValue(event.target.value)}
        onBlur={() => {
          if (!searchValue) setExpanded(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            clearSearch();
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute right-1 h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
        aria-label="Clear account search"
        onMouseDown={(event) => event.preventDefault()}
        onClick={clearSearch}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

function buildAccountTokenFilterColumns(): DataTableTokenFilterColumn[] {
  return [
    {
      id: ACCOUNT_FILTER_COLUMNS.readiness,
      label: "Readiness",
      type: "option",
      icon: <Check className="size-4" aria-hidden="true" />,
      options: [
        {
          value: "ready",
          label: "Has ready layers",
          icon: (
            <Check className="size-4 text-emerald-500" aria-hidden="true" />
          ),
        },
        {
          value: "not_ready",
          label: "No ready layers",
          icon: (
            <CircleMinus
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          ),
        },
      ],
    },
    {
      id: ACCOUNT_FILTER_COLUMNS.opportunities,
      label: "Opportunities",
      type: "option",
      icon: <Target className="size-4" aria-hidden="true" />,
      options: [
        {
          value: "has_opportunities",
          label: "Has opportunities",
          icon: <Target className="size-4 text-blue-500" aria-hidden="true" />,
        },
        {
          value: "no_opportunities",
          label: "No opportunities",
          icon: (
            <CircleMinus
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          ),
        },
      ],
    },
    {
      id: ACCOUNT_FILTER_COLUMNS.mapped,
      label: "Mapped",
      type: "option",
      icon: <Layers3 className="size-4" aria-hidden="true" />,
      options: [
        {
          value: "mapped",
          label: "Has mapped layers",
          icon: (
            <Layers3 className="size-4 text-violet-500" aria-hidden="true" />
          ),
        },
        {
          value: "not_mapped",
          label: "No mapped layers",
          icon: (
            <CircleMinus
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          ),
        },
      ],
    },
  ];
}

function buildAccountFilterColumns(): Array<ColumnDef<AccountRow, unknown>> {
  return [
    {
      id: ACCOUNT_FILTER_COLUMNS.search,
      accessorFn: accountSearchText,
      filterFn: dataTableTokenFilterFns.text,
    },
    {
      id: ACCOUNT_FILTER_COLUMNS.readiness,
      accessorFn: (account) =>
        account.readyLayers > 0 ? "ready" : "not_ready",
      filterFn: dataTableTokenFilterFns.option,
    },
    {
      id: ACCOUNT_FILTER_COLUMNS.opportunities,
      accessorFn: (account) =>
        account.opportunities > 0 ? "has_opportunities" : "no_opportunities",
      filterFn: dataTableTokenFilterFns.option,
    },
    {
      id: ACCOUNT_FILTER_COLUMNS.mapped,
      accessorFn: (account) =>
        account.mappedLayers > 0 ? "mapped" : "not_mapped",
      filterFn: dataTableTokenFilterFns.option,
    },
  ];
}

function accountSearchText(account: AccountRow) {
  return [account.name, account.domain].filter(Boolean).join(" ");
}

function isTextFilterValue(
  value: unknown,
): value is { operator: "contains"; value: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { operator?: unknown }).operator === "contains" &&
    typeof (value as { value?: unknown }).value === "string"
  );
}
