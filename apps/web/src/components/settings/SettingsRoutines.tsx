/**
 * Routines settings page (deterministic routines v1, plan 2026-07-03-004).
 *
 * Routines are the object; the git repo connection is config. This is a
 * DataTable of the tenant's git_python routines (name, description, status,
 * validated commit, GitHub link) with a header cog that opens the repo
 * connection in a side sheet (SettingsRoutineRepo, reused).
 */

import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Badge,
  Button,
  DataTable,
  DataTableTokenFilter,
  type DataTableTokenFilterColumn,
  dataTableTokenFilterFns,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import { ExternalLink, Settings2 } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { CollapsedFilterSearch } from "@/components/artifacts/CollapsedFilterSearch";
import { relativeTime } from "@/lib/utils";
import { SettingsGitRoutinesQuery } from "@/lib/graphql-queries";
import { SettingsTenantCredentialsQuery } from "@/lib/settings-queries";
import { TenantCredentialStatus } from "@/gql/graphql";
import {
  SettingsTablePane,
  settingsLinkActionClassName,
} from "@/components/settings/SettingsContent";
import {
  SettingsRoutineRepo,
  ROUTINE_REPO_CREDENTIAL_SLUG,
} from "@/components/settings/SettingsRoutineRepo";

interface GitRoutine {
  id: string;
  name: string;
  description?: string | null;
  engine: string;
  status: string;
  modulePath?: string | null;
  fixturePaths?: string | null;
  validatedSha?: string | null;
  disabledReason?: string | null;
  lastRunAt?: string | null;
}

// Hidden-column ids for the Work Items-style filter table.
const FILTER_COLUMNS = {
  search: "filterSearch",
  status: "filterStatus",
} as const;

/** Collapse a routine into the coarse status the token filter offers. */
function routineFilterStatus(routine: GitRoutine): string {
  if (routine.status !== "active") return "disabled";
  return routine.validatedSha ? "validated" : "unvalidated";
}

/** Read the contains-search string out of the token-filter state. */
function tokenFilterSearchValue(
  columnFilters: ColumnFiltersState,
  id: string,
): string {
  const raw = columnFilters.find((filter) => filter.id === id)?.value;
  if (raw && typeof raw === "object" && "value" in raw) {
    const value = (raw as { value: unknown }).value;
    if (typeof value === "string") return value;
  }
  return "";
}

function stringFromMetadata(raw: unknown, key: string): string | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const value = (parsed as Record<string, unknown>)[key];
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

/** Build a GitHub blob URL for the routine's module. */
function moduleUrl(
  repoUrl: string | null,
  branch: string | null,
  modulePath: string | null,
): string | null {
  if (!repoUrl || !modulePath) return null;
  const base = repoUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  return `${base}/blob/${branch ?? "main"}/${modulePath}`;
}

