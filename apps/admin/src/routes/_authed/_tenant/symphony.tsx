import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import type { FormEvent, ReactNode } from "react";
import {
  Archive,
  Loader2,
  Network,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
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
  ArchiveConnectorMutation,
  ConnectorsListQuery,
  CreateConnectorMutation,
  PauseConnectorMutation,
  ResumeConnectorMutation,
  UpdateConnectorMutation,
} from "@/lib/graphql-queries";
import {
  connectorFormValues,
  connectorStatusTone,
  connectorTargetLabel,
  createConnectorInput,
  parseConnectorConfig,
  updateConnectorInput,
  type ConnectorFormValues,
} from "@/lib/connector-admin";
import {
  ConnectorStatus,
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

function SymphonyPage() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ConnectorRow | null>(null);
  const [creating, setCreating] = useState(false);
  useBreadcrumbs([{ label: "Symphony" }]);

  const filter: ConnectorFilter = { includeArchived: true };
  const [result, refetch] = useQuery({
    query: ConnectorsListQuery,
    variables: { filter, limit: 100, cursor: null },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [, createConnector] = useMutation(CreateConnectorMutation);
  const [, updateConnector] = useMutation(UpdateConnectorMutation);
  const [, pauseConnector] = useMutation(PauseConnectorMutation);
  const [, resumeConnector] = useMutation(ResumeConnectorMutation);
  const [, archiveConnector] = useMutation(ArchiveConnectorMutation);

  const connectors = (result.data?.connectors ?? []) as ConnectorRow[];
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

  const refresh = () => refetch({ requestPolicy: "network-only" });
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

  return (
    <PageLayout
      header={
        <>
          <PageHeader
            title="Symphony"
            description={`${activeCount} active, ${pausedCount} paused, ${archivedCount} archived`}
            actions={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                New Connector
              </Button>
            }
          />

          {connectors.length > 0 && (
            <div className="mt-4 flex items-center gap-2">
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
        </>
      }
    >
      {isLoading ? (
        <PageSkeleton />
      ) : result.error ? (
        <p className="text-sm text-destructive">{result.error.message}</p>
      ) : connectors.length === 0 ? (
        <EmptyState
          icon={Network}
          title="No connectors"
          description="Create a connector row for the upcoming Symphony dispatch runtime."
          action={{ label: "New Connector", onClick: () => setCreating(true) }}
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
          })}
          data={rows}
          pageSize={20}
          tableClassName="table-fixed"
        />
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

function connectorColumns(actions: {
  onEdit: ConnectorAction;
  onPause: ConnectorAction;
  onResume: ConnectorAction;
  onArchive: ConnectorAction;
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
      size: 105,
    },
    {
      accessorKey: "name",
      header: "Connector",
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.original.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {row.original.description ?? row.original.id}
          </div>
        </div>
      ),
      size: 260,
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => (
        <span className="truncate font-mono text-xs">{row.original.type}</span>
      ),
      size: 160,
    },
    {
      accessorKey: "dispatchTargetId",
      header: "Target",
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="text-xs font-medium">
            {connectorTargetLabel(row.original.dispatchTargetType)}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {row.original.dispatchTargetId}
          </div>
        </div>
      ),
      size: 260,
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
      size: 105,
    },
    {
      accessorKey: "updatedAt",
      header: "Updated",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {relativeTime(row.original.updatedAt)}
        </span>
      ),
      size: 120,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const connector = row.original;
        const archived = connector.status === ConnectorStatus.Archived;
        const paused = connector.status === ConnectorStatus.Paused;
        return (
          <div className="flex justify-end gap-1">
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
                paused ? actions.onResume(connector) : actions.onPause(connector)
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
      size: 130,
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
  const [values, setValues] = useState<ConnectorFormValues>(
    connectorFormValues(connector),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(connectorFormValues(connector));
      setError(null);
    }
  }, [connector, open]);

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
                  onValueChange={(value) =>
                    patch("dispatchTargetType", value as DispatchTargetType)
                  }
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
              <Field label="Target ID">
                <Input
                  value={values.dispatchTargetId}
                  onChange={(event) =>
                    patch("dispatchTargetId", event.target.value)
                  }
                  placeholder="Agent or routine id"
                />
              </Field>
            </div>

            <Field label="Connection ID">
              <Input
                value={values.connectionId}
                onChange={(event) => patch("connectionId", event.target.value)}
                placeholder="Optional EventBridge connection id"
              />
            </Field>

            <Field label="Config JSON">
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
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
