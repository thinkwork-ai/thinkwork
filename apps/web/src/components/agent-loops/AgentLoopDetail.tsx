import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Archive,
  Loader2,
  Pause,
  Pencil,
  Play,
  RotateCw,
  Zap,
} from "lucide-react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
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
  Badge,
  Button,
  DataTable,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  SettingsPageTitle,
  SettingsPane,
} from "@/components/settings/SettingsContent";
import { StatusBadge } from "@/components/StatusBadge";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  DefinitionList,
  InfoCard,
  JsonPreview,
} from "@/components/workflows/workflow-ui";
import {
  SettingsAgentLoopQuery,
  SettingsDeleteAgentLoopMutation,
  SettingsSaveAgentLoopMutation,
  SettingsTriggerAgentLoopRunMutation,
} from "@/lib/graphql-queries";
import {
  SettingsAgentProfilesQuery,
  SettingsTenantAgentQuery,
} from "@/lib/settings-queries";
import { AgentLoopForm } from "./AgentLoopForm";
import { buildWorkerOptions } from "./AgentLoopInventory";
import type {
  AgentLoopRow,
  AgentLoopRunSummary,
  AgentLoopWorkerOption,
  SaveAgentLoopPayload,
} from "./agent-loop-types";
import {
  draftFromVersion,
  draftToPayload,
  formatCost,
  formatDateTime,
  formatDuration,
  jsonRecord,
  stringValue,
  titleize,
} from "./agent-loop-utils";

type AgentLoopDetailData = {
  agentLoop?: AgentLoopRow | null;
};

type AgentProfilesData = {
  agentProfiles?: Array<{
    id: string;
    name: string;
    description?: string | null;
    enabled: boolean;
  }>;
};

type TenantAgentData = {
  agent?: {
    id: string;
    name?: string | null;
  } | null;
};