export function SettingsRoutines() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [configOpen, setConfigOpen] = useState(false);

  const [routinesResult, refetchRoutines] = useQuery({
    query: SettingsGitRoutinesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [credentialResult] = useQuery({
    query: SettingsTenantCredentialsQuery,
    variables: {
      tenantId: tenantId ?? "",
      status: TenantCredentialStatus.Active,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const repoCredential =
    (
      credentialResult.data as
        | {
            tenantCredentials?: {
              slug: string;
              metadataJson?: unknown;
            }[];
          }
        | undefined
    )?.tenantCredentials?.find(
      (c) => c.slug === ROUTINE_REPO_CREDENTIAL_SLUG,
    ) ?? null;
  const repoUrl = stringFromMetadata(repoCredential?.metadataJson, "repoUrl");
  const repoBranch = stringFromMetadata(repoCredential?.metadataJson, "branch");

  const routines = useMemo(
    () =>
      (
        (routinesResult.data as { routines?: GitRoutine[] } | undefined)
          ?.routines ?? []
      )
        .filter((r) => r.engine === "git_python")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [routinesResult.data],
  );

  // Hidden filter table (Work Items idiom): drives the collapsed search over
  // name/description plus the Status token picker.
  const filterRows = useMemo(
    () =>
      routines.map((routine) => ({
        routine,
        filterSearch: `${routine.name} ${routine.description ?? ""}`,
        filterStatus: routineFilterStatus(routine),
      })),
    [routines],
  );
  type RoutineFilterRow = (typeof filterRows)[number];

  const filterColumns = useMemo<ColumnDef<RoutineFilterRow>[]>(
    () => [
      {
        id: FILTER_COLUMNS.search,
        accessorKey: "filterSearch",
        filterFn: dataTableTokenFilterFns.text,
      },
      {
        id: FILTER_COLUMNS.status,
        accessorKey: "filterStatus",
        filterFn: dataTableTokenFilterFns.option,
      },
    ],
    [],
  );

  const filterTable = useReactTable({
    data: filterRows,
    columns: filterColumns,
    autoResetPageIndex: false,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const filteredRoutines = filterTable
    .getFilteredRowModel()
    .rows.map((row) => row.original.routine);

  const searchValue = tokenFilterSearchValue(
    columnFilters,
    FILTER_COLUMNS.search,
  );

  const tokenFilterColumns = useMemo<DataTableTokenFilterColumn[]>(
    () => [
      {
        id: FILTER_COLUMNS.status,
        label: "Status",
        type: "option",
        options: [
          { value: "validated", label: "Validated" },
          { value: "unvalidated", label: "Needs validation" },
          { value: "disabled", label: "Disabled" },
        ],
      },
    ],
    [],
  );

  usePageHeaderActions({
    title: "Routines",
    action: (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Routine repo settings"
        title="Routine repo settings"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => setConfigOpen(true)}
      >
        <Settings2 className="size-4" />
      </Button>
    ),
    actionKey: "routines-config-cog",
  });

  const columns = useMemo<ColumnDef<GitRoutine>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        size: 200,
        cell: ({ row }) => (
          <span className="block truncate font-medium">
            {row.original.name}
          </span>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        // No fixed size — under table-fixed this column absorbs the row's
        // spare width; the cell truncates rather than growing the table.
        cell: ({ row }) =>
          row.original.description ? (
            <span className="block w-full truncate text-sm text-muted-foreground">
              {row.original.description}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "lastRun",
        header: "Last run",
        size: 120,
        cell: ({ row }) =>
          row.original.lastRunAt ? (
            <span
              className="text-sm text-muted-foreground"
              title={new Date(row.original.lastRunAt).toLocaleString()}
            >
              {relativeTime(row.original.lastRunAt)}
            </span>
          ) : (
            <span className="text-muted-foreground">Never run</span>
          ),
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 120,
        cell: ({ row }) => {
          const r = row.original;
          if (r.status !== "active") {
            return (
              <Badge
                variant="outline"
                className="border-amber-500/40 text-amber-400"
                title={r.disabledReason ?? undefined}
              >
                {r.status === "paused" ? "disabled" : r.status}
              </Badge>
            );
          }
          return r.validatedSha ? (
            <Badge
              variant="outline"
              className="border-emerald-500/40 text-emerald-400"
            >
              validated
            </Badge>
          ) : (
            <Badge variant="secondary">no validated version</Badge>
          );
        },
      },
      {
        id: "commit",
        header: "Validated commit",
        size: 160,
        cell: ({ row }) => {
          const sha = row.original.validatedSha;
          return sha ? (
            <code className="font-mono text-xs text-muted-foreground">
              {sha.slice(0, 12)}
            </code>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "source",
        header: "Source",
        size: 120,
        cell: ({ row }) => {
          const href = moduleUrl(
            repoUrl,
            repoBranch,
            row.original.modulePath ?? null,
          );
          return href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-3" />
              GitHub
            </a>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              {row.original.modulePath ?? "—"}
            </span>
          );
        },
      },
    ],
    [repoUrl, repoBranch],
  );

  const error = routinesResult.error;

  return (
    <>
      <SettingsTablePane
        title="Routines"
        description="Reliable, repeatable routines that handle recurring work automatically — ask your agent to create one and it takes care of the rest."
        loading={routinesResult.fetching && routines.length === 0 && !error}
        toolbar={
          error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <CollapsedFilterSearch
                value={searchValue}
                onChange={(value) =>
                  filterTable
                    .getColumn(FILTER_COLUMNS.search)
                    ?.setFilterValue(
                      value ? { operator: "contains", value } : undefined,
                    )
                }
                label="Search routines"
                placeholder="Search routines…"
              />
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
            </div>
          )
        }
      >
        <DataTable
          columns={columns}
          data={filteredRoutines}
          onRowClick={(routine) =>
            navigate({
              to: "/settings/routines/$routineId",
              params: { routineId: routine.id },
            })
          }
          scrollable
          allowHorizontalScroll={false}
          pageSize={0}
          tableClassName="table-fixed"
          emptyState={
            <div className="flex flex-col items-center gap-1 py-12 text-center text-sm text-muted-foreground">
              <p>No routines yet.</p>
              <p>
                {repoCredential
                  ? "Ask the platform agent to author one — it commits the code and fixtures to your repo."
                  : "Connect a GitHub repo first, then ask the agent to author a routine."}
              </p>
              {!repoCredential ? (
                <button
                  type="button"
                  onClick={() => setConfigOpen(true)}
                  className={`mt-2 ${settingsLinkActionClassName}`}
                >
                  Connect repo
                </button>
              ) : null}
            </div>
          }
        />
      </SettingsTablePane>

      <Sheet open={configOpen} onOpenChange={setConfigOpen}>
        <SheetContent className="overflow-y-auto data-[side=right]:w-[min(640px,calc(100vw-2rem))]">
          <SheetHeader>
            <SheetTitle>Routine repo</SheetTitle>
            <SheetDescription>
              The GitHub repository that holds this workspace's routine code.
            </SheetDescription>
          </SheetHeader>
          <SettingsRoutineRepo
            embedded
            onSaved={() => refetchRoutines({ requestPolicy: "network-only" })}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
