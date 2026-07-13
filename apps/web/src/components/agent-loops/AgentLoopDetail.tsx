import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Archive, Loader2, Pause, Play, RotateCw, Zap } from "lucide-react";
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
  Button,
  Tooltip,
  TooltipContent,
  TooltipIconButton,
  TooltipProvider,
  TooltipTrigger,
} from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { SettingsPane } from "@/components/settings/SettingsContent";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { InfoCard } from "@/components/workflows/workflow-ui";
import {
  BoundDocumentCardQuery,
  SettingsAgentLoopLinkedWorkflowQuery,
  SettingsAgentLoopQuery,
  SettingsDeleteAgentLoopMutation,
  SettingsSaveAgentLoopMutation,
  SettingsTriggerAgentLoopRunMutation,
  TriggerWorkflowRunMutation,
} from "@/lib/graphql-queries";
import { ArtifactShareDialog } from "@/components/artifacts/ArtifactShareDialog";
import { AutomationFlowSection } from "./AutomationFlowSection";
import { MemoryPipelineSection } from "./MemoryPipelineSection";
import {
  AutomationWebhookDeliveriesPanel,
  AutomationWebhookEndpointPanel,
} from "./AutomationWebhookPanel";
import { AutomationStatusRail } from "./AutomationStatusRail";
import type {
  AgentLoopMemberOption,
  AgentLoopRoutineOption,
  AgentLoopRow,
  AgentLoopSpaceOption,
  AgentLoopWorkerOption,
  SaveAgentLoopPayload,
} from "./agent-loop-types";
import {
  draftFromVersion,
  draftToPayload,
  readTargetSpec,
  stringValue,
} from "./agent-loop-utils";
import { useAutomationEditorData } from "./useAutomationEditorData";
import {
  automationRunTarget,
  mergeAutomationExecutions,
} from "@/components/workflows/workflow-execution-model";
import { WorkflowExecutionsTab } from "@/components/workflows/WorkflowExecutionsTab";
import { buildAutomationFlowGraphFromLoop } from "./automationFlowGraph";

