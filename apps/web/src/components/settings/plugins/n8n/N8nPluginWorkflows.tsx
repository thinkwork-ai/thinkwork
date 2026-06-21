import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Badge, Button } from "@thinkwork/ui";
import { Link2, RefreshCw } from "lucide-react";
import {
  SettingsConnectN8nWorkflowMutation,
  SettingsDiscoverN8nWorkflowsQuery,
} from "@/lib/settings-queries";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function N8nPluginWorkflows({
  installId,
}: {
  installId: string | null;
}) {
  const [result, refresh] = useQuery({
    query: SettingsDiscoverN8nWorkflowsQuery,
    variables: { installId: installId ?? "" },
    pause: !installId,
    requestPolicy: "cache-and-network",
  });
  const [connectState, connectWorkflow] = useMutation(
    SettingsConnectN8nWorkflowMutation,
  );
  const discovery = result.data?.discoverN8nWorkflows ?? null;
  const workflows = discovery?.workflows ?? [];

  async function connect(workflow: (typeof workflows)[number]) {
    if (!installId) return;
    const response = await connectWorkflow({
      input: {
        installId,
        externalWorkflowId: workflow.externalWorkflowId,
        externalWorkflowName: workflow.name,
        active: workflow.active,
        triggerTypes: workflow.triggerTypes,
        lastModifiedAt: workflow.lastModifiedAt,
        idempotencyKey: [
          "n8n",
          "connect",
          workflow.externalWorkflowId,
          Date.now().toString(36),
        ].join("-"),
      },
    });
    if (response.error) {
      toast.error(`Could not connect workflow: ${response.error.message}`);
      return;
    }
    toast.success(
      response.data?.connectN8nWorkflow.created
        ? "Workflow connected."
        : "Workflow connection refreshed.",
    );
    refresh({ requestPolicy: "network-only" });
  }

  if (!installId) {
    return (
      <SettingsSection label="Workflows">
        <p className="text-sm text-muted-foreground">
          Install the n8n plugin before discovering workflows.
        </p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      label="Workflows"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={result.fetching}
          onClick={() => refresh({ requestPolicy: "network-only" })}
        >
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      }
    >
      <SettingsRow
        label="Discovery"
        description="Available n8n workflows pulled through the installed plugin connection."
        layout="stacked"
      >
        <div className="flex flex-wrap items-center gap-2">
          <ReadinessBadge state={discovery?.readinessState ?? "unknown"} />
          {result.fetching ? (
            <span className="text-sm text-muted-foreground">Refreshing...</span>
          ) : null}
        </div>
        <ReadinessReasons reasons={discovery?.readinessReasons} />
      </SettingsRow>

      <div className="overflow-hidden rounded-md border border-border">
        {workflows.map((workflow) => {
          const connected = Boolean(workflow.connectedWorkflowId);
          return (
            <div
              key={workflow.externalWorkflowId}
              className="grid gap-3 border-b border-border px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0 space-y-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-foreground">
                    {workflow.name}
                  </span>
                  <Badge variant={connected ? "default" : "outline"}>
                    {connected ? "Connected" : "Available"}
                  </Badge>
                  <Badge variant="outline">
                    {workflow.active === false
                      ? "Inactive"
                      : workflow.active === true
                        ? "Active"
                        : "Unknown"}
                  </Badge>
                  <ReadinessBadge state={workflow.readinessState} />
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <code className="font-mono">
                    {workflow.externalWorkflowId}
                  </code>
                  {workflow.triggerTypes.map((trigger) => (
                    <Badge key={trigger} variant="outline">
                      {trigger}
                    </Badge>
                  ))}
                  {workflow.lastModifiedAt ? (
                    <span>Modified {formatDate(workflow.lastModifiedAt)}</span>
                  ) : null}
                  {workflow.lastExecutionAt ? (
                    <span>Last run {formatDate(workflow.lastExecutionAt)}</span>
                  ) : null}
                </div>
                <ReadinessReasons reasons={workflow.readinessReasons} />
                {workflow.warnings.length ? (
                  <div className="space-y-1">
                    {workflow.warnings.map((warning) => (
                      <p key={warning} className="text-sm text-amber-500">
                        {warning}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant={connected ? "outline" : "default"}
                disabled={connectState.fetching}
                onClick={() => void connect(workflow)}
              >
                <Link2 className="size-4" />
                {connected ? "Refresh connection" : "Connect"}
              </Button>
            </div>
          );
        })}
        {!workflows.length ? (
          <div className="px-4 py-3 text-sm text-muted-foreground">
            {result.fetching
              ? "Loading n8n workflows..."
              : "No n8n workflows have been discovered yet."}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

function ReadinessBadge({ state }: { state: string }) {
  const className =
    state === "ready"
      ? "border-emerald-500/40 text-emerald-400"
      : state === "blocked_not_ready"
        ? "border-amber-500/40 text-amber-500"
        : state === "disabled"
          ? "border-destructive/40 text-destructive"
          : undefined;
  return (
    <Badge variant="outline" className={className}>
      {state.replace(/_/g, " ")}
    </Badge>
  );
}

function ReadinessReasons({ reasons }: { reasons?: unknown }) {
  if (!Array.isArray(reasons) || reasons.length === 0) return null;
  return (
    <div className="space-y-1">
      {reasons.map((reason, index) => (
        <p key={index} className="text-sm text-muted-foreground">
          {reasonMessage(reason)}
        </p>
      ))}
    </div>
  );
}

function reasonMessage(reason: unknown): string {
  if (!reason || typeof reason !== "object" || Array.isArray(reason)) {
    return String(reason);
  }
  const record = reason as Record<string, unknown>;
  return typeof record.message === "string"
    ? record.message
    : JSON.stringify(record);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
