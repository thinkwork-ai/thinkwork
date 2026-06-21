import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "urql";
import { Badge, DataTable, Input } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { SettingsWorkflowsQuery } from "@/lib/graphql-queries";
import { SettingsTablePane } from "@/components/settings/SettingsContent";
import {
  formatShortDate,
  primaryBinding,
  sourceLabel,
  SourceBadge,
  titleize,
  type WorkflowBinding,
  type WorkflowRunSummary,
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
    enabled: boolean;
    readinessState: string;
  }>;
  lastRun?: WorkflowRunSummary | null;
  lastRunAt?: string | null;
  updatedAt?: string | null;
};

type WorkflowsData = {
  workflows: WorkflowRow[];
};

const ALL = "all";

function bindingFilterValue(row: WorkflowRow): string {
  return primaryBinding(row.bindings)?.bindingType ?? "unknown";
}

function rowMatchesSearch(row: WorkflowRow, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    row.name,
    row.description ?? "",
    row.primaryTriggerFamily,
    sourceLabel(primaryBinding(row.bindings)),
    row.lifecycleStatus,
    row.readinessState,
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function uniqueOptions(
  rows: WorkflowRow[],
  getValue: (row: WorkflowRow) => string,
) {
  return Array.from(new Set(rows.map(getValue).filter(Boolean))).sort();
}

export function WorkflowInventory() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [readiness, setReadiness] = useState(ALL);
  const [binding, setBinding] = useState(ALL);
  const [trigger, setTrigger] = useState(ALL);
  const [status, setStatus] = useState(ALL);

  const [result] = useQuery<WorkflowsData>({
    query: SettingsWorkflowsQuery,
    variables: { tenantId: tenantId ?? "", limit: 100 },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const rows = useMemo(
    () => result.data?.workflows ?? [],
    [result.data?.workflows],
  );
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          rowMatchesSearch(row, search) &&
          (readiness === ALL || row.readinessState === readiness) &&
          (binding === ALL || bindingFilterValue(row) === binding) &&
          (trigger === ALL || row.primaryTriggerFamily === trigger) &&
          (status === ALL || row.lifecycleStatus === status),
      ),
    [binding, readiness, rows, search, status, trigger],
  );

  const columns = useMemo<ColumnDef<WorkflowRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Workflow",
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {row.original.description ?? "No description"}
            </span>
          </div>
        ),
      },
      {
        id: "readiness",
        header: "Readiness",
        size: 170,
        cell: ({ row }) => (
          <WorkflowReadinessBadge
            state={row.original.readinessState}
            reasons={row.original.readinessReasons}
          />
        ),
      },
      {
        id: "source",
        header: "Source",
        size: 140,
        cell: ({ row }) => (
          <SourceBadge binding={primaryBinding(row.original.bindings)} />
        ),
      },
      {
        accessorKey: "primaryTriggerFamily",
        header: "Trigger",
        size: 120,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs">
            {titleize(row.original.primaryTriggerFamily)}
          </Badge>
        ),
      },
      {
        accessorKey: "lifecycleStatus",
        header: "Status",
        size: 110,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {titleize(row.original.lifecycleStatus)}
          </span>
        ),
      },
      {
        id: "version",
        header: "Version",
        size: 90,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.currentVersionNumber ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "lastRunAt",
        header: "Last run",
        size: 120,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatShortDate(
              row.original.lastRun?.lastEventAt ??
                row.original.lastRun?.startedAt ??
                row.original.lastRunAt,
            )}
          </span>
        ),
      },
    ],
    [],
  );

  const loading = result.fetching && !result.data;
  const hasFilters =
    search.trim() !== "" ||
    readiness !== ALL ||
    binding !== ALL ||
    trigger !== ALL ||
    status !== ALL;

  return (
    <SettingsTablePane
      title="Workflows"
      description="Monitor workflows imported from routines, plugins, connected apps, and native ThinkWork sources."
      loading={loading}
      toolbar={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Input
            placeholder="Search workflows..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-sm"
          />
          <FilterSelect
            label="Readiness"
            value={readiness}
            values={uniqueOptions(rows, (row) => row.readinessState)}
            onChange={setReadiness}
          />
          <FilterSelect
            label="Source"
            value={binding}
            values={uniqueOptions(rows, bindingFilterValue)}
            labelFor={(value) => sourceLabel({ id: value, bindingType: value })}
            onChange={setBinding}
          />
          <FilterSelect
            label="Trigger"
            value={trigger}
            values={uniqueOptions(rows, (row) => row.primaryTriggerFamily)}
            onChange={setTrigger}
          />
          <FilterSelect
            label="Status"
            value={status}
            values={uniqueOptions(rows, (row) => row.lifecycleStatus)}
            onChange={setStatus}
          />
        </div>
      }
    >
      {result.error ? (
        <div className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
          {result.error.message}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredRows}
          filterValue=""
          filterColumn="name"
          scrollable
          allowHorizontalScroll
          pageSize={25}
          tableClassName="table-fixed"
          onRowClick={(row) =>
            navigate({
              to: "/settings/workflows/$workflowId",
              params: { workflowId: row.id },
            })
          }
          emptyState={
            <div className="py-10 text-center text-sm text-muted-foreground">
              {rows.length === 0
                ? "No workflows have been imported yet."
                : hasFilters
                  ? "No workflows match the current filters."
                  : "No workflows to show."}
            </div>
          }
        />
      )}
    </SettingsTablePane>
  );
}

function FilterSelect({
  label,
  value,
  values,
  labelFor = titleize,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  labelFor?: (value: string) => string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={label}
      >
        <option value={ALL}>{label}</option>
        {values.map((item) => (
          <option key={item} value={item}>
            {labelFor(item)}
          </option>
        ))}
      </select>
    </label>
  );
}
