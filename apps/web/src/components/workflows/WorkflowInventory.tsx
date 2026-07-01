import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type Table as TanStackTable,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useQuery } from "urql";
import {
  Badge,
  Button,
  DataTable,
  DataTableTokenFilter,
  dataTableTokenFilterFns,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  type DataTableTokenFilterColumn,
} from "@thinkwork/ui";
import { CircleDot, GitBranch, Plug, Search, X } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { SettingsWorkflowsQuery } from "@/lib/graphql-queries";
import {
  SettingsDeploymentStatusQuery,
  SettingsPluginCatalogQuery,
} from "@/lib/settings-queries";
import { SettingsTablePane } from "@/components/settings/SettingsContent";
import { N8nPluginWorkflows } from "@/components/settings/plugins/n8n/N8nPluginWorkflows";
import {
  primaryBinding,
  sourceLabel,
  SourceBadge,
  titleize,
  type WorkflowBinding,
  WorkflowReadinessBadge,
} from "./workflow-ui";

type WorkflowRow = {
  id: string;
  name: string;
  description?: string | null;
  lifecycleStatus: string;
  primaryTriggerFamily: string;
  currentVersionNumber?: number | null;
  readinessState: string;
  readinessReasons?: unknown;
  bindings: WorkflowBinding[];
  triggers: Array<{
    id: string;
    triggerFamily: string;
    sourceSystem?: string | null;
    triggerConfig?: unknown;
    enabled: boolean;
    readinessState: string;
  }>;
  updatedAt?: string | null;
};

type WorkflowsData = {
  workflows: WorkflowRow[];
};

const N8N_WORKFLOWS_PATH = "/settings/plugins/n8n/workflows";
const WORKFLOW_FILTER_COLUMNS = {
  search: "workflowSearch",
  readiness: "workflowReadiness",
  source: "workflowSource",
  trigger: "workflowTrigger",
} as const;

function bindingFilterValue(row: WorkflowRow): string {
  return primaryBinding(row.bindings)?.bindingType ?? "unknown";
}

function workflowSearchText(row: WorkflowRow): string {
  return [
    row.name,
    row.description ?? "",
    row.primaryTriggerFamily,
    workflowTriggerLabel(row),
    sourceLabel(primaryBinding(row.bindings)),
    row.lifecycleStatus,
    row.readinessState,
  ]
    .join(" ")
    .toLowerCase();
}

function uniqueOptions(
  rows: WorkflowRow[],
  getValue: (row: WorkflowRow) => string,
) {
  return Array.from(new Set(rows.map(getValue).filter(Boolean))).sort();
}

