import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import type { FormEvent, ReactNode } from "react";
import {
  Archive,
  ExternalLink,
  Filter,
  Loader2,
  Network,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
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
  ConnectorExecutionsListQuery,
  ConnectorsListQuery,
  CreateConnectorMutation,
  PauseConnectorMutation,
  ResumeConnectorMutation,
  RoutinesListQuery,
  RunConnectorNowMutation,
  UpdateConnectorMutation,
} from "@/lib/graphql-queries";
import {
  connectorFormValues,
  connectorExecutionCleanupReason,
  connectorExecutionLinearIdentifier,
  connectorExecutionStateTone,
  connectorExecutionThreadId,
  connectorStatusTone,
  connectorTargetLabel,
  connectorTargetOptions,
  createConnectorInput,
  linearTrackerStarterConfigJson,
  parseConnectorConfig,
  shouldUseManualTargetInput,
  updateConnectorInput,
  type ConnectorFormValues,
} from "@/lib/connector-admin";
import {
  ConnectorStatus,
  ConnectorExecutionState,
  DispatchTargetType,
  type ConnectorFilter,
} from "@/gql/graphql";
import { cn, relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/symphony")({
  component: SymphonyPage,
});

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

type ConnectorExecutionRow = {
  id: string;
  tenantId: string;
  connectorId: string;
  externalRef: string;
  currentState: ConnectorExecutionState;
  startedAt: string | null;
  finishedAt: string | null;
  errorClass: string | null;
  outcomePayload: unknown;
  retryAttempt: number;
  createdAt: string;
};

const MANUAL_TARGET_ID = "__manual_target_id__";

function SymphonyPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [selectedTab, setSelectedTab] = useState("connectors");
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
  const [executionsResult, refetchExecutions] = useQuery({
    query: ConnectorExecutionsListQuery,
    variables: {
      connectorId: selectedExecutionConnectorId,
      status: null,
      limit: 50,
      cursor: null,
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
  const executions = (executionsResult.data?.connectorExecutions ??
    []) as ConnectorExecutionRow[];
  const connectorById = useMemo(
    () => new Map(connectors.map((connector) => [connector.id, connector])),
    [connectors],
  );
  const visibleExecutions = useMemo(() => {
    if (showCancelledRuns) return executions;
    return executions.filter(
      (execution) =>
        execution.currentState !== ConnectorExecutionState.Cancelled,
    );
  }, [executions, showCancelledRuns]);
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
    refetchExecutions({ requestPolicy: "network-only" });
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
            <Tabs value={selectedTab} onValueChange={setSelectedTab}>
              <TabsList>
                <TabsTrigger value="connectors" className="px-4">
                  Connectors
                </TabsTrigger>
                <TabsTrigger value="runs" className="px-4">
                  Runs
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex justify-start lg:justify-end">
            {selectedTab === "connectors" ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                New Connector
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={refresh}
                disabled={result.fetching || executionsResult.fetching}
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
      ) : selectedTab === "connectors" ? (
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
              })}
              data={rows}
              pageSize={20}
              allowHorizontalScroll={false}
              tableClassName="table-fixed [&_tbody_tr]:h-11"
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {executionsResult.fetching && !executionsResult.data
                ? "Loading recent pickup history..."
                : `${visibleExecutions.length} visible of ${executions.length} recent executions`}
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

          {executionsResult.error ? (
            <p className="text-sm text-destructive">
              {executionsResult.error.message}
            </p>
          ) : visibleExecutions.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No connector runs match the current filters.
            </div>
          ) : (
            <DataTable
              columns={connectorExecutionColumns({
                connectorById,
                onOpenThread: (threadId) =>
                  navigate({
                    to: "/threads/$threadId",
                    params: { threadId },
                  }),
              })}
              data={visibleExecutions}
              pageSize={15}
              allowHorizontalScroll={false}
              tableClassName="table-fixed [&_tbody_tr]:h-11"
            />
          )}
        </div>
      )}

      <ConnectorFormDialog
        mode="create"
        open={creating}
        onOpenChange={setCreating}
        onSubmit={handleCreate}
      />
      <ConnectorFormDialog
        mode="edit"
        open={editing != null}
        onOpenChange={(open) => !open && setEditing(null)}
        connector={editing}
        onSubmit={handleUpdate}
      />
    </PageLayout>
  );
}

