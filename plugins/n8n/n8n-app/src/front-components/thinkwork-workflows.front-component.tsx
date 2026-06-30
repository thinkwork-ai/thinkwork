import { useMemo, useState, type ReactNode } from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type Table as TanStackTable,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Button,
  DataTableTokenFilter,
  Input,
  dataTableTokenFilterFns,
  type DataTableTokenFilterColumn,
} from "@thinkwork/ui";

import {
  connectionLabel,
  executionStatuses,
  formatDuration,
  readinessLabel,
  type N8nAppData,
  type N8nAppExecutionRow,
  type N8nAppViewMode,
  type N8nAppWorkflowRow,
  type N8nReadinessState,
} from "../lib/n8n-app-data";

export type ThinkWorkN8nWorkflowsAppProps = {
  appDisplayName?: string;
  pluginDisplayName?: string;
  data?: N8nAppData | null;
  fetching?: boolean;
  error?: { message?: string } | null;
  onRefresh?: () => void;
  viewMode?: N8nAppViewMode;
  onViewModeChange?: (viewMode: N8nAppViewMode) => void;
};

export type { N8nAppData } from "../lib/n8n-app-data";

const READINESS_FILTERS: Array<"all" | N8nReadinessState> = [
  "all",
  "ready",
  "blocked_not_ready",
  "disabled",
  "unknown",
];
const N8N_FILTER_COLUMNS = {
  search: "filterSearch",
  readiness: "filterReadiness",
  status: "filterStatus",
} as const;