export function WorkflowInventory() {
  const { tenantId } = useTenant();
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const ignoreDiscoveryState = useCallback(() => {}, []);

  const [result] = useQuery<WorkflowsData>({
    query: SettingsWorkflowsQuery,
    variables: { tenantId: tenantId ?? "", limit: 100 },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [catalogResult] = useQuery({
    query: SettingsPluginCatalogQuery,
    requestPolicy: "cache-and-network",
  });
  const [deploymentResult] = useQuery({
    query: SettingsDeploymentStatusQuery,
    requestPolicy: "cache-and-network",
  });

  const rows = useMemo(
    () => result.data?.workflows ?? [],
    [result.data?.workflows],
  );
  const n8nCatalogEntry =
    (catalogResult.data?.pluginCatalog ?? []).find(
      (candidate) => candidate.pluginKey === "n8n",
    ) ?? null;
  const n8nInstall = n8nCatalogEntry?.install ?? null;
  const n8nRuntime =
    deploymentResult.data?.deploymentStatus.managedApplications.find(
      (candidate) => candidate.key === "n8n",
    );
  const n8nLaunchUrl = n8nRuntime?.url ?? n8nCatalogEntry?.launchUrl ?? null;
  const canDiscoverN8n = Boolean(n8nInstall);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const tokenFilterColumns = useMemo(
    () => buildWorkflowTokenFilterColumns(rows),
    [rows],
  );
  const filterColumns = useMemo(() => buildWorkflowFilterColumns(), []);
  const filterTable = useReactTable({
    data: rows,
    columns: filterColumns,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const filteredRows = useMemo(
    () => filterTable.getFilteredRowModel().rows.map((row) => row.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterTable.getState().columnFilters, rows],
  );

  const columns = useMemo<ColumnDef<WorkflowRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Workflow",
        meta: {
          headClassName: "w-full min-w-[200px]",
          cellClassName: "w-full min-w-[200px] max-w-0",
        },
        cell: ({ row }) => (
          <Link
            to="/settings/workflows/$workflowId"
            params={{ workflowId: row.original.id }}
            className="block truncate font-medium text-foreground transition-colors hover:text-primary"
            title={row.original.name}
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "readinessStatus",
        header: "Status",
        meta: {
          headClassName: "w-px whitespace-nowrap",
          cellClassName: "w-px whitespace-nowrap",
        },
        cell: ({ row }) => (
          <WorkflowReadinessBadge
            state={row.original.readinessState}
            reasons={row.original.readinessReasons}
            showReason={false}
          />
        ),
      },
      {
        id: "source",
        header: "Source",
        meta: {
          headClassName: "w-px whitespace-nowrap text-center",
          cellClassName: "w-px whitespace-nowrap text-center",
        },
        cell: ({ row }) => {
          const binding = primaryBinding(row.original.bindings);
          const sourceLink = sourceLinkForBinding(n8nLaunchUrl, binding);
          const badge = <SourceBadge binding={binding} />;
          return sourceLink ? (
            <a
              href={sourceLink.href}
              target={sourceLink.external ? "_blank" : undefined}
              rel={sourceLink.external ? "noreferrer" : undefined}
              className="inline-flex transition-opacity hover:opacity-80"
              title={sourceLink.title}
            >
              {badge}
            </a>
          ) : (
            badge
          );
        },
      },
      {
        accessorKey: "primaryTriggerFamily",
        header: "Trigger",
        meta: {
          headClassName: "w-px whitespace-nowrap text-center",
          cellClassName: "w-px whitespace-nowrap text-center",
        },
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs">
            {workflowTriggerLabel(row.original)}
          </Badge>
        ),
      },
    ],
    [n8nLaunchUrl],
  );

  const loading = result.fetching && !result.data;

  return (
    <SettingsTablePane
      title="Workflows"
      description="Monitor workflows imported from routines, plugins, connected apps, and native ThinkWork sources."
      loading={loading}
      headerActions={
        canDiscoverN8n ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Discover n8n workflows"
            title="Discover n8n workflows"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setDiscoveryOpen(true)}
          >
            <Search className="size-4" />
          </Button>
        ) : null
      }
      headerActionKey={`workflow-discovery:${n8nInstall?.id ?? "missing"}`}
    >
      {result.error ? (
        <div className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
          {result.error.message}
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <WorkflowTableToolbar
            table={filterTable}
            tokenFilterColumns={tokenFilterColumns}
          />
          <div className="min-h-0 flex-1">
            <DataTable
              columns={columns}
              data={filteredRows}
              scrollable
              allowHorizontalScroll={false}
              pageSize={25}
              tableClassName="w-full table-auto"
              emptyState={
                <div className="py-10 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "No workflows have been imported yet."
                    : "No workflows match the current filters."}
                </div>
              }
            />
          </div>
        </div>
      )}
      <Sheet open={discoveryOpen} onOpenChange={setDiscoveryOpen}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(900px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
          <SheetHeader className="border-b border-border px-6 py-5">
            <SheetTitle>Discover n8n workflows</SheetTitle>
            <SheetDescription>
              Search available n8n workflows and connect them to ThinkWork.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 p-6">
            <N8nPluginWorkflows
              installId={n8nInstall?.id ?? null}
              launchUrl={n8nLaunchUrl}
              refreshNonce={0}
              onDiscoveryStateChange={ignoreDiscoveryState}
            />
          </div>
        </SheetContent>
      </Sheet>
    </SettingsTablePane>
  );
}

function buildWorkflowFilterColumns(): ColumnDef<WorkflowRow>[] {
  return [
    {
      id: WORKFLOW_FILTER_COLUMNS.search,
      accessorFn: workflowSearchText,
      filterFn: dataTableTokenFilterFns.text,
    },
    {
      id: WORKFLOW_FILTER_COLUMNS.readiness,
      accessorFn: (row) => row.readinessState,
      filterFn: dataTableTokenFilterFns.option,
    },
    {
      id: WORKFLOW_FILTER_COLUMNS.source,
      accessorFn: bindingFilterValue,
      filterFn: dataTableTokenFilterFns.option,
    },
    {
      id: WORKFLOW_FILTER_COLUMNS.trigger,
      accessorFn: workflowTriggerLabel,
      filterFn: dataTableTokenFilterFns.option,
    },
  ];
}