function connectorExecutionColumns(args: {
  connectorById: Map<string, ConnectorRow>;
  onOpenThread: (threadId: string) => void;
}): ColumnDef<ConnectorExecutionRow>[] {
  return [
    {
      accessorKey: "currentState",
      header: "State",
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={cn(
            "text-xs font-medium",
            connectorExecutionStateTone(row.original.currentState),
          )}
        >
          {statusLabel(row.original.currentState)}
        </Badge>
      ),
      size: 105,
    },
    {
      accessorKey: "connectorId",
      header: "Connector",
      cell: ({ row }) => {
        const connector = args.connectorById.get(row.original.connectorId);
        return (
          <span className="block truncate font-medium">
            {connector?.name ?? row.original.connectorId}
          </span>
        );
      },
      size: 210,
    },
    {
      accessorKey: "externalRef",
      header: "External ref",
      cell: ({ row }) => (
        <span className="block truncate font-mono text-xs">
          {connectorExecutionLinearIdentifier(
            row.original.outcomePayload,
            row.original.externalRef,
          )}
        </span>
      ),
      size: 185,
    },
    {
      id: "thread",
      header: "Thread",
      cell: ({ row }) => {
        const threadId = connectorExecutionThreadId(
          row.original.outcomePayload,
        );
        return threadId ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start gap-1 px-2 font-mono text-xs"
            onClick={() => args.onOpenThread(threadId)}
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{threadId}</span>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">No thread</span>
        );
      },
      size: 175,
    },
    {
      id: "details",
      header: "Details",
      cell: ({ row }) => {
        const cleanupReason = connectorExecutionCleanupReason(
          row.original.outcomePayload,
        );
        const detail = cleanupReason ?? row.original.errorClass;
        return detail ? (
          <span className="block truncate text-xs text-muted-foreground">
            {statusLabel(detail)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Attempt {row.original.retryAttempt + 1}
          </span>
        );
      },
      size: 180,
    },
    {
      accessorKey: "startedAt",
      header: "Started",
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">
          {row.original.startedAt
            ? relativeTime(row.original.startedAt)
            : relativeTime(row.original.createdAt)}
        </div>
      ),
      size: 95,
    },
    {
      accessorKey: "finishedAt",
      header: "Finished",
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">
          {row.original.finishedAt
            ? relativeTime(row.original.finishedAt)
            : "—"}
        </div>
      ),
      size: 95,
    },
  ];
}

function connectorColumns(actions: {
  onEdit: ConnectorAction;
  onPause: ConnectorAction;
  onResume: ConnectorAction;
  onArchive: ConnectorAction;
  onRunNow: ConnectorAction;
  runningConnectorId: string | null;
}): ColumnDef<ConnectorRow>[] {
  return [
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={cn(
            "text-xs font-medium",
            connectorStatusTone(row.original.status),
          )}
        >
          {statusLabel(row.original.status)}
        </Badge>
      ),
      size: 95,
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
}: {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connector?: ConnectorRow | null;
  onSubmit: (values: ConnectorFormValues) => Promise<void>;
}) {
  const { tenantId } = useTenant();
  const [values, setValues] = useState<ConnectorFormValues>(
    connectorFormValues(connector),
  );
  const [manualTargetId, setManualTargetId] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !open,
  });
  const [routinesResult] = useQuery({
    query: RoutinesListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !open,
  });

  useEffect(() => {
    if (open) {
      const nextValues = connectorFormValues(connector);
      setValues(nextValues);
      setManualTargetId(
        nextValues.dispatchTargetType === DispatchTargetType.HybridRoutine,
      );
      setError(null);
    }
  }, [connector, open]);

  const targetOptions = useMemo(
    () =>
      connectorTargetOptions(
        values.dispatchTargetType,
        agentsResult.data?.agents ?? [],
        routinesResult.data?.routines ?? [],
      ),
    [
      agentsResult.data?.agents,
      routinesResult.data?.routines,
      values.dispatchTargetType,
    ],
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

  const patch = <K extends keyof ConnectorFormValues>(
    key: K,
    value: ConnectorFormValues[K],
  ) => setValues((current) => ({ ...current, [key]: value }));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!values.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!values.type.trim()) {
      setError("Type is required.");
      return;
    }
    if (!values.dispatchTargetId.trim()) {
      setError("Dispatch target id is required.");
      return;
    }

    try {
      parseConnectorConfig(values.configJson);
    } catch {
      setError("Config must be valid JSON.");
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
            {mode === "create" ? "New Connector" : "Edit Connector"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <DialogBody className="max-h-[70vh] space-y-4 py-1 pr-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={values.name}
                  onChange={(event) => patch("name", event.target.value)}
                  placeholder="Linear intake"
                />
              </Field>
              <Field label="Type">
                <Input
                  value={values.type}
                  onChange={(event) => patch("type", event.target.value)}
                  placeholder="linear_tracker"
                />
              </Field>
            </div>

            <Field label="Description">
              <Textarea
                value={values.description}
                onChange={(event) => patch("description", event.target.value)}
                rows={2}
                placeholder="Optional notes for admins"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
              <Field label="Target Type">
                <Select
                  value={values.dispatchTargetType}
                  onValueChange={(value) => {
                    const nextType = value as DispatchTargetType;
                    patch("dispatchTargetType", nextType);
                    patch("dispatchTargetId", "");
                    setManualTargetId(
                      nextType === DispatchTargetType.HybridRoutine,
                    );
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DispatchTargetType.Agent}>
                      Agent
                    </SelectItem>
                    <SelectItem value={DispatchTargetType.Routine}>
                      Routine
                    </SelectItem>
                    <SelectItem value={DispatchTargetType.HybridRoutine}>
                      Hybrid Routine
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label={
                  manualTargetId || !canUseTargetPicker ? "Target ID" : "Target"
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
                    <SelectTrigger>
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
                      value={values.dispatchTargetId}
                      onChange={(event) =>
                        patch("dispatchTargetId", event.target.value)
                      }
                      placeholder="Agent or routine id"
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

            <Field label="Connection ID">
              <Input
                value={values.connectionId}
                onChange={(event) => patch("connectionId", event.target.value)}
                placeholder="Optional EventBridge connection id"
              />
            </Field>

            <Field
              label="Config JSON"
              action={
                values.type.trim() === "linear_tracker" ? (
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
                ) : null
              }
            >
              <Textarea
                value={values.configJson}
                onChange={(event) => patch("configJson", event.target.value)}
                rows={8}
                className="font-mono text-xs"
                spellCheck={false}
              />
            </Field>

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
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {action}
      </div>
      {children}
    </div>
  );
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