export function ThinkWorkN8nWorkflowsApp({
  appDisplayName = "n8n Workflows",
  pluginDisplayName = "n8n",
  data,
  fetching = false,
  error = null,
  onRefresh,
  viewMode: controlledViewMode,
  onViewModeChange: _onViewModeChange,
}: ThinkWorkN8nWorkflowsAppProps) {
  const [uncontrolledViewMode] = useState<N8nAppViewMode>("workflows");
  const viewMode = controlledViewMode ?? uncontrolledViewMode;
  const [workflowColumnFilters, setWorkflowColumnFilters] =
    useState<ColumnFiltersState>([]);
  const [executionColumnFilters, setExecutionColumnFilters] =
    useState<ColumnFiltersState>([]);

  const workflows = data?.workflows ?? [];
  const executions = data?.executions ?? [];
  const executionStatusOptions = useMemo(
    () => executionStatuses(executions),
    [executions],
  );
  const workflowFilterColumns = useMemo(() => buildWorkflowFilterColumns(), []);
  const executionFilterColumns = useMemo(
    () => buildExecutionFilterColumns(),
    [],
  );
  const workflowTokenFilterColumns = useMemo(
    () => buildWorkflowTokenFilterColumns(),
    [],
  );
  const executionTokenFilterColumns = useMemo(
    () => buildExecutionTokenFilterColumns(executionStatusOptions),
    [executionStatusOptions],
  );
  const workflowTable = useReactTable({
    data: workflows,
    columns: workflowFilterColumns,
    state: { columnFilters: workflowColumnFilters },
    onColumnFiltersChange: setWorkflowColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const executionTable = useReactTable({
    data: executions,
    columns: executionFilterColumns,
    state: { columnFilters: executionColumnFilters },
    onColumnFiltersChange: setExecutionColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const filteredWorkflows = useMemo(
    () => workflowTable.getFilteredRowModel().rows.map((row) => row.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workflowTable.getState().columnFilters, workflows],
  );
  const filteredExecutions = useMemo(
    () => executionTable.getFilteredRowModel().rows.map((row) => row.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [executionTable.getState().columnFilters, executions],
  );
  if (fetching && !data) {
    return (
      <AppFrame title={appDisplayName} pluginName={pluginDisplayName}>
        <CenteredState
          title="Loading n8n data"
          description="Checking workflows and recent executions."
        />
      </AppFrame>
    );
  }

  if (error) {
    return (
      <AppFrame title={appDisplayName} pluginName={pluginDisplayName}>
        <CenteredState
          tone="error"
          title="n8n data unavailable"
          description={error.message ?? "The app could not load n8n data."}
          action={
            onRefresh ? (
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
                onClick={onRefresh}
              >
                Refresh
              </button>
            ) : null
          }
        />
      </AppFrame>
    );
  }

  if (!data) {
    return (
      <AppFrame title={appDisplayName} pluginName={pluginDisplayName}>
        <CenteredState
          title="n8n is not installed"
          description="Open plugin settings to finish setup."
        />
      </AppFrame>
    );
  }

  return (
    <AppFrame title={appDisplayName} pluginName={pluginDisplayName}>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-6 py-3">
          {viewMode === "workflows" ? (
            <AppTableToolbar
              table={workflowTable}
              tokenFilterColumns={workflowTokenFilterColumns}
              searchPlaceholder="Search workflows..."
            />
          ) : (
            <AppTableToolbar
              table={executionTable}
              tokenFilterColumns={executionTokenFilterColumns}
              searchPlaceholder="Search executions..."
            />
          )}
        </div>

        <main className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {viewMode === "workflows" ? (
            <WorkflowTable rows={filteredWorkflows} total={workflows.length} />
          ) : (
            <ExecutionTable
              rows={filteredExecutions}
              total={executions.length}
            />
          )}
        </main>
      </section>
    </AppFrame>
  );
}

export default ThinkWorkN8nWorkflowsApp;

function AppFrame({
  title,
  pluginName,
  children,
}: {
  title: string;
  pluginName: string;
  children: ReactNode;
}) {
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      aria-label={`${pluginName} ${title}`}
    >
      {children}
    </section>
  );
}

function WorkflowTable({
  rows,
  total,
}: {
  rows: N8nAppWorkflowRow[];
  total: number;
}) {
  if (total === 0) {
    return (
      <CenteredState
        title="No workflows found"
        description="No n8n workflows are available yet."
      />
    );
  }
  if (rows.length === 0) {
    return (
      <CenteredState
        title="No matching workflows"
        description="Adjust the current filter."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <HeaderCell className="w-[44%]">Workflow</HeaderCell>
            <HeaderCell className="w-[20%]">Triggers</HeaderCell>
            <HeaderCell className="w-[18%]">Link</HeaderCell>
            <HeaderCell className="w-[18%]">Readiness</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rows.map((workflow) => (
            <tr
              key={workflow.externalWorkflowId}
              className="border-t border-border hover:bg-muted/20"
            >
              <BodyCell>
                <div className="flex min-w-0 flex-col gap-1">
                  {workflow.nativeWorkflowUrl ? (
                    <a
                      href={workflow.nativeWorkflowUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {workflow.name}
                    </a>
                  ) : (
                    <span className="truncate font-medium text-foreground">
                      {workflow.name}
                    </span>
                  )}
                  <WarningList warnings={workflow.warnings} />
                </div>
              </BodyCell>
              <BodyCell>
                <ChipList
                  values={
                    workflow.triggerTypes.length > 0
                      ? workflow.triggerTypes
                      : ["none"]
                  }
                />
              </BodyCell>
              <BodyCell>
                <Badge tone={connectionTone(workflow)}>
                  {connectionLabel(workflow)}
                </Badge>
              </BodyCell>
              <BodyCell>
                <Badge tone={workflow.readinessState}>
                  {readinessLabel(workflow.readinessState)}
                </Badge>
              </BodyCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExecutionTable({
  rows,
  total,
}: {
  rows: N8nAppExecutionRow[];
  total: number;
}) {
  if (total === 0) {
    return (
      <CenteredState
        title="No executions found"
        description="Recent n8n executions are not available yet."
      />
    );
  }
  if (rows.length === 0) {
    return (
      <CenteredState
        title="No matching executions"
        description="Adjust the current filter."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full min-w-[1120px] table-fixed border-collapse text-left text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <HeaderCell className="w-[42%]">Workflow name</HeaderCell>
            <HeaderCell className="w-[16%]">Status</HeaderCell>
            <HeaderCell className="w-[14%]">Mode</HeaderCell>
            <HeaderCell className="w-[14%]">Started</HeaderCell>
            <HeaderCell className="w-[14%]">Duration</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rows.map((execution) => (
            <tr
              key={execution.externalExecutionId}
              className="border-t border-border hover:bg-muted/20"
            >
              <BodyCell>
                <div className="flex min-w-0 flex-col gap-1">
                  <a
                    href={execution.nativeExecutionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {execution.workflowName ?? execution.externalWorkflowId}
                  </a>
                  <WarningList
                    warnings={[
                      ...execution.warnings,
                      ...(execution.failureMessage
                        ? [execution.failureMessage]
                        : []),
                    ]}
                  />
                </div>
              </BodyCell>
              <BodyCell>
                <Badge tone={statusTone(execution.status)}>
                  {execution.status}
                </Badge>
              </BodyCell>
              <BodyCell>
                <span className="text-muted-foreground">
                  {execution.mode ?? "-"}
                </span>
              </BodyCell>
              <BodyCell>
                <span className="text-muted-foreground">
                  {formatShortDateTime(execution.startedAt)}
                </span>
              </BodyCell>
              <BodyCell>
                <span className="text-muted-foreground">
                  {formatDuration(execution.durationMs)}
                </span>
              </BodyCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeaderCell({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <th className={`px-4 py-3 font-semibold ${className}`}>{children}</th>;
}

function BodyCell({ children }: { children: ReactNode }) {
  return <td className="min-w-0 px-4 py-3 align-top">{children}</td>;
}

function AppTableToolbar<TData>({
  table,
  tokenFilterColumns,
  searchPlaceholder,
}: {
  table: TanStackTable<TData>;
  tokenFilterColumns: DataTableTokenFilterColumn[];
  searchPlaceholder: string;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <ToolbarSearch table={table} placeholder={searchPlaceholder} />
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
  );
}

function ToolbarSearch<TData>({
  table,
  placeholder,
}: {
  table: TanStackTable<TData>;
  placeholder: string;
}) {
  const searchFilter = table
    .getState()
    .columnFilters.find(
      (filter) => filter.id === N8N_FILTER_COLUMNS.search,
    )?.value;
  const searchValue =
    isTextFilterValue(searchFilter) && typeof searchFilter.value === "string"
      ? searchFilter.value
      : "";
  const setSearchValue = (value: string) => {
    const trimmed = value.trimStart();
    table.getColumn(N8N_FILTER_COLUMNS.search)?.setFilterValue(
      trimmed
        ? {
            operator: "contains",
            value: trimmed,
          }
        : undefined,
    );
    table.setPageIndex(0);
  };
  return (
    <div className="relative flex h-8 w-[min(18rem,calc(100vw-2rem))] items-center">
      <SearchIcon className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
      <Input
        type="search"
        value={searchValue}
        onChange={(event) => setSearchValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setSearchValue("");
          }
        }}
        placeholder={placeholder}
        className="h-8 rounded-md border-border bg-background pl-8 pr-8 text-sm shadow-none"
      />
      {searchValue ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute right-1 h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setSearchValue("")}
        >
          <XIcon className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

function buildWorkflowTokenFilterColumns(): DataTableTokenFilterColumn[] {
  return [
    {
      id: N8N_FILTER_COLUMNS.readiness,
      label: "Readiness",
      type: "option",
      options: READINESS_FILTERS.filter((state) => state !== "all").map(
        (state) => ({
          value: state,
          label: readinessLabel(state),
        }),
      ),
    },
  ];
}

function buildExecutionTokenFilterColumns(
  statuses: string[],
): DataTableTokenFilterColumn[] {
  return [
    {
      id: N8N_FILTER_COLUMNS.status,
      label: "Status",
      type: "option",
      options: statuses.map((status) => ({
        value: status,
        label: status,
      })),
      emptyMessage: "No statuses available.",
    },
  ];
}

function buildWorkflowFilterColumns(): Array<
  ColumnDef<N8nAppWorkflowRow, unknown>
> {
  return [
    {
      id: N8N_FILTER_COLUMNS.search,
      accessorFn: workflowSearchText,
      filterFn: dataTableTokenFilterFns.text,
    },
    {
      id: N8N_FILTER_COLUMNS.readiness,
      accessorFn: (workflow) => workflow.readinessState,
      filterFn: dataTableTokenFilterFns.option,
    },
  ];
}

function buildExecutionFilterColumns(): Array<
  ColumnDef<N8nAppExecutionRow, unknown>
> {
  return [
    {
      id: N8N_FILTER_COLUMNS.search,
      accessorFn: executionSearchText,
      filterFn: dataTableTokenFilterFns.text,
    },
    {
      id: N8N_FILTER_COLUMNS.status,
      accessorFn: (execution) => execution.status,
      filterFn: dataTableTokenFilterFns.option,
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

function workflowSearchText(workflow: N8nAppWorkflowRow): string {
  return [
    workflow.name,
    workflow.externalWorkflowId,
    workflow.triggerTypes.join(" "),
    workflow.readinessState,
    connectionLabel(workflow),
    workflow.warnings.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

function executionSearchText(execution: N8nAppExecutionRow): string {
  return [
    execution.externalExecutionId,
    execution.externalWorkflowId,
    execution.workflowName ?? "",
    execution.status,
    execution.mode ?? "",
    execution.failureMessage ?? "",
    execution.bridgeRuns
      .map((run) =>
        [
          run.id,
          run.status,
          run.resumeStatus,
          run.summary ?? "",
          run.errorMessage ?? "",
        ].join(" "),
      )
      .join(" "),
    execution.warnings.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

function formatShortDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(date)
    .replace(/,\s*/, " ")
    .replace(/\s([AP]M)$/i, "$1");
}

function Badge({
  tone,
  children,
}: {
  tone: N8nReadinessState;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex max-w-full rounded-full border px-2 py-0.5 text-xs font-medium ${badgeTone(
        tone,
      )}`}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

function ChipList({ values }: { values: string[] }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {values.slice(0, 3).map((value) => (
        <span
          key={value}
          className="max-w-full truncate rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
        >
          {value}
        </span>
      ))}
      {values.length > 3 ? (
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          +{values.length - 3}
        </span>
      ) : null}
    </div>
  );
}

function WarningList({ warnings }: { warnings: string[] }) {
  const filtered = warnings.filter(Boolean);
  if (filtered.length === 0) return null;
  return (
    <span className="block truncate text-xs text-amber-500">
      {filtered[0]}
      {filtered.length > 1 ? ` +${filtered.length - 1}` : ""}
    </span>
  );
}

function CenteredState({
  tone = "neutral",
  title,
  description,
  action,
}: {
  tone?: "neutral" | "error";
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[280px] items-center justify-center p-8">
      <div
        className={`max-w-md rounded-md border p-5 text-center ${
          tone === "error"
            ? "border-destructive/30 bg-destructive/10"
            : "border-border bg-muted/20"
        }`}
      >
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

function connectionTone(workflow: N8nAppWorkflowRow): N8nReadinessState {
  const label = connectionLabel(workflow);
  if (label === "linked") return "ready";
  if (label === "partial") return "blocked_not_ready";
  return "unknown";
}

function statusTone(status: string): N8nReadinessState {
  const normalized = status.toLowerCase();
  if (["success", "succeeded", "completed"].includes(normalized)) {
    return "ready";
  }
  if (["error", "failed", "crashed"].includes(normalized)) {
    return "blocked_not_ready";
  }
  if (["running", "waiting", "new"].includes(normalized)) {
    return "unknown";
  }
  return "disabled";
}

function badgeTone(tone: N8nReadinessState): string {
  if (tone === "ready") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
  }
  if (tone === "blocked_not_ready") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-500";
  }
  if (tone === "disabled") {
    return "border-border bg-muted/20 text-muted-foreground";
  }
  return "border-sky-500/40 bg-sky-500/10 text-sky-500";
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