function WorkflowTableToolbar({
  table,
  tokenFilterColumns,
}: {
  table: TanStackTable<WorkflowRow>;
  tokenFilterColumns: DataTableTokenFilterColumn[];
}) {
  return (
    <div className="mb-3 flex shrink-0 items-center pt-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <WorkflowToolbarSearch table={table} />
        <DataTableTokenFilter
          table={table}
          columns={tokenFilterColumns}
          addLabel="Filter"
          showAddLabel={false}
          clearLabel="Clear filters"
          flattenToolbar
          className="max-w-full [&_[data-token-filter-token]]:shrink-0"
          popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
        />
      </div>
    </div>
  );
}
function WorkflowToolbarSearch({
  table,
}: {
  table: TanStackTable<WorkflowRow>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const searchFilter = table
    .getState()
    .columnFilters.find(
      (filter) => filter.id === WORKFLOW_FILTER_COLUMNS.search,
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

    table.getColumn(WORKFLOW_FILTER_COLUMNS.search)?.setFilterValue(
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
        aria-label="Search workflows"
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
        aria-label="Search workflows"
        placeholder="Search workflows..."
        className="h-8 rounded-md border-transparent bg-transparent pl-8 pr-8 text-sm shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        value={searchValue}
        onBlur={() => {
          if (!searchValue) setExpanded(false);
        }}
        onChange={(event) => setSearchValue(event.target.value)}
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
        aria-label="Clear search workflows"
        onMouseDown={(event) => event.preventDefault()}
        onClick={clearSearch}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

function buildWorkflowTokenFilterColumns(
  rows: WorkflowRow[],
): DataTableTokenFilterColumn[] {
  return [
    {
      id: WORKFLOW_FILTER_COLUMNS.readiness,
      label: "Status",
      type: "option",
      icon: <CircleDot className="size-4" />,
      options: uniqueOptions(rows, (row) => row.readinessState).map(
        (value) => ({
          value,
          label: titleize(value),
        }),
      ),
    },
    {
      id: WORKFLOW_FILTER_COLUMNS.source,
      label: "Source",
      type: "option",
      icon: <Plug className="size-4" />,
      options: uniqueOptions(rows, bindingFilterValue).map((value) => ({
        value,
        label: sourceLabel({ id: value, bindingType: value }),
      })),
    },
    {
      id: WORKFLOW_FILTER_COLUMNS.trigger,
      label: "Trigger",
      type: "option",
      icon: <GitBranch className="size-4" />,
      options: uniqueOptions(rows, workflowTriggerLabel).map((value) => ({
        value,
        label: value,
      })),
    },
  ];
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

function sourceLinkForBinding(
  launchUrl: string | null,
  binding: WorkflowBinding | null,
): { href: string; external: boolean; title: string } | null {
  if (!isN8nBinding(binding)) {
    return null;
  }

  if (launchUrl && binding.externalWorkflowId) {
    try {
      return {
        href: new URL(
          `/workflow/${encodeURIComponent(binding.externalWorkflowId)}`,
          new URL(launchUrl).origin,
        ).toString(),
        external: true,
        title: "Open n8n workflow",
      };
    } catch {
      // Fall through to the in-app n8n workflow inventory.
    }
  }

  return {
    href: N8N_WORKFLOWS_PATH,
    external: false,
    title: "Open n8n workflows",
  };
}

function isN8nBinding(
  binding: WorkflowBinding | null,
): binding is WorkflowBinding {
  return (
    binding?.bindingType === "n8n_bridge" ||
    binding?.bindingType === "n8n_import"
  );
}

function workflowTriggerLabel(row: WorkflowRow): string {
  const bindingType = primaryBinding(row.bindings)?.bindingType;
  if (bindingType === "n8n_bridge" || bindingType === "n8n_import") {
    const triggerTypes = row.triggers.flatMap((trigger) =>
      stringArrayFromUnknown(
        recordFromUnknown(trigger.triggerConfig).triggerTypes,
      ),
    );
    if (triggerTypes.length) {
      return Array.from(new Set(triggerTypes.map(titleize))).join(", ");
    }
  }
  return titleize(row.primaryTriggerFamily);
}

function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
