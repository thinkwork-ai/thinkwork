import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
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
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { InfoCard } from "@/components/workflows/workflow-ui";
import {
  SpacesQuery,
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
import { AutomationDetailAdvancedInspector } from "./AutomationDetailAdvancedInspector";
import { AutomationRunsList } from "./AutomationRunsList";
import { AutomationStatusRail } from "./AutomationStatusRail";
import type {
  AgentLoopRow,
  AgentLoopRunSummary,
  AgentLoopSpaceOption,
  AgentLoopWorkerOption,
  SaveAgentLoopPayload,
} from "./agent-loop-types";
import {
  defaultSpaceIdFromAgentRuntimeConfig,
  draftFromVersion,
  draftToPayload,
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

type SpacesData = {
  spaces?: AgentLoopSpaceOption[];
};

type TenantAgentData = {
  agent?: {
    id: string;
    name?: string | null;
    runtimeConfig?: unknown;
  } | null;
};

export function AgentLoopDetail({ agentLoopId }: { agentLoopId: string }) {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "run" | "pause" | "archive" | "refresh" | null
  >(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
  const [spacesResult] = useQuery<SpacesData>({
    query: SpacesQuery,
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
  const spaceOptions = useMemo(
    () => spacesResult.data?.spaces ?? [],
    [spacesResult.data?.spaces],
  );
  const defaultSpaceId = useMemo(
    () =>
      defaultSpaceIdFromAgentRuntimeConfig(
        agentResult.data?.agent?.runtimeConfig,
      ),
    [agentResult.data?.agent?.runtimeConfig],
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
      const draft = draftFromVersion(
        row,
        options,
        spaceOptions,
        defaultSpaceId,
      );
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
          spaceOptions={spaceOptions}
          defaultSpaceId={defaultSpaceId}
          onSubmit={saveLoop}
          onCancel={() => setEditing(false)}
        />
      </SettingsPane>
    );
  }

  return (
    <AgentLoopDetailContent
      loop={loop}
      pendingAction={pendingAction}
      actionError={actionError}
      advancedOpen={advancedOpen}
      onAdvancedOpenChange={setAdvancedOpen}
      onRun={() => void runNow(loop)}
      onToggle={() => void toggleActive(loop, workerOptions)}
      onOpenRun={(run) =>
        navigate({
          to: "/settings/agent-loops/$agentLoopId/runs/$runId",
          params: { agentLoopId: loop.id, runId: run.id },
        })
      }
    />
  );
}

export function AgentLoopDetailContent({
  loop,
  pendingAction,
  actionError,
  advancedOpen,
  onAdvancedOpenChange,
  onRun,
  onToggle,
  onOpenRun,
}: {
  loop: AgentLoopRow;
  pendingAction: string | null;
  actionError?: string | null;
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  onRun: () => void;
  onToggle: () => void;
  onOpenRun: (run: AgentLoopRunSummary) => void;
}) {
  const version = loop.currentVersion;
  const goal = jsonRecord(version?.goalSpec);
  const sourceMetadata = jsonRecord(version?.sourceMetadata);
  const builderThreadId = stringValue(sourceMetadata.builderThreadId);
  const prompt = stringValue(goal.objective, loop.description ?? "");
  const criteria = Array.isArray(goal.completionCriteria)
    ? goal.completionCriteria.filter((entry) => typeof entry === "string")
    : [];

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto p-6">
      <SettingsPageTitle
        title={loop.name}
        description={loop.description ?? undefined}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAdvancedOpenChange(true)}
          >
            Advanced details
          </Button>
        }
      />

      {actionError ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 space-y-8">
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                Prompt
              </h2>
              {builderThreadId ? (
                <a
                  className="text-sm text-primary hover:underline"
                  href={`/threads/${builderThreadId}`}
                >
                  Setup thread
                </a>
              ) : null}
            </div>
            <div className="whitespace-pre-wrap rounded-md border border-border/70 bg-muted/20 p-5 text-base leading-7">
              {prompt || "No prompt captured for this Automation."}
            </div>
          </section>

          {criteria.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                Done Means
              </h2>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {criteria.map((criterion) => (
                  <li
                    key={criterion}
                    className="rounded-md border border-border/70 px-3 py-2"
                  >
                    {criterion}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
              Recent Runs
            </h2>
            <AutomationRunsList runs={loop.runs ?? []} onOpenRun={onOpenRun} />
          </section>
        </main>

        <AutomationStatusRail
          loop={loop}
          pendingAction={pendingAction}
          onRun={onRun}
          onToggle={onToggle}
        />
      </div>

      <AutomationDetailAdvancedInspector
        open={advancedOpen}
        onOpenChange={onAdvancedOpenChange}
        loop={loop}
      />
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
