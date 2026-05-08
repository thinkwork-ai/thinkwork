import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import type { FormEvent, ReactNode } from "react";
import {
  Archive,
  ChevronDown,
  ExternalLink,
  Filter,
  Loader2,
  Monitor,
  Network,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { EmptyState } from "@/components/EmptyState";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AgentsListQuery,
  ArchiveConnectorMutation,
  ConnectorRunLifecyclesQuery,
  ConnectorsListQuery,
  ComputersListQuery,
  CreateConnectorMutation,
  PauseConnectorMutation,
  ResumeConnectorMutation,
  RoutinesListQuery,
  RunConnectorNowMutation,
  TenantCredentialsQuery,
  UpdateConnectorMutation,
} from "@/lib/graphql-queries";
import {
  connectorGitHubCredentialStatus,
  connectorFormValues,
  connectorExecutionCleanupDisplay,
  connectorExecutionLinearIdentifier,
  connectorExecutionPrDisplay,
  connectorExecutionStateTone,
  connectorExecutionThreadId,
  connectorExecutionWritebackDisplay,
  connectorStatusTone,
  connectorTargetLabel,
  connectorTargetOptions,
  createConnectorInput,
  linearTrackerStarterConfigJson,
  shouldUseManualTargetInput,
  updateConnectorInput,
  validateConnectorFormValues,
  type ConnectorCredentialOption,
  type ConnectorComputerTarget,
  type ConnectorExecutionWritebackDisplay,
  type ConnectorFormValues,
} from "@/lib/connector-admin";
import {
  ConnectorStatus,
  ConnectorExecutionState,
  DispatchTargetType,
  TenantCredentialStatus,
  type ConnectorRunLifecyclesQuery as ConnectorRunLifecyclesQueryResult,
  type ConnectorFilter,
} from "@/gql/graphql";
import { cn, relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/symphony")({
  component: SymphonyPage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: parseSymphonyTab(search.tab),
  }),
});

type SymphonyTab = "connectors" | "runs";

function parseSymphonyTab(value: unknown): SymphonyTab {
  return value === "runs" ? "runs" : "connectors";
}

type ConnectorRow = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  status: ConnectorStatus;
  connectionId: string | null;
  config: unknown;
  dispatchTargetType: DispatchTargetType;
  dispatchTargetId: string;
  lastPollAt: string | null;
  nextPollAt: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type ConnectorAction = (connector: ConnectorRow) => void | Promise<void>;

type ConnectorRunLifecycleRow =
  ConnectorRunLifecyclesQueryResult["connectorRunLifecycles"][number];

const MANUAL_TARGET_ID = "__manual_target_id__";

function SymphonyPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const { tab } = Route.useSearch();
  const [search, setSearch] = useState("");
  const [executionConnectorId, setExecutionConnectorId] = useState("all");
  const [showCancelledRuns, setShowCancelledRuns] = useState(false);
  const [editing, setEditing] = useState<ConnectorRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [runningConnectorId, setRunningConnectorId] = useState<string | null>(
    null,
  );
  useBreadcrumbs([{ label: "Symphony" }]);

  const filter: ConnectorFilter = { includeArchived: true };
  const [result, refetch] = useQuery({
    query: ConnectorsListQuery,
    variables: { filter, limit: 100, cursor: null },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const selectedExecutionConnectorId =
    executionConnectorId === "all" ? null : executionConnectorId;
  const [runsResult, refetchRuns] = useQuery({
    query: ConnectorRunLifecyclesQuery,
    variables: {
      connectorId: selectedExecutionConnectorId,
      limit: 50,
      cursor: null,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [credentialsResult] = useQuery({
    query: TenantCredentialsQuery,
    variables: {
      tenantId: tenantId ?? "",
      status: TenantCredentialStatus.Active,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [, createConnector] = useMutation(CreateConnectorMutation);
  const [, updateConnector] = useMutation(UpdateConnectorMutation);
  const [, pauseConnector] = useMutation(PauseConnectorMutation);
  const [, resumeConnector] = useMutation(ResumeConnectorMutation);
  const [, archiveConnector] = useMutation(ArchiveConnectorMutation);
  const [, runConnectorNow] = useMutation(RunConnectorNowMutation);

  const connectors = (result.data?.connectors ?? []) as ConnectorRow[];
  const credentialOptions = useMemo(
    () => credentialOptionsFromQuery(credentialsResult.data?.tenantCredentials),
    [credentialsResult.data?.tenantCredentials],
  );
  const activeCredentialSlugs = useMemo(
    () => credentialOptions.map((credential) => credential.slug),
    [credentialOptions],
  );
  const runs = (runsResult.data?.connectorRunLifecycles ??
    []) as ConnectorRunLifecycleRow[];
  const visibleRuns = useMemo(() => {
    if (showCancelledRuns) return runs;
    return runs.filter(
      (run) => run.execution.currentState !== ConnectorExecutionState.Cancelled,
    );
  }, [runs, showCancelledRuns]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return connectors;
    return connectors.filter((connector) =>
      [
        connector.name,
        connector.type,
        connector.description,
        connector.status,
        connector.dispatchTargetType,
        connector.dispatchTargetId,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [connectors, search]);

  if (!tenantId) return <PageSkeleton />;

  const activeCount = connectors.filter(
    (connector) => connector.status === ConnectorStatus.Active,
  ).length;
  const pausedCount = connectors.filter(
    (connector) => connector.status === ConnectorStatus.Paused,
  ).length;
  const archivedCount = connectors.filter(
    (connector) => connector.status === ConnectorStatus.Archived,
  ).length;
  const isLoading = result.fetching && !result.data;

  const refresh = () => {
    refetch({ requestPolicy: "network-only" });
    refetchRuns({ requestPolicy: "network-only" });
  };
  const handleCreate = async (values: ConnectorFormValues) => {
    const response = await createConnector({
      input: createConnectorInput(tenantId, values),
    });
    if (response.error) throw new Error(response.error.message);
    setCreating(false);
    refresh();
    toast.success("Connector created");
  };

  const handleUpdate = async (values: ConnectorFormValues) => {
    if (!editing) return;
    const response = await updateConnector({
      id: editing.id,
      input: updateConnectorInput(values),
    });
    if (response.error) throw new Error(response.error.message);
    setEditing(null);
    refresh();
    toast.success("Connector updated");
  };

  const handlePause: ConnectorAction = async (connector) => {
    const response = await pauseConnector({ id: connector.id });
    if (response.error) {
      toast.error(response.error.message);
      return;
    }
    refresh();
    toast.success("Connector paused");
  };

  const handleResume: ConnectorAction = async (connector) => {
    const response = await resumeConnector({ id: connector.id });
    if (response.error) {
      toast.error(response.error.message);
      return;
    }
    refresh();
    toast.success("Connector resumed");
  };

  const handleArchive: ConnectorAction = async (connector) => {
    const response = await archiveConnector({ id: connector.id });
    if (response.error) {
      toast.error(response.error.message);
      return;
    }
    refresh();
    toast.success("Connector archived");
  };

  const handleRunNow: ConnectorAction = async (connector) => {
    setRunningConnectorId(connector.id);
    try {
      const response = await runConnectorNow({ id: connector.id });
      if (response.error) {
        toast.error(response.error.message);
        return;
      }

      const results = response.data?.runConnectorNow.results ?? [];
      const dispatched = results.filter(
        (item) => item.status === "dispatched",
      ).length;
      const duplicates = results.filter(
        (item) => item.status === "duplicate",
      ).length;
      const failed = results.find((item) => item.status === "failed");
      refresh();
      if (failed) {
        toast.error(failed.error ?? "Connector run failed");
      } else if (dispatched > 0) {
        toast.success(`Dispatched ${dispatched} Linear issue`);
      } else if (duplicates > 0) {
        toast.info("Linear issue is already in flight");
      } else {
        toast.info(
          results[0]?.reason
            ? statusLabel(results[0].reason)
            : "No Linear issues matched",
        );
      }
    } finally {
      setRunningConnectorId(null);
    }
  };

  return (
    <PageLayout
      header={
        <div className="grid items-start gap-3 lg:grid-cols-[1fr_auto_1fr]">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold leading-tight tracking-tight text-foreground">
              Symphony
            </h1>
            <p className="text-sm text-muted-foreground">
              {activeCount} active, {pausedCount} paused, {archivedCount}{" "}
              archived
            </p>
          </div>
          <div className="flex justify-start lg:justify-center">
            <Tabs value={tab}>
              <TabsList>
                <TabsTrigger value="connectors" asChild className="px-4">
                  <Link to="/symphony" search={{ tab: "connectors" }}>
                    Connectors
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="runs" asChild className="px-4">
                  <Link to="/symphony" search={{ tab: "runs" }}>
                    Runs
                  </Link>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex justify-start lg:justify-end">
            {tab === "connectors" ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                New Connector
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={refresh}
                disabled={result.fetching || runsResult.fetching}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            )}
          </div>
        </div>
      }
    >
      {isLoading ? (
        <PageSkeleton />
      ) : result.error ? (
        <p className="text-sm text-destructive">{result.error.message}</p>
      ) : tab === "connectors" ? (
        <div className="space-y-4">
          {connectors.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="relative max-w-sm flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search connectors..."
                  className="pl-7 text-sm"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={refresh}
                disabled={result.fetching}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
          )}

          {connectors.length === 0 ? (
            <EmptyState
              icon={Network}
              title="No connectors"
              description="Create a connector row for the upcoming Symphony dispatch runtime."
              action={{
                label: "New Connector",
                onClick: () => setCreating(true),
              }}
            />
          ) : rows.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No matching connectors.
            </p>
          ) : (
            <DataTable
              columns={connectorColumns({
                onEdit: setEditing,
                onPause: handlePause,
                onResume: handleResume,
                onArchive: handleArchive,
                onRunNow: handleRunNow,
                runningConnectorId,
                activeCredentialSlugs: credentialsResult.data
                  ? activeCredentialSlugs
                  : null,
              })}
              data={rows}
              pageSize={20}
              allowHorizontalScroll={false}
              tableClassName="table-fixed [&_tbody_tr]:h-11 [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap"
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {runsResult.fetching && !runsResult.data
                ? "Loading recent pickup history..."
                : `${visibleRuns.length} visible of ${runs.length} recent executions`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={executionConnectorId}
                onValueChange={setExecutionConnectorId}
              >
                <SelectTrigger className="h-8 w-[220px] text-xs">
                  <Filter className="h-3.5 w-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All connectors</SelectItem>
                  {connectors.map((connector) => (
                    <SelectItem key={connector.id} value={connector.id}>
                      {connector.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant={showCancelledRuns ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowCancelledRuns((value) => !value)}
              >
                <Archive className="h-4 w-4" />
                {showCancelledRuns ? "Hide cancelled" : "Show cancelled"}
              </Button>
            </div>
          </div>

          {runsResult.error ? (
            <p className="text-sm text-destructive">
              {runsResult.error.message}
            </p>
          ) : visibleRuns.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No connector runs match the current filters.
            </div>
          ) : (
            <DataTable
              columns={connectorRunLifecycleColumns({
                onOpenThread: (threadId) =>
                  navigate({
                    to: "/threads/$threadId",
                    params: { threadId },
                  }),
              })}
              data={visibleRuns}
              pageSize={15}
              allowHorizontalScroll={false}
              tableClassName="table-fixed [&_tbody_tr]:h-11 [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap"
            />
          )}
        </div>
      )}

      <ConnectorFormDialog
        mode="create"
        open={creating}
        onOpenChange={setCreating}
        onSubmit={handleCreate}
        credentialOptions={credentialOptions}
        activeCredentialSlugs={activeCredentialSlugs}
        credentialsLoading={credentialsResult.fetching}
      />
      <ConnectorFormDialog
        mode="edit"
        open={editing != null}
        onOpenChange={(open) => !open && setEditing(null)}
        connector={editing}
        onSubmit={handleUpdate}
        credentialOptions={credentialOptions}
        activeCredentialSlugs={activeCredentialSlugs}
        credentialsLoading={credentialsResult.fetching}
      />
    </PageLayout>
  );
}

function connectorRunLifecycleColumns(args: {
  onOpenThread: (threadId: string) => void;
}): ColumnDef<ConnectorRunLifecycleRow>[] {
  return [
    {
      id: "executionState",
      header: "State",
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={cn(
            "text-xs font-medium",
            connectorExecutionStateTone(row.original.execution.currentState),
          )}
        >
          {statusLabel(row.original.execution.currentState)}
        </Badge>
      ),
      size: 78,
    },
    {
      header: "External ref",
      cell: ({ row }) => (
        <span
          className="block truncate font-mono text-xs"
          title={row.original.execution.externalRef}
        >
          {connectorExecutionLinearIdentifier(
            row.original.execution.outcomePayload,
            row.original.execution.externalRef,
          )}
        </span>
      ),
      size: 80,
    },
    {
      id: "connector",
      header: "Connector",
      cell: ({ row }) => (
        <span className="block truncate font-medium">
          {row.original.connector.name}
        </span>
      ),
      size: 120,
    },
    {
      id: "lifecycle",
      header: "Lifecycle",
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          <LifecycleStage
            label="Task"
            status={row.original.computerTask?.status}
            detail={row.original.computerTask?.id}
          />
          <LifecycleStage
            label="Delegation"
            status={row.original.delegation?.status}
            detail={delegationDetail(row.original)}
          />
          <LifecycleStage
            label="Turn"
            status={row.original.threadTurn?.status}
            detail={threadTurnDetail(row.original)}
          />
        </div>
      ),
      size: 205,
    },
    {
      id: "writeback",
      header: "Writeback",
      cell: ({ row }) => (
        <WritebackStage payload={row.original.execution.outcomePayload} />
      ),
      size: 110,
    },
    {
      id: "pr",
      header: "PR",
      cell: ({ row }) => <PrStage run={row.original} />,
      size: 72,
    },
    {
      id: "thread",
      header: "Open",
      cell: ({ row }) => {
        const threadId =
          row.original.threadId ??
          row.original.threadTurn?.threadId ??
          connectorExecutionThreadId(row.original.execution.outcomePayload);
        return threadId ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 justify-center px-0"
            onClick={() => args.onOpenThread(threadId)}
            title={`Open thread ${threadId}`}
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">No thread</span>
        );
      },
      size: 42,
    },
    {
      id: "updated",
      header: "Age",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {relativeTime(latestRunTimestamp(row.original))}
        </span>
      ),
      size: 62,
    },
  ];
}

function PrStage({ run }: { run: ConnectorRunLifecycleRow }) {
  const display = connectorExecutionPrDisplay(
    run.delegation?.result,
    run.delegation?.outputArtifacts,
    run.threadTurn?.resultJson,
    run.execution.outcomePayload,
  );
  if (!display) {
    return <span className="text-xs text-muted-foreground">No PR</span>;
  }

  return (
    <a
      href={display.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-primary hover:underline"
      title={display.title}
    >
      <ExternalLink className="h-3 w-3 shrink-0" />
      <span className="truncate">{display.label}</span>
    </a>
  );
}

function WritebackStage({ payload }: { payload: unknown }) {
  const display = connectorExecutionWritebackDisplay(payload);
  if (!display) {
    const cleanup = connectorExecutionCleanupDisplay(payload);
    if (!cleanup) return null;

    return (
      <span
        className="block min-w-0 truncate rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
        title={cleanup.title}
      >
        {cleanup.label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "block min-w-0 truncate rounded-full px-2 py-0.5 text-xs font-medium",
        writebackTone(display.tone),
      )}
      title={display.title}
    >
      {display.label}
    </span>
  );
}

function writebackTone(
  tone: ConnectorExecutionWritebackDisplay["tone"],
): string {
  switch (tone) {
    case "success":
      return "bg-green-500/15 text-green-700 dark:text-green-300";
    case "destructive":
      return "bg-red-500/15 text-red-700 dark:text-red-300";
    case "muted":
    default:
      return "bg-muted text-muted-foreground";
  }
}

function LifecycleStage({
  label,
  status,
  detail,
}: {
  label: string;
  status?: string | null;
  detail?: string | null;
}) {
  if (!status) {
    return (
      <span
        className="min-w-0 truncate rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
        title={`${label}: Pending`}
      >
        {label}: Pending
      </span>
    );
  }

  return (
    <span
      className={cn(
        "min-w-0 truncate rounded-full px-2 py-0.5 text-xs font-medium",
        lifecycleStatusTone(status),
      )}
      title={`${label}: ${statusLabel(status)}${detail ? ` - ${detail}` : ""}`}
    >
      {label}: {statusLabel(status)}
      {detail ? ` ${detail}` : ""}
    </span>
  );
}

function lifecycleStatusTone(status: string): string {
  switch (status) {
    case "completed":
    case "succeeded":
    case "terminal":
      return "bg-green-500/15 text-green-700 dark:text-green-300";
    case "failed":
    case "timed_out":
      return "bg-red-500/15 text-red-700 dark:text-red-300";
    case "cancelled":
    case "skipped":
      return "bg-muted text-muted-foreground";
    case "pending":
    case "queued":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "running":
    default:
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
  }
}

function delegationDetail(run: ConnectorRunLifecycleRow): string | null {
  if (!run.delegation) return null;

  const error = lifecycleJsonSummary(run.delegation.error, [
    "message",
    "code",
    "status",
  ]);
  if (error) return error;

  const result = lifecycleJsonSummary(run.delegation.result, [
    "status",
    "responseLength",
    "threadTurnId",
  ]);
  return result ?? run.delegation.id;
}

function threadTurnDetail(run: ConnectorRunLifecycleRow): string | null {
  if (!run.threadTurn) return null;
  if (run.threadTurn.errorCode) return run.threadTurn.errorCode;
  if (run.threadTurn.error) return run.threadTurn.error;

  const result = parsePayloadRecord(run.threadTurn.resultJson);
  const response = result?.response;
  if (typeof response === "string" && response.trim()) {
    return `${response.length} chars`;
  }

  return run.threadTurn.id;
}

function latestRunTimestamp(run: ConnectorRunLifecycleRow): string {
  return (
    run.threadTurn?.finishedAt ??
    run.delegation?.completedAt ??
    run.computerTask?.completedAt ??
    run.execution.finishedAt ??
    run.threadTurn?.startedAt ??
    run.execution.startedAt ??
    run.execution.createdAt
  );
}

function lifecycleJsonSummary(value: unknown, keys: string[]): string | null {
  const record = parsePayloadRecord(value);
  if (!record) return null;

  for (const key of keys) {
    const field = record[key];
    if (typeof field === "string" && field.trim()) return field;
    if (typeof field === "number") return String(field);
  }

  return null;
}

function parsePayloadRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return parsePayloadRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function connectorColumns(actions: {
  onEdit: ConnectorAction;
  onPause: ConnectorAction;
  onResume: ConnectorAction;
  onArchive: ConnectorAction;
  onRunNow: ConnectorAction;
  runningConnectorId: string | null;
  activeCredentialSlugs: readonly string[] | null;
}): ColumnDef<ConnectorRow>[] {
  return [
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const connector = row.original;
        const archived = connector.status === ConnectorStatus.Archived;
        const githubStatus = actions.activeCredentialSlugs
          ? connectorGitHubCredentialStatus(
              connector.config,
              actions.activeCredentialSlugs,
            )
          : null;

        return (
          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
            <Badge
              variant="secondary"
              className={cn(
                "text-xs font-medium",
                connectorStatusTone(connector.status),
              )}
            >
              {statusLabel(connector.status)}
            </Badge>
            {connector.enabled && !archived && githubStatus?.missing && (
              <Badge
                variant="destructive"
                className="min-w-0 truncate text-xs"
                title={githubStatus.title}
              >
                GitHub setup required
              </Badge>
            )}
          </div>
        );
      },
      size: 140,
    },
    {
      accessorKey: "name",
      header: "Connector",
      cell: ({ row }) => (
        <span className="block truncate font-medium">{row.original.name}</span>
      ),
      size: 280,
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => (
        <span className="block truncate font-mono text-xs">
          {row.original.type}
        </span>
      ),
      size: 145,
    },
    {
      accessorKey: "dispatchTargetId",
      header: "Target",
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-xs font-medium">
            {connectorTargetLabel(row.original.dispatchTargetType)}
          </span>
          <span className="block min-w-0 truncate font-mono text-xs text-muted-foreground">
            {row.original.dispatchTargetId}
          </span>
        </div>
      ),
      size: 220,
    },
    {
      accessorKey: "enabled",
      header: "Enabled",
      cell: ({ row }) =>
        row.original.enabled ? (
          <Badge variant="outline" className="text-xs">
            Enabled
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Disabled
          </Badge>
        ),
      size: 100,
    },
    {
      accessorKey: "updatedAt",
      header: "Updated",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {relativeTime(row.original.updatedAt)}
        </span>
      ),
      size: 90,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const connector = row.original;
        const archived = connector.status === ConnectorStatus.Archived;
        const paused = connector.status === ConnectorStatus.Paused;
        const running = actions.runningConnectorId === connector.id;
        return (
          <div className="flex justify-end gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => actions.onRunNow(connector)}
              disabled={archived || paused || running}
              title="Run connector now"
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => actions.onEdit(connector)}
              disabled={archived}
              title="Edit connector"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() =>
                paused
                  ? actions.onResume(connector)
                  : actions.onPause(connector)
              }
              disabled={archived}
              title={paused ? "Resume connector" : "Pause connector"}
            >
              {paused ? (
                <Play className="h-4 w-4" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
            </Button>
            {!archived && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title="Archive connector"
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive connector?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the connector from active runtime use while
                      preserving its execution history.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => actions.onArchive(connector)}
                    >
                      Archive
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        );
      },
      size: 118,
    },
  ];
}

function ConnectorFormDialog({
  mode,
  open,
  onOpenChange,
  connector,
  onSubmit,
  credentialOptions = [],
  activeCredentialSlugs = [],
  credentialsLoading = false,
}: {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connector?: ConnectorRow | null;
  onSubmit: (values: ConnectorFormValues) => Promise<void>;
  credentialOptions?: ConnectorCredentialOption[];
  activeCredentialSlugs?: readonly string[];
  credentialsLoading?: boolean;
}) {
  const { tenantId } = useTenant();
  const formId = useId();
  const [values, setValues] = useState<ConnectorFormValues>(
    connectorFormValues(connector),
  );
  const [manualTargetId, setManualTargetId] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !open,
  });
  const [computersResult] = useQuery({
    query: ComputersListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !open,
  });
  const [routinesResult] = useQuery({
    query: RoutinesListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !open,
  });
  const computerTargets = useMemo(
    () => (computersResult.data?.computers ?? []) as ConnectorComputerTarget[],
    [computersResult.data?.computers],
  );
  const agentTargets = agentsResult.data?.agents ?? [];
  const routineTargets = routinesResult.data?.routines ?? [];

  useEffect(() => {
    if (open) {
      const nextValues = connectorFormValues(connector, {
        computers: computerTargets,
      });
      setValues(nextValues);
      setManualTargetId(
        nextValues.dispatchTargetType === DispatchTargetType.HybridRoutine,
      );
      setAdvancedOpen(
        nextValues.dispatchTargetType !== DispatchTargetType.Computer,
      );
      setError(null);
    }
  }, [connector, open]);

  useEffect(() => {
    if (
      !open ||
      mode !== "create" ||
      connector ||
      values.dispatchTargetType !== DispatchTargetType.Computer ||
      values.dispatchTargetId ||
      computerTargets.length === 0
    ) {
      return;
    }

    patch("dispatchTargetId", computerTargets[0]?.id ?? "");
  }, [
    computerTargets,
    connector,
    mode,
    open,
    values.dispatchTargetId,
    values.dispatchTargetType,
  ]);

  const targetOptions = useMemo(
    () =>
      connectorTargetOptions(
        values.dispatchTargetType,
        computerTargets,
        agentTargets,
        routineTargets,
      ),
    [agentTargets, computerTargets, routineTargets, values.dispatchTargetType],
  );
  const selectedTarget = targetOptions.find(
    (option) => option.id === values.dispatchTargetId,
  );
  const canUseTargetPicker =
    values.dispatchTargetType !== DispatchTargetType.HybridRoutine &&
    targetOptions.length > 0;
  const showManualTargetId = shouldUseManualTargetInput({
    targetType: values.dispatchTargetType,
    targetId: values.dispatchTargetId,
    targetOptions,
    manualTargetId,
  });
  const targetSelectValue = showManualTargetId
    ? MANUAL_TARGET_ID
    : selectedTarget?.id;
  const showComputerPicker =
    values.dispatchTargetType === DispatchTargetType.Computer &&
    canUseTargetPicker &&
    !showManualTargetId;
  const selectedGithubCredential = credentialOptions.find(
    (credential) => credential.slug === values.githubCredentialSlug,
  );
  const githubCredentialMissing =
    values.githubCredentialSlug.trim().length > 0 &&
    !credentialsLoading &&
    !activeCredentialSlugs.includes(values.githubCredentialSlug.trim());

  const patch = <K extends keyof ConnectorFormValues>(
    key: K,
    value: ConnectorFormValues[K],
  ) => setValues((current) => ({ ...current, [key]: value }));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const validationError = validateConnectorFormValues(values, {
      activeCredentialSlugs: credentialsLoading
        ? undefined
        : activeCredentialSlugs,
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? "New Linear Connector"
              : "Edit Linear Connector"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <DialogBody className="max-h-[70vh] space-y-4 py-1 pr-1">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <Field id={`${formId}-name`} label="Name">
                <Input
                  id={`${formId}-name`}
                  value={values.name}
                  onChange={(event) => patch("name", event.target.value)}
                  placeholder="Linear Symphony pickup"
                />
              </Field>
              <Field label="Type">
                <div className="flex h-9 items-center">
                  <Badge variant="secondary" className="font-mono text-xs">
                    linear_tracker
                  </Badge>
                </div>
              </Field>
            </div>

            <Field id={`${formId}-description`} label="Description">
              <Textarea
                id={`${formId}-description`}
                value={values.description}
                onChange={(event) => patch("description", event.target.value)}
                rows={2}
                placeholder="Optional notes for admins"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={`${formId}-linear-team-key`} label="Linear team key">
                <Input
                  id={`${formId}-linear-team-key`}
                  value={values.linearTeamKey}
                  onChange={(event) =>
                    patch("linearTeamKey", event.target.value)
                  }
                  placeholder="TECH"
                  autoCapitalize="characters"
                />
              </Field>
              <Field id={`${formId}-linear-label`} label="Label">
                <Input
                  id={`${formId}-linear-label`}
                  value={values.linearLabel}
                  onChange={(event) => patch("linearLabel", event.target.value)}
                  placeholder="symphony"
                />
              </Field>
              <Field id={`${formId}-linear-credential`} label="Credential">
                <Input
                  id={`${formId}-linear-credential`}
                  value={values.linearCredentialSlug}
                  onChange={(event) =>
                    patch("linearCredentialSlug", event.target.value)
                  }
                  placeholder="linear"
                />
              </Field>
              <Field
                id={`${formId}-linear-writeback-state`}
                label="Writeback state"
              >
                <Input
                  id={`${formId}-linear-writeback-state`}
                  value={values.linearWritebackState}
                  onChange={(event) =>
                    patch("linearWritebackState", event.target.value)
                  }
                  placeholder="In Progress"
                />
              </Field>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium">
                  GitHub PR setup
                </h3>
                <p className="truncate text-xs text-muted-foreground">
                  Required for branch, commit, and draft PR creation.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id={`${formId}-github-credential`}
                  label="GitHub credential"
                >
                  {credentialOptions.length > 0 ? (
                    <Select
                      value={values.githubCredentialSlug || undefined}
                      onValueChange={(value) =>
                        patch("githubCredentialSlug", value)
                      }
                    >
                      <SelectTrigger id={`${formId}-github-credential`}>
                        <SelectValue placeholder="Select GitHub credential..." />
                      </SelectTrigger>
                      <SelectContent>
                        {!selectedGithubCredential &&
                          values.githubCredentialSlug.trim() && (
                            <SelectItem
                              value={values.githubCredentialSlug.trim()}
                            >
                              Missing: {values.githubCredentialSlug.trim()}
                            </SelectItem>
                          )}
                        {credentialOptions.map((credential) => (
                          <SelectItem
                            key={credential.id}
                            value={credential.slug}
                          >
                            <span className="flex min-w-0 flex-col items-start gap-0">
                              <span className="truncate">
                                {credential.displayName}
                              </span>
                              <span className="truncate font-mono text-xs text-muted-foreground">
                                {credential.slug}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`${formId}-github-credential`}
                      value={values.githubCredentialSlug}
                      onChange={(event) =>
                        patch("githubCredentialSlug", event.target.value)
                      }
                      placeholder="github"
                    />
                  )}
                  {credentialsLoading ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Loading active tenant credentials...
                    </p>
                  ) : githubCredentialMissing ? (
                    <p className="mt-1 text-xs text-destructive">
                      {`Active GitHub credential "${values.githubCredentialSlug.trim()}" is missing.`}
                    </p>
                  ) : null}
                </Field>
                <Field id={`${formId}-github-owner`} label="GitHub owner">
                  <Input
                    id={`${formId}-github-owner`}
                    value={values.githubOwner}
                    onChange={(event) =>
                      patch("githubOwner", event.target.value)
                    }
                    placeholder="thinkwork-ai"
                  />
                </Field>
                <Field id={`${formId}-github-repo`} label="Repository">
                  <Input
                    id={`${formId}-github-repo`}
                    value={values.githubRepoName}
                    onChange={(event) =>
                      patch("githubRepoName", event.target.value)
                    }
                    placeholder="thinkwork"
                  />
                </Field>
                <Field id={`${formId}-github-base`} label="Base branch">
                  <Input
                    id={`${formId}-github-base`}
                    value={values.githubBaseBranch}
                    onChange={(event) =>
                      patch("githubBaseBranch", event.target.value)
                    }
                    placeholder="main"
                  />
                </Field>
                <Field id={`${formId}-github-file`} label="Checkpoint file">
                  <Input
                    id={`${formId}-github-file`}
                    value={values.githubFilePath}
                    onChange={(event) =>
                      patch("githubFilePath", event.target.value)
                    }
                    placeholder="README.md"
                  />
                </Field>
              </div>
            </div>

            <Field
              id={`${formId}-target-computer`}
              label={
                values.dispatchTargetType === DispatchTargetType.Computer
                  ? "Target Computer"
                  : `${connectorTargetLabel(values.dispatchTargetType)} target`
              }
            >
              {showComputerPicker ? (
                <Select
                  value={selectedTarget?.id}
                  onValueChange={(value) => patch("dispatchTargetId", value)}
                >
                  <SelectTrigger id={`${formId}-target-computer`}>
                    <SelectValue placeholder="Select Computer..." />
                  </SelectTrigger>
                  <SelectContent>
                    {computerTargets.map((computer) => (
                      <SelectItem key={computer.id} value={computer.id}>
                        <span className="flex min-w-0 flex-col items-start gap-0">
                          <span className="truncate">{computer.name}</span>
                          {(computer.owner?.name ||
                            computer.owner?.email ||
                            computer.runtimeStatus ||
                            computer.status) && (
                            <span className="truncate text-xs text-muted-foreground">
                              {[
                                computer.owner?.name ?? computer.owner?.email,
                                computer.runtimeStatus ?? computer.status,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`${formId}-target-computer`}
                  value={values.dispatchTargetId}
                  onChange={(event) =>
                    patch("dispatchTargetId", event.target.value)
                  }
                  placeholder={`${connectorTargetLabel(values.dispatchTargetType)} id`}
                />
              )}
              {selectedTarget && showComputerPicker && (
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {selectedTarget.id}
                </p>
              )}
            </Field>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full justify-between"
                >
                  Advanced connector settings
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      advancedOpen && "rotate-180",
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
                  <Field id={`${formId}-target-type`} label="Target Type">
                    <Select
                      value={values.dispatchTargetType}
                      onValueChange={(value) => {
                        const nextType = value as DispatchTargetType;
                        const nextOptions = connectorTargetOptions(
                          nextType,
                          computerTargets,
                          agentTargets,
                          routineTargets,
                        );
                        patch("dispatchTargetType", nextType);
                        patch("dispatchTargetId", nextOptions[0]?.id ?? "");
                        setManualTargetId(
                          nextType === DispatchTargetType.HybridRoutine,
                        );
                      }}
                    >
                      <SelectTrigger id={`${formId}-target-type`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Default</SelectLabel>
                          <SelectItem value={DispatchTargetType.Computer}>
                            <Monitor className="h-3.5 w-3.5" />
                            Computer
                          </SelectItem>
                        </SelectGroup>
                        <SelectSeparator />
                        <SelectGroup>
                          <SelectLabel>Advanced direct targets</SelectLabel>
                          <SelectItem value={DispatchTargetType.Agent}>
                            Agent
                          </SelectItem>
                          <SelectItem value={DispatchTargetType.Routine}>
                            Routine
                          </SelectItem>
                          <SelectItem value={DispatchTargetType.HybridRoutine}>
                            Hybrid Routine
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    id={`${formId}-advanced-target`}
                    label={
                      manualTargetId || !canUseTargetPicker
                        ? "Target ID"
                        : "Target"
                    }
                  >
                    {canUseTargetPicker ? (
                      <Select
                        value={targetSelectValue}
                        onValueChange={(value) => {
                          if (value === MANUAL_TARGET_ID) {
                            setManualTargetId(true);
                            return;
                          }
                          setManualTargetId(false);
                          patch("dispatchTargetId", value);
                        }}
                      >
                        <SelectTrigger id={`${formId}-advanced-target`}>
                          <SelectValue placeholder="Select target..." />
                        </SelectTrigger>
                        <SelectContent>
                          {targetOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              <span className="flex min-w-0 flex-col items-start gap-0">
                                <span className="truncate">{option.label}</span>
                                {option.description && (
                                  <span className="truncate text-xs text-muted-foreground">
                                    {option.description}
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                          <SelectItem value={MANUAL_TARGET_ID}>
                            Manual target ID...
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    ) : null}
                    {showManualTargetId && (
                      <div className="mt-2 flex gap-2">
                        <Input
                          id={`${formId}-advanced-target`}
                          value={values.dispatchTargetId}
                          onChange={(event) =>
                            patch("dispatchTargetId", event.target.value)
                          }
                          placeholder={`${connectorTargetLabel(values.dispatchTargetType)} id`}
                        />
                        {manualTargetId && canUseTargetPicker && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setManualTargetId(false)}
                          >
                            Use picker
                          </Button>
                        )}
                      </div>
                    )}
                    {selectedTarget && !showManualTargetId && (
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {selectedTarget.id}
                      </p>
                    )}
                  </Field>
                </div>

                <Field id={`${formId}-connection-id`} label="Connection ID">
                  <Input
                    id={`${formId}-connection-id`}
                    value={values.connectionId}
                    onChange={(event) =>
                      patch("connectionId", event.target.value)
                    }
                    placeholder="Optional EventBridge connection id"
                  />
                </Field>

                <Field
                  id={`${formId}-config-json`}
                  label="Config JSON"
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        patch("configJson", linearTrackerStarterConfigJson())
                      }
                    >
                      <Sparkles className="h-3 w-3" />
                      Linear starter
                    </Button>
                  }
                >
                  <Textarea
                    id={`${formId}-config-json`}
                    value={values.configJson}
                    onChange={(event) =>
                      patch("configJson", event.target.value)
                    }
                    rows={8}
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                </Field>
              </CollapsibleContent>
            </Collapsible>

            <label className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
              <span>
                <span className="block text-sm font-medium">Enabled</span>
                <span className="block text-xs text-muted-foreground">
                  Disabled connectors stay configured but should not be
                  dispatched by the runtime.
                </span>
              </span>
              <Switch
                checked={values.enabled}
                onCheckedChange={(checked) => patch("enabled", checked)}
              />
            </label>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </DialogBody>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  action,
  children,
}: {
  id?: string;
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {action}
      </div>
      {children}
    </div>
  );
}

function credentialOptionsFromQuery(
  credentials?: readonly ConnectorCredentialOption[] | null,
): ConnectorCredentialOption[] {
  return (credentials ?? [])
    .filter((credential) => credential.status === TenantCredentialStatus.Active)
    .map((credential) => ({
      id: credential.id,
      displayName: credential.displayName,
      slug: credential.slug,
      status: credential.status,
    }));
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