export function AgentLoopDetail({ agentLoopId }: { agentLoopId: string }) {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "run" | "pause" | "archive" | "refresh" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [loopResult, refetchLoop] = useQuery<AgentLoopDetailData>({
    query: SettingsAgentLoopQuery,
    variables: { id: agentLoopId, runLimit: 25 },
    requestPolicy: "cache-and-network",
  });
  const [agentResult] = useQuery<TenantAgentData>({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [profilesResult] = useQuery<AgentProfilesData>({
    query: SettingsAgentProfilesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [, saveAgentLoop] = useMutation(SettingsSaveAgentLoopMutation);
  const [, deleteAgentLoop] = useMutation(SettingsDeleteAgentLoopMutation);
  const [, triggerRun] = useMutation(SettingsTriggerAgentLoopRunMutation);

  const loop = loopResult.data?.agentLoop ?? null;
  const workerOptions = useMemo(
    () =>
      buildWorkerOptions({
        agent: agentResult.data?.agent ?? null,
        profiles: profilesResult.data?.agentProfiles ?? [],
      }),
    [agentResult.data?.agent, profilesResult.data?.agentProfiles],
  );

  usePageHeaderActions({
    title: loop?.name ?? "Automation",
    breadcrumbs: [
      { label: "Automations", href: "/settings/automations" },
      { label: loop?.name ?? "Automation" },
    ],
    action: loop ? (
      <HeaderActions
        loop={loop}
        pendingAction={pendingAction}
        onEdit={() => setEditing(true)}
        onRun={() => void runNow(loop)}
        onToggle={() => void toggleActive(loop, workerOptions)}
        onRefresh={() => {
          setPendingAction("refresh");
          refetchLoop({ requestPolicy: "network-only" });
          setPendingAction(null);
        }}
        onArchive={() => void archiveLoop(loop)}
      />
    ) : undefined,
    actionKey: `agent-loop:${agentLoopId}:${loop?.lifecycleStatus ?? "loading"}:${pendingAction ?? "idle"}`,
  });

  async function saveLoop(payload: SaveAgentLoopPayload) {
    const result = await saveAgentLoop({ input: payload });
    if (result.error) throw result.error;
    setEditing(false);
    refetchLoop({ requestPolicy: "network-only" });
    toast.success("Automation saved");
  }

  async function runNow(row: AgentLoopRow) {
    if (pendingAction) return;
    setPendingAction("run");
    setActionError(null);
    try {
      const result = await triggerRun({
        input: {
          agentLoopId: row.id,
          inputSummary: { source: "settings_run_now" },
        },
      });
      if (result.error) throw result.error;
      const triggeredRun = (
        result.data as {
          triggerAgentLoopRun?: { id?: string; threadId?: string | null };
        }
      )?.triggerAgentLoopRun;
      const runId = triggeredRun?.id;
      const threadId = triggeredRun?.threadId;
      toast.success("Automation run queued");
      if (threadId) {
        navigate({
          to: "/threads/$id",
          params: { id: threadId },
        });
      } else if (runId) {
        navigate({
          to: "/settings/agent-loops/$agentLoopId/runs/$runId",
          params: { agentLoopId: row.id, runId },
        });
      } else {
        refetchLoop({ requestPolicy: "network-only" });
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  async function toggleActive(
    row: AgentLoopRow,
    options: AgentLoopWorkerOption[],
  ) {
    if (!tenantId || pendingAction) return;
    setPendingAction("pause");
    setActionError(null);
    try {
      const draft = draftFromVersion(row, options);
      const nextActive = row.lifecycleStatus !== "active" || !row.enabled;
      const payload = draftToPayload({
        draft: {
          ...draft,
          lifecycleStatus: nextActive ? "active" : "paused",
          enabled: nextActive,
        },
        tenantId,
        id: row.id,
        workerOptions: options,
      });
      const result = await saveAgentLoop({ input: payload });
      if (result.error) throw result.error;
      toast.success(nextActive ? "Automation resumed" : "Automation paused");
      refetchLoop({ requestPolicy: "network-only" });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  async function archiveLoop(row: AgentLoopRow) {
    if (pendingAction) return;
    setPendingAction("archive");
    setActionError(null);
    try {
      const result = await deleteAgentLoop({ id: row.id });
      if (result.error) throw result.error;
      toast.success("Automation archived");
      navigate({ to: "/settings/automations" });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  const runColumns = useMemo<ColumnDef<AgentLoopRunSummary>[]>(
    () => [
      {
        accessorKey: "status",
        header: "Status",
        size: 140,
        cell: ({ row }) => (
          <StatusBadge status={row.original.status.toLowerCase()} size="sm" />
        ),
      },
      {
        id: "trigger",
        header: "Trigger",
        size: 120,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs">
            {titleize(row.original.triggerFamily)}
          </Badge>
        ),
      },
      {
        id: "iteration",
        header: "Iteration",
        size: 110,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.currentIteration}
          </span>
        ),
      },
      {
        id: "started",
        header: "Started",
        size: 180,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDateTime(row.original.startedAt ?? row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "duration",
        header: "Duration",
        size: 110,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDuration(row.original.startedAt, row.original.finishedAt)}
          </span>
        ),
      },
      {
        id: "cost",
        header: "Cost",
        size: 100,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatCost(row.original.totalCostUsdCents)}
          </span>
        ),
      },
    ],
    [],
  );

  if (loopResult.fetching && !loop) {
    return (
      <SettingsPane>
        <div className="flex items-center justify-center py-24">
          <LoadingShimmer />
        </div>
      </SettingsPane>
    );
  }

  if (loopResult.error || !loop) {
    return (
      <SettingsPane>
        <InfoCard title="Automation not found">
          <p className="text-sm text-muted-foreground">
            {loopResult.error?.message ??
              "This automation could not be loaded or no longer exists."}
          </p>
        </InfoCard>
      </SettingsPane>
    );
  }

  if (editing && tenantId) {
    return (
      <SettingsPane className="max-w-none">
        <AgentLoopForm
          mode="edit"
          tenantId={tenantId}
          initialLoop={loop}
          workerOptions={workerOptions}
          onSubmit={saveLoop}
          onCancel={() => setEditing(false)}
        />
      </SettingsPane>
    );
  }

  const version = loop.currentVersion;
  const trigger = jsonRecord(version?.triggerSpec);
  const triggerConfig = jsonRecord(trigger.config);
  const goal = jsonRecord(version?.goalSpec);
  const worker = jsonRecord(version?.workerSpec);
  const judge = jsonRecord(version?.judgeSpec);
  const policy = jsonRecord(version?.loopPolicy);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto p-6">
      <SettingsPageTitle
        title={loop.name}
        description={loop.description ?? "No description provided."}
        badge={<StatusBadge status={loop.lifecycleStatus} size="sm" />}
        actions={
          <Button
            type="button"
            size="sm"
            onClick={() => void runNow(loop)}
            disabled={
              pendingAction !== null || loop.lifecycleStatus !== "active"
            }
          >
            {pendingAction === "run" ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Zap className="mr-2 size-4" />
            )}
            Run now
          </Button>
        }
      />

      {actionError ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <InfoCard title="Loop summary">
          <DefinitionList
            items={[
              { label: "Slug", value: loop.slug },
              { label: "Trigger", value: titleize(loop.primaryTriggerFamily) },
              { label: "Version", value: loop.currentVersionNumber ?? "-" },
              { label: "Last run", value: formatDateTime(loop.lastRunAt) },
              { label: "Accepted", value: loop.acceptedRunCount },
              { label: "Escalated", value: loop.escalatedRunCount },
            ]}
          />
        </InfoCard>
        <InfoCard title="Policy snapshot">
          <DefinitionList
            items={[
              {
                label: "Max iterations",
                value: String(policy.maxIterations ?? "-"),
              },
              {
                label: "Max runtime",
                value: policy.maxRuntimeMs
                  ? `${Math.round(Number(policy.maxRuntimeMs) / 60000)}m`
                  : "-",
              },
              { label: "Max tokens", value: String(policy.maxTokens ?? "-") },
              {
                label: "Cost budget",
                value: String(policy.costBudgetUsd ?? "-"),
              },
              {
                label: "Fail behavior",
                value: titleize(stringValue(policy.failBehavior)),
              },
              {
                label: "Escalate",
                value: policy.escalateOnFailure ? "Yes" : "No",
              },
            ]}
          />
        </InfoCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <InfoCard title="Trigger">
          <DefinitionList
            items={[
              { label: "Family", value: titleize(stringValue(trigger.family)) },
              {
                label: "Schedule",
                value: stringValue(triggerConfig.scheduleExpression, "-"),
              },
              {
                label: "Timezone",
                value: stringValue(triggerConfig.timezone, "-"),
              },
            ]}
          />
        </InfoCard>
        <InfoCard title="Worker and judge">
          <DefinitionList
            items={[
              {
                label: "Worker type",
                value: titleize(stringValue(worker.type)),
              },
              {
                label: "Worker",
                value: stringValue(worker.label, stringValue(worker.id)),
              },
              { label: "Judge", value: titleize(stringValue(judge.mode)) },
              {
                label: "Criteria",
                value: Array.isArray(judge.criteria)
                  ? `${judge.criteria.length}`
                  : "0",
              },
            ]}
          />
        </InfoCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <InfoCard title="Goal">
          <JsonPreview value={goal} />
        </InfoCard>
        <InfoCard title="Evidence policy">
          <JsonPreview value={version?.evidencePolicy ?? null} />
        </InfoCard>
      </div>

      <div className="mt-4">
        <InfoCard title="Runs">
          <DataTable
            columns={runColumns}
            data={loop.runs ?? []}
            emptyState={
              <div className="py-10 text-center text-sm text-muted-foreground">
                No runs recorded yet.
              </div>
            }
            onRowClick={(run) =>
              navigate({
                to: "/settings/agent-loops/$agentLoopId/runs/$runId",
                params: { agentLoopId: loop.id, runId: run.id },
              })
            }
          />
        </InfoCard>
      </div>
    </div>
  );
}

function HeaderActions({
  loop,
  pendingAction,
  onEdit,
  onRun,
  onToggle,
  onRefresh,
  onArchive,
}: {
  loop: AgentLoopRow;
  pendingAction: string | null;
  onEdit: () => void;
  onRun: () => void;
  onToggle: () => void;
  onRefresh: () => void;
  onArchive: () => void;
}) {
  const active = loop.lifecycleStatus === "active" && loop.enabled;
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
        <IconAction label="Edit" disabled={!!pendingAction} onClick={onEdit}>
          <Pencil className="size-4" />
        </IconAction>
        <IconAction
          label="Run now"
          disabled={!!pendingAction || !active}
          onClick={onRun}
        >
          {pendingAction === "run" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Zap className="size-4" />
          )}
        </IconAction>
        <IconAction
          label={active ? "Pause" : "Resume"}
          disabled={!!pendingAction}
          onClick={onToggle}
        >
          {pendingAction === "pause" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : active ? (
            <Pause className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
        </IconAction>
        <IconAction
          label="Refresh"
          disabled={!!pendingAction}
          onClick={onRefresh}
        >
          <RotateCw className="size-4" />
        </IconAction>
        <AlertDialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Archive"
                  disabled={!!pendingAction}
                >
                  {pendingAction === "archive" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Archive className="size-4" />
                  )}
                </Button>
              </AlertDialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Archive</TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive this automation?</AlertDialogTitle>
              <AlertDialogDescription>
                Archived loops stop firing schedules and disappear from the
                active inventory. Run history is preserved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onArchive}>Archive</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