type AgentLoopDetailData = { agentLoop?: AgentLoopRow | null };
type AgentLoopLinkData = {
  agentLoop?: Pick<AgentLoopRow, "id" | "linkedWorkflow"> | null;
};
export function AgentLoopDetail({
  agentLoopId,
  routeScope = "settings",
}: {
  agentLoopId: string;
  routeScope?: "main" | "settings";
}) {
  const {
    tenantId,
    userId,
    workerOptions,
    spaceOptions,
    routineOptions,
    workflowOptions,
    memberOptions,
    defaultSpaceId,
  } = useAutomationEditorData();
  const navigate = useNavigate();
  const [pendingAction, setPendingAction] = useState<
    "run" | "pause" | "archive" | "refresh" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [loopResult, refetchLoop] = useQuery<AgentLoopDetailData>({
    query: SettingsAgentLoopQuery,
    variables: { id: agentLoopId, runLimit: 25 },
    requestPolicy: "cache-and-network",
  });
  const [linkResult] = useQuery<AgentLoopLinkData>({
    query: SettingsAgentLoopLinkedWorkflowQuery,
    variables: { id: agentLoopId, runLimit: 25 },
    requestPolicy: "cache-and-network",
  });
  const [, saveAgentLoop] = useMutation(SettingsSaveAgentLoopMutation);
  const [, deleteAgentLoop] = useMutation(SettingsDeleteAgentLoopMutation);
  const [, triggerRun] = useMutation(SettingsTriggerAgentLoopRunMutation);
  const [, triggerWorkflowRun] = useMutation(TriggerWorkflowRunMutation);

  const baseLoop = loopResult.data?.agentLoop ?? null;
  const loop = useMemo(
    () =>
      baseLoop
        ? {
            ...baseLoop,
            linkedWorkflow: linkResult.data?.agentLoop?.linkedWorkflow ?? null,
          }
        : null,
    [baseLoop, linkResult.data?.agentLoop?.linkedWorkflow],
  );
  const automationsHref =
    routeScope === "main" ? "/automations" : "/settings/automations";
  const detailHref = `${automationsHref}/${agentLoopId}`;
  // THINK-247: Definition | Executions render as an AppTopBar tab strip (like
  // Memory), driven by the `tab` search param.
  const search = useSearch({ strict: false }) as { tab?: string };
  const activeTab: "definition" | "executions" =
    search.tab === "activity" || search.tab === "executions"
      ? "executions"
      : "definition";

  usePageHeaderActions({
    title: loop?.name ?? "Automation",
    breadcrumbs: [
      { label: "Automations", href: automationsHref },
      { label: loop?.name ?? "Automation" },
    ],
    tabs: [
      {
        to: detailHref,
        label: "Definition",
        active: activeTab === "definition",
      },
      {
        to: detailHref,
        label: "Executions",
        search: { tab: "executions" },
        active: activeTab === "executions",
      },
    ],
    action: loop ? (
      <HeaderActions
        loop={loop}
        pendingAction={pendingAction}
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
    actionKey: `agent-loop:${agentLoopId}:${
      loop?.lifecycleStatus ?? "loading"
    }:${pendingAction ?? "idle"}`,
  });

  async function saveLoop(payload: SaveAgentLoopPayload) {
    const result = await saveAgentLoop({ input: payload });
    if (result.error) throw result.error;
    refetchLoop({ requestPolicy: "network-only" });
    toast.success("Automation saved");
  }

  async function runNow(row: AgentLoopRow) {
    if (pendingAction) return;
    setPendingAction("run");
    setActionError(null);
    try {
      const target = automationRunTarget(row);
      if (target.kind === "workflow") {
        const workflowResult = await triggerWorkflowRun({
          input: {
            workflowId: target.id,
            triggerSource: "automation_run_now",
            input: { source: "automation_run_now" },
          },
        });
        if (workflowResult.error) throw workflowResult.error;
        toast.success("Automation run queued");
        refetchLoop({ requestPolicy: "network-only" });
        navigate({ to: detailHref, search: { tab: "executions" } });
        return;
      }
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
      const threadId = triggeredRun?.threadId;
      const runId = triggeredRun?.id;
      toast.success("Automation run queued");
      if (threadId) {
        navigate({ to: "/threads/$id", params: { id: threadId } });
      } else if (runId && routeScope === "settings") {
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
        userId ?? "",
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
      navigate({ to: automationsHref });
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

  return (
    <>
      <AgentLoopDetailContent
        loop={loop}
        pendingAction={pendingAction}
        actionError={actionError}
        spaceOptions={spaceOptions}
        memberOptions={memberOptions}
        workerOptions={workerOptions}
        routineOptions={routineOptions}
        workflowOptions={workflowOptions}
        tenantId={tenantId}
        defaultSpaceId={defaultSpaceId}
        currentUserId={userId}
        activeTab={activeTab}
        onSave={saveLoop}
        onRun={() => void runNow(loop)}
        onToggle={() => void toggleActive(loop, workerOptions)}
      />
    </>
  );
}

export function AgentLoopDetailContent({
  loop,
  pendingAction,
  actionError,
  spaceOptions = [],
  memberOptions = [],
  workerOptions = [],
  routineOptions = [],
  workflowOptions = [],
  tenantId,
  defaultSpaceId,
  currentUserId,
  activeTab = "definition",
  onSave,
  onRun,
  onToggle,
}: {
  loop: AgentLoopRow;
  pendingAction: string | null;
  actionError?: string | null;
  spaceOptions?: AgentLoopSpaceOption[];
  memberOptions?: AgentLoopMemberOption[];
  workerOptions?: AgentLoopWorkerOption[];
  routineOptions?: AgentLoopRoutineOption[];
  workflowOptions?: AgentLoopRoutineOption[];
  /** THINK-247: with tenantId + onSave present, Definition renders the
   * editable workflow canvas; without them it falls back to read-only. */
  tenantId?: string | null;
  defaultSpaceId?: string | null;
  currentUserId?: string | null;
  /** Which AppTopBar tab is active; the strip itself renders in the header. */
  activeTab?: "definition" | "executions";
  onSave?: (payload: SaveAgentLoopPayload) => Promise<void>;
  onRun: () => void;
  onToggle: () => void;
}) {
  const version = loop.currentVersion;
  const target = readTargetSpec(version);
  const sourceMetadata = jsonRecordSafe(version?.sourceMetadata);
  const builderThreadId = stringValue(sourceMetadata.builderThreadId);
  const webhookEndpoint = loop.webhookEndpoint ?? null;
  const webhookDeliveries = loop.webhookDeliveries ?? [];
  const executionGraph = useMemo(
    () =>
      buildAutomationFlowGraphFromLoop({
        loop,
        workerOptions,
        spaceOptions,
        defaultSpaceId,
        currentUserId,
      }),
    [currentUserId, defaultSpaceId, loop, spaceOptions, workerOptions],
  );
  const executions = useMemo(
    () => mergeAutomationExecutions(loop.linkedWorkflow?.runs, loop.runs),
    [loop.linkedWorkflow?.runs, loop.runs],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden p-4">
      {actionError ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      {activeTab === "definition" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {builderThreadId ? (
            <div className="mb-3 flex justify-end">
              <a
                className="text-sm text-primary hover:underline"
                href={`/threads/${builderThreadId}`}
              >
                Setup thread
              </a>
            </div>
          ) : null}
          {loop.memoryPipeline ? (
            // THINK-264: the built-in memory Automation's steps ARE its
            // pipeline, so it renders the real stage list rather than the
            // trigger → work → document → deliver projection.
            <MemoryPipelineSection
              agentLoopId={loop.id}
              pipeline={loop.memoryPipeline}
              triggerFamily={loop.primaryTriggerFamily}
            />
          ) : tenantId && onSave ? (
            <AutomationFlowSection
              tenantId={tenantId}
              loop={loop}
              workerOptions={workerOptions}
              spaceOptions={spaceOptions}
              routineOptions={routineOptions}
              workflowOptions={workflowOptions}
              memberOptions={memberOptions}
              defaultSpaceId={defaultSpaceId}
              currentUserId={currentUserId}
              onSave={onSave}
              boundDocumentPanel={
                target.documentBinding ? (
                  <div className="pt-3">
                    <BoundDocumentCard
                      binding={target.documentBinding}
                      embedded
                    />
                  </div>
                ) : null
              }
              statusRail={
                <AutomationStatusRail
                  loop={loop}
                  pendingAction={pendingAction}
                  spaceOptions={spaceOptions}
                  memberOptions={memberOptions}
                  variant="card"
                  onRun={onRun}
                  onToggle={onToggle}
                />
              }
            />
          ) : (
            <div className="grid gap-8 @min-[650px]:grid-cols-[minmax(0,1fr)_320px]">
              <main className="min-w-0 space-y-8">
                <section>
                  <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                    {target.kind === "agent_thread" ? "Instructions" : "Target"}
                  </h2>
                  <div className="whitespace-pre-wrap rounded-md border border-border/70 bg-muted/20 p-5 text-base leading-7">
                    {targetSummary(target)}
                  </div>
                </section>

                {target.documentBinding ? (
                  <BoundDocumentCard binding={target.documentBinding} />
                ) : null}
              </main>

              <AutomationStatusRail
                loop={loop}
                pendingAction={pendingAction}
                spaceOptions={spaceOptions}
                memberOptions={memberOptions}
                onRun={onRun}
                onToggle={onToggle}
              />
            </div>
          )}
          {webhookEndpoint ? (
            <div className="mt-6">
              <AutomationWebhookEndpointPanel endpoint={webhookEndpoint} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-[620px] flex-1 flex-col gap-6">
          <WorkflowExecutionsTab
            executions={executions}
            graph={executionGraph}
          />

          {webhookEndpoint ? (
            <AutomationWebhookDeliveriesPanel deliveries={webhookDeliveries} />
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * THINK-227 U6 (AE5): the maintained document at a glance — title (linked to
 * the reader), current version, refresh state — plus the existing share-link
 * management (mint/copy/revoke via ArtifactShareDialog) so a leaked emailed
 * link can be cut off from the same surface.
 */
function BoundDocumentCard({
  binding,
  embedded,
}: {
  binding: NonNullable<ReturnType<typeof readTargetSpec>["documentBinding"]>;
  /** Inside the canvas inspector: the panel already carries the heading and
   * the card chrome, so render bare wrapping text — no nested card. */
  embedded?: boolean;
}) {
  const artifactId = binding.capturedArtifactId ?? binding.artifactId ?? null;
  const [shareOpen, setShareOpen] = useState(false);
  const [result] = useQuery<{
    artifact?: {
      id: string;
      title: string;
      status: string;
      headVersion: number;
      lastRefreshAt?: string | null;
      refreshFailedAt?: string | null;
    } | null;
  }>({
    query: BoundDocumentCardQuery,
    variables: { id: artifactId ?? "" },
    pause: !artifactId,
  });
  const artifact = result.data?.artifact ?? null;

  const stale = Boolean(
    artifact?.refreshFailedAt &&
      (!artifact.lastRefreshAt ||
        new Date(artifact.refreshFailedAt) > new Date(artifact.lastRefreshAt)),
  );

  return (
    <section data-testid="bound-document-card">
      {embedded ? null : (
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          Maintained document
        </h2>
      )}
      <div
        className={
          embedded ? "" : "rounded-md border border-border/70 bg-muted/20 p-4"
        }
      >
        {!artifactId ? (
          <p className="text-sm text-muted-foreground">
            Created on the first run
            {binding.title ? (
              <>
                {": "}
                <span className="text-foreground">{binding.title}</span>
              </>
            ) : null}
            {binding.genre ? ` (${binding.genre})` : null}. The binding locks
            onto it automatically.
          </p>
        ) : artifact ? (
          <div
            className={
              embedded
                ? "flex flex-col items-start gap-2"
                : "flex flex-wrap items-center justify-between gap-3"
            }
          >
            <div className="min-w-0">
              <a
                className={`${
                  embedded ? "break-words" : "truncate"
                } text-sm font-medium text-primary hover:underline`}
                href={`/artifacts/${artifact.id}`}
              >
                {artifact.title}
              </a>
              <p className="mt-1 text-xs text-muted-foreground">
                v{artifact.headVersion}
                {stale ? (
                  <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-600 dark:text-amber-400">
                    Last refresh failed — showing the last good edition
                  </span>
                ) : artifact.lastRefreshAt ? (
                  <span className="ml-2">
                    refreshed{" "}
                    {new Date(artifact.lastRefreshAt).toLocaleString()}
                  </span>
                ) : null}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShareOpen(true)}
            >
              Share link
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {result.fetching
              ? "Loading the bound document…"
              : "The bound document could not be loaded — it may have been deleted."}
          </p>
        )}
      </div>
      {artifact ? (
        <ArtifactShareDialog
          artifactId={artifact.id}
          artifactTitle={artifact.title}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      ) : null}
    </section>
  );
}

function targetSummary(target: ReturnType<typeof readTargetSpec>): string {
  if (target.kind === "agent_thread") {
    return (
      target.agentThread?.instructions ||
      "No instructions captured for this Automation."
    );
  }
  if (target.kind === "routine") {
    return `Runs routine ${target.routine?.routineId ?? ""}`.trim();
  }
  return `Runs workflow ${target.workflow?.routineId ?? ""}`.trim();
}

function jsonRecordSafe(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function HeaderActions({
  loop,
  pendingAction,
  onRun,
  onToggle,
  onRefresh,
  onArchive,
}: {
  loop: AgentLoopRow;
  pendingAction: string | null;
  onRun: () => void;
  onToggle: () => void;
  onRefresh: () => void;
  onArchive: () => void;
}) {
  const active = loop.lifecycleStatus === "active" && loop.enabled;
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
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
        {/* THINK-264: built-in automations are platform-owned — the server
            refuses to archive them, so don't offer a button that always
            errors. Pause is the supported off-switch. */}
        {loop.kind === "system" ? null : (
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
                  Archived automations stop firing and disappear from the active
                  inventory. Run history is preserved.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onArchive}>
                  Archive
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
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
    <TooltipIconButton
      type="button"
      label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </TooltipIconButton>
  );
}
