import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useClient, useMutation, useQuery, useSubscription } from "urql";
import { Flag, Info, Maximize2, Minimize2, PanelRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@thinkwork/ui";
import {
  parseSpaceRecord,
  type LinkedTaskSummary,
} from "@/components/spaces/space-types";
import { spaceCrumbLabel } from "@/components/spaces/space-utils";
import {
  TaskThreadView,
  normalizePersistedParts,
  type ComposerMention,
  type TaskThread,
  type TaskThreadTurn,
  type TaskThreadEvent,
  type ThreadInfoChecklistTask,
  type ThreadInfoGoalRecord,
  type ThreadInfoGoalRecordGroup,
  type TaskThreadInfoPanelState,
} from "@/components/workbench/TaskThreadView";
import type { GeneratedArtifact } from "@/components/workbench/GeneratedArtifactCard";
import { ThreadDetailActions } from "@/components/workbench/ThreadDetailActions";
import { FlagThreadForEvalDialog } from "@/components/workbench/FlagThreadForEvalDialog";
import { ThreadTitleInlineRename } from "@/components/workbench/ThreadTitleInlineRename";
import type { BridgeRunTelemetry } from "@/components/workbench/BridgeRunTelemetryPanel";
import type { MentionTarget } from "@/components/spaces/MentionMenu";
import type { UserQuestionRecord } from "@/lib/ui-message-types";
import {
  emptyState,
  mergeUIMessageChunk,
  type UIMessageStreamState,
} from "@/lib/ui-message-merge";
import { toUserQuestionStatus } from "@/lib/user-question-record";
import {
  InlineShortcutText,
  shortcutDisplayText,
} from "@/components/workbench/InlineShortcutText";
import {
  mergeAgentProfileMentionTargets,
  type AgentProfileMentionSource,
} from "@/components/workbench/agent-profile-mention-targets";
import {
  appendGoalModeMetadata,
  type ComposerGoalModeIntent,
} from "@/components/workbench/goal-mode";
import { normalizeSkillCreatorCommandContent } from "@/lib/skill-creator-command";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  ComputerEventsQuery,
  ComputerThreadQuery,
  ComputerThreadTasksQuery,
  MyApprovedModelCatalogQuery,
  NewMessageSubscription,
  RunbookRunsQuery,
  SendMessageMutation,
  SettingsActivityThreadTurnsQuery,
  ThreadArtifactsQuery,
  ThreadGoalFilesQuery,
  ThreadLinkedTasksQuery,
  ThreadWorkItemsQuery,
  ThreadProgressMarkdownQuery,
  ThreadMentionTargetsQuery,
  ThreadUpdatedSubscription,
  ThreadTurnUpdatedSubscription,
  ThreadTurnStepSubscription,
  RefreshThreadProgressMutation,
  ReviewGoalMutation,
  UpdateWorkItemMutation,
  UpdateWorkItemStatusMutation,
  UpdateThreadMutation,
  WorkItemStatusesQuery,
} from "@/lib/graphql-queries";
import { TenantSkillCatalogQuery } from "@/lib/skill-catalog-queries";
import type { SkillOption } from "@/components/spaces/SkillMenu";
import { useComputerThreadChunks } from "@/lib/use-computer-thread-chunks";
import { createAppSyncChatTransport } from "@/lib/use-chat-appsync-transport";
import {
  clearPendingThreadStart,
  getPendingThreadStart,
  type PendingThreadStart,
} from "@/lib/pending-thread-starts";
import { uploadThreadAttachments } from "@/lib/upload-thread-attachments";
import { getIdToken } from "@/lib/auth";
import { readRuntimeEnv } from "@/lib/runtime-config";
import { notifyAgentCompletion } from "@/lib/desktop-notifications";
import { apiFetch } from "@/lib/api-fetch";
import {
  desktopToolbarActiveButtonClassName,
  desktopToolbarButtonClassName,
  desktopToolbarGapClassName,
} from "@/lib/desktop-chrome";
import {
  chooseApprovedModelId,
  readStoredModelId,
  writeStoredModelId,
  type ApprovedModelOption,
} from "@/lib/approved-model-selection";
import {
  SettingsAgentProfilesQuery,
  SettingsTenantMembersQuery,
} from "@/lib/settings-queries";
import {
  categoryStatuses,
  sortWorkItemStatuses,
  type WorkItemAssigneeSummary,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  workItemAssigneeLabel,
  workItemStatusCategory,
} from "@/components/work-items/work-item-display";
import type { JsonRenderActionSuccess } from "@/components/workbench/json-render/use-json-render-action";

interface SpacesThreadDetailRouteProps {
  threadId: string;
  backHref?: string;
  documentTitlePrefix?: string;
  breadcrumbParents?: Array<{
    label: string;
    href?: string;
    search?: Record<string, unknown>;
  }>;
}

interface OptimisticAttachmentPreview {
  name: string;
  sizeBytes?: number | null;
  mimeType?: string | null;
}

interface OptimisticMessage {
  content: string;
  expectAssistantResponse: boolean;
  startedAt?: string | null;
  attachments?: OptimisticAttachmentPreview[];
  mentions?: Array<{
    targetType: "USER" | "AGENT" | "AGENT_PROFILE";
    targetId: string;
    displayName: string;
    rawText?: string;
  }>;
}

const ACTIVE_AGENT_REFRESH_MS = 2_000;

interface ThreadResult {
  thread: {
    id: string;
    identifier?: string | null;
    agentId?: string | null;
    userId?: string | null;
    computerId?: string | null;
    user?: {
      id: string;
      name?: string | null;
      email?: string | null;
    } | null;
    computer?: {
      id: string;
      name?: string | null;
      slug?: string | null;
    } | null;
    title?: string | null;
    status?: string | null;
    pinnedAt?: string | null;
    spaceId?: string | null;
    space?: {
      id: string;
      name?: string | null;
      slug?: string | null;
    } | null;
    lifecycleStatus?: string | null;
    metadata?: unknown;
    lastModel?: string | null;
    costSummary?: number | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    messages?: {
      edges?: Array<{
        node: {
          id: string;
          role: string;
          content?: string | null;
          parts?: unknown;
          createdAt?: string | null;
          metadata?: unknown;
          toolCalls?: unknown;
          toolResults?: unknown;
          sender?: {
            type?: string | null;
            id?: string | null;
            displayName?: string | null;
            avatarUrl?: string | null;
          } | null;
          mentions?: Array<{
            id: string;
            targetType?: string | null;
            targetId?: string | null;
            displayName?: string | null;
            rawText?: string | null;
          }> | null;
          userQuestion?:
            | (Omit<UserQuestionRecord, "status"> & {
                /** Raw GraphQL enum string — narrowed in toTaskThread. */
                status?: string | null;
              })
            | null;
          durableArtifact?: {
            id: string;
            title: string;
            type?: string | null;
            summary?: string | null;
            metadata?: unknown;
          } | null;
        };
      }>;
    } | null;
    attachments?: Array<{
      id: string;
      name?: string | null;
      mimeType?: string | null;
      sizeBytes?: number | null;
      uploadedBy?: string | null;
      createdAt?: string | null;
    }> | null;
  } | null;
  n8nAgentStepRuns?: BridgeRunTelemetry[] | null;
}

interface ThreadTasksResult {
  computerTasks?: Array<{
    id: string;
    taskType?: string | null;
    status?: string | null;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    claimedAt?: string | null;
    completedAt?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  }> | null;
}

interface ThreadEventsResult {
  computerEvents?: Array<{
    id: string;
    taskId?: string | null;
    eventType?: string | null;
    level?: string | null;
    payload?: unknown;
    createdAt?: string | null;
  }> | null;
}

interface RunbookRunsResult {
  runbookRuns?: Array<{
    id: string;
    runbookSlug?: string | null;
    runbookVersion?: string | null;
    status?: string | null;
    tasks?: Array<{
      id: string;
      phaseId?: string | null;
      phaseTitle?: string | null;
      taskKey?: string | null;
      title?: string | null;
      summary?: string | null;
      status?: string | null;
      dependsOn?: unknown;
      capabilityRoles?: unknown;
      sortOrder?: number | null;
    }> | null;
    definitionSnapshot?: unknown;
    updatedAt?: string | null;
  }> | null;
}

interface MentionTargetsResult {
  threadMentionTargets?: MentionTarget[] | null;
}

interface AgentProfilesMentionData {
  agentProfiles?: AgentProfileMentionSource[] | null;
}

interface ApprovedModelsResult {
  myApprovedModelCatalog?: ApprovedModelOption[] | null;
}

interface ThreadLinkedTasksResult {
  threadLinkedTasks?: LinkedTaskSummary[] | null;
}

interface ThreadWorkItemsResult {
  threadWorkItems?: WorkItemSummary[] | null;
}

interface WorkItemStatusesResult {
  workItemStatuses?: WorkItemStatusSummary[] | null;
}

interface TenantMemberSummary {
  principalType: string;
  principalId: string;
  status?: string | null;
  user?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
  } | null;
}

interface TenantMembersResult {
  tenantMembers?: TenantMemberSummary[] | null;
}

interface ThreadProgressMarkdownResult {
  threadProgressMarkdown?: {
    threadId: string;
    key?: string | null;
    content: string;
  } | null;
}

interface ThreadGoalFilesResult {
  threadGoalFiles?: {
    goal: {
      id: string;
      outcome?: string | null;
      ownerType?: string | null;
      ownerId?: string | null;
      mode?: string | null;
      status?: string | null;
      completionRule?: unknown;
      reviewPolicy?: unknown;
      reviewerType?: string | null;
      reviewerId?: string | null;
      startedAt?: string | null;
      reviewedAt?: string | null;
      completedAt?: string | null;
      cancelledAt?: string | null;
      metadata?: unknown;
      updatedAt?: string | null;
    };
    files: Array<{
      file: string;
      key?: string | null;
      content?: string | null;
    }>;
  } | null;
}

interface ThreadTurnRow {
  id: string;
  thread_id?: string | null;
  trigger_id?: string | null;
  agent_id?: string | null;
  invocation_source?: string | null;
  runtime_type?: string | null;
  status?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  error_code?: string | null;
  system_prompt?: string | null;
  result_json?: unknown;
  usage_json?: unknown;
  total_cost?: number | null;
  context_snapshot?: unknown;
  created_at?: string | null;
}

interface ThreadTurnGraphqlRow {
  id: string;
  threadId?: string | null;
  invocationSource?: string | null;
  runtimeType?: string | null;
  status?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  errorCode?: string | null;
  systemPrompt?: string | null;
  resultJson?: unknown;
  usageJson?: unknown;
  totalCost?: number | null;
  contextSnapshot?: unknown;
  createdAt?: string | null;
}

interface ThreadTurnsResult {
  threadTurns?: ThreadTurnGraphqlRow[] | null;
}

interface ThreadTurnEventRow {
  id: string;
  run_id?: string | null;
  runId?: string | null;
  event_type?: string | null;
  eventType?: string | null;
  level?: string | null;
  payload?: unknown;
  created_at?: string | null;
  createdAt?: string | null;
}

export function SpacesThreadDetailRoute({
  threadId,
  backHref,
  documentTitlePrefix = "Thread",
  breadcrumbParents,
}: SpacesThreadDetailRouteProps) {
  const { tenantId, userId, isOperator } = useTenant();
  const [optimisticMessage, setOptimisticMessage] =
    useState<OptimisticMessage | null>(null);
  // Flag-for-evaluation dialog (Trust Core U7): operator-gated client-side
  // via TenantContext.isOperator; the mutation re-checks server-side.
  const [flagEvalTurnId, setFlagEvalTurnId] = useState<string | null>(null);
  const [flagEvalOpen, setFlagEvalOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() =>
    readStoredModelId(),
  );
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [artifactFullscreen, setArtifactFullscreen] = useState(false);
  const [threadInfoOpen, setThreadInfoOpen] = useState(false);
  // Hide the "…" actions menu while the title is being renamed — leaving the
  // trigger mounted lets Radix's focus-restore steal focus back from the
  // rename input on menu close, cancelling the edit.
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [goalReviewError, setGoalReviewError] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    null,
  );
  const [manualRefreshStartedAt, setManualRefreshStartedAt] = useState<
    number | null
  >(null);
  const [manualRefreshObservedFetching, setManualRefreshObservedFetching] =
    useState(false);
  const [updatingProgressWorkItemId, setUpdatingProgressWorkItemId] = useState<
    string | null
  >(null);
  const [threadTurnEventsByRun, setThreadTurnEventsByRun] = useState<
    Map<string, TaskThreadEvent[]>
  >(new Map());
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<ThreadResult>({
    query: ComputerThreadQuery,
    variables: { id: threadId, messageLimit: 100 },
  });
  const fallbackThreadTitle = useRouterState({
    select: (state) =>
      threadTitleFallbackFromState(state.location.state, threadId),
  });
  const optimisticThreadStart = getPendingThreadStart(threadId);
  const routeThread = data?.thread?.id === threadId ? data.thread : null;
  const hasMismatchedThreadData = Boolean(data?.thread && !routeThread);
  const isThreadTitlePending =
    (fetching && !optimisticThreadStart) || hasMismatchedThreadData;
  const threadTitle =
    routeThread?.title?.trim() ||
    fallbackThreadTitle ||
    optimisticThreadStart?.title ||
    (isThreadTitlePending ? "Loading..." : "Thread");

  // Attached artifacts feed the cascade-delete checkbox in ThreadDetailActions.
  // Paused until tenant is known.
  const [{ data: attachedData }] = useQuery<{
    artifacts?: Array<{
      id: string;
      title: string;
      type?: string | null;
    }> | null;
  }>({
    query: ThreadArtifactsQuery,
    variables: { tenantId: tenantId ?? "", threadId },
    pause: !tenantId || !threadId,
    requestPolicy: "cache-and-network",
  });
  const attachedArtifacts = useMemo(
    () =>
      (attachedData?.artifacts ?? []).map((a) => ({
        id: a.id,
        title: a.title,
      })),
    [attachedData?.artifacts],
  );
  const [
    { data: mentionTargetsData, fetching: mentionTargetsFetching },
    reexecuteMentionTargetsQuery,
  ] = useQuery<MentionTargetsResult>({
    query: ThreadMentionTargetsQuery,
    variables: { threadId },
    pause: !threadId,
    requestPolicy: "cache-and-network",
  });
  const [{ data: agentProfilesData }] = useQuery<
    AgentProfilesMentionData,
    { tenantId: string }
  >({
    query: SettingsAgentProfilesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  // Tenant skill catalog for the `/skill` force-pin popup (plan 2026-06-04-004
  // U5). The blocklist guardrail is enforced server-side at dispatch.
  const [{ data: skillCatalogData }] = useQuery({
    query: TenantSkillCatalogQuery,
    variables: { agentId: null },
  });
  const skillCatalog = useMemo<SkillOption[]>(
    () => skillCatalogData?.tenantSkillCatalog ?? [],
    [skillCatalogData],
  );
  const [{ data: approvedModelData, error: approvedModelError }] =
    useQuery<ApprovedModelsResult>({
      query: MyApprovedModelCatalogQuery,
      pause: !tenantId,
      requestPolicy: "cache-and-network",
    });
  const approvedModels = approvedModelData?.myApprovedModelCatalog;

  useEffect(() => {
    if (!approvedModels) return;
    const nextModelId = chooseApprovedModelId(approvedModels, selectedModelId);
    if (nextModelId !== selectedModelId) {
      setSelectedModelId(nextModelId);
      writeStoredModelId(nextModelId);
    }
  }, [approvedModels, selectedModelId]);

  // Seed the composer with the model this thread last used, so a follow-up
  // defaults to the thread's own history rather than the global stored pick
  // (which is shared across every thread). Runs once per thread on load —
  // after that, the operator's manual picks win and must not be re-clobbered.
  // The stored/default selection stays in place when the thread has no
  // last-used model (a genuinely new thread) or it isn't an approved option.
  const seededModelThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!approvedModels || !routeThread) return;
    if (seededModelThreadRef.current === routeThread.id) return;
    seededModelThreadRef.current = routeThread.id;
    const lastModel = routeThread.lastModel ?? null;
    if (!lastModel) return;
    const resolved = chooseApprovedModelId(approvedModels, lastModel);
    if (resolved === lastModel && resolved !== selectedModelId) {
      setSelectedModelId(resolved);
    }
  }, [approvedModels, routeThread, selectedModelId]);

  useEffect(() => {
    if (approvedModelError) {
      console.warn(
        "[SpacesThreadDetailRoute] failed to load approved models:",
        approvedModelError,
      );
    }
  }, [approvedModelError]);

  function handleSelectedModelChange(modelId: string) {
    // Radix Select's controllable-state sync fires onValueChange("") whenever
    // the controlled value is changed programmatically (e.g. seeding from the
    // thread's last-used model). No approved model has an empty modelId and the
    // picker has no empty-valued item, so an empty value is never a real user
    // pick — ignore it, otherwise it clobbers the selection back to the default.
    if (!modelId) return;
    setSelectedModelId(modelId);
    writeStoredModelId(modelId);
  }

  const computerId = routeThread?.computerId ?? null;
  // ComputerThreadTasks / ComputerEvents / RunbookRuns are vestigial: the
  // Computer + runbook features were removed and these operations no longer
  // exist in the GraphQL schema, so the server validation-rejects them (400).
  // `pause: !computerId` keeps them off for normal threads — but a forced
  // `reexecute()` (e.g. the active-agent poll) bypasses `pause` and fires them
  // every couple seconds, flooding the console. Gate the reexecute fns on
  // `computerId` (effectively never now) so they can't force a dead query.
  const [{ data: tasksData, fetching: tasksFetching }, rawReexecuteTasksQuery] =
    useQuery<ThreadTasksResult>({
      query: ComputerThreadTasksQuery,
      variables: { computerId, threadId, limit: 6 },
      pause: !computerId,
    });
  const [
    { data: eventsData, fetching: eventsFetching },
    rawReexecuteEventsQuery,
  ] = useQuery<ThreadEventsResult>({
    query: ComputerEventsQuery,
    variables: { computerId, limit: 100 },
    pause: !computerId,
  });
  const [
    { data: runbookRunsData, fetching: runbookRunsFetching },
    rawReexecuteRunbookRunsQuery,
  ] = useQuery<RunbookRunsResult>({
    query: RunbookRunsQuery,
    variables: { computerId, threadId, limit: 5 },
    pause: !computerId,
    requestPolicy: "cache-and-network",
  });
  const reexecuteTasksQuery = useCallback(
    (opts?: Parameters<typeof rawReexecuteTasksQuery>[0]) => {
      if (computerId) rawReexecuteTasksQuery(opts);
    },
    [computerId, rawReexecuteTasksQuery],
  );
  const reexecuteEventsQuery = useCallback(
    (opts?: Parameters<typeof rawReexecuteEventsQuery>[0]) => {
      if (computerId) rawReexecuteEventsQuery(opts);
    },
    [computerId, rawReexecuteEventsQuery],
  );
  const reexecuteRunbookRunsQuery = useCallback(
    (opts?: Parameters<typeof rawReexecuteRunbookRunsQuery>[0]) => {
      if (computerId) rawReexecuteRunbookRunsQuery(opts);
    },
    [computerId, rawReexecuteRunbookRunsQuery],
  );
  const [
    {
      data: linkedTasksData,
      fetching: linkedTasksFetching,
      error: linkedTasksError,
    },
    reexecuteLinkedTasksQuery,
  ] = useQuery<ThreadLinkedTasksResult>({
    query: ThreadLinkedTasksQuery,
    variables: { tenantId: tenantId ?? "", threadId },
    pause: !tenantId || !threadId,
    requestPolicy: "cache-and-network",
  });
  const [
    { data: workItemsData, fetching: workItemsFetching, error: workItemsError },
    reexecuteWorkItemsQuery,
  ] = useQuery<ThreadWorkItemsResult>({
    query: ThreadWorkItemsQuery,
    variables: { tenantId: tenantId ?? "", threadId },
    pause: !tenantId || !threadId,
    requestPolicy: "cache-and-network",
  });
  const [{ data: workItemStatusesData }] = useQuery<WorkItemStatusesResult>({
    query: WorkItemStatusesQuery,
    variables: {
      tenantId: tenantId ?? "",
      spaceId: routeThread?.spaceId ?? "",
    },
    pause: !tenantId || !routeThread?.spaceId,
    requestPolicy: "cache-and-network",
  });
  const [{ data: tenantMembersData }] = useQuery<TenantMembersResult>({
    query: SettingsTenantMembersQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [
    {
      data: progressMarkdownData,
      fetching: progressMarkdownFetching,
      error: progressMarkdownError,
    },
    reexecuteProgressMarkdownQuery,
  ] = useQuery<ThreadProgressMarkdownResult>({
    query: ThreadProgressMarkdownQuery,
    variables: { tenantId: tenantId ?? "", threadId },
    pause: !tenantId || !threadId,
    requestPolicy: "cache-and-network",
  });
  const [
    { data: goalFilesData, fetching: goalFilesFetching, error: goalFilesError },
    reexecuteGoalFilesQuery,
  ] = useQuery<ThreadGoalFilesResult>({
    query: ThreadGoalFilesQuery,
    variables: { tenantId: tenantId ?? "", threadId },
    pause: !tenantId || !threadId,
    requestPolicy: "cache-and-network",
  });
  const [{ data: threadTurnsData }, reexecuteThreadTurnsQuery] =
    useQuery<ThreadTurnsResult>({
      query: SettingsActivityThreadTurnsQuery,
      variables: { tenantId: tenantId ?? "", threadId, limit: 50 },
      pause: !tenantId || !threadId,
      requestPolicy: "cache-and-network",
    });
  const [{ fetching: sending }, sendMessage] = useMutation(SendMessageMutation);
  const [{ fetching: completingThread }, updateThread] =
    useMutation(UpdateThreadMutation);
  const [{ fetching: reviewingGoal }, reviewGoal] =
    useMutation(ReviewGoalMutation);
  const [{ fetching: refreshingProgress }, refreshThreadProgress] = useMutation(
    RefreshThreadProgressMutation,
  );
  const [{ fetching: progressStatusUpdating }, updateWorkItemStatus] =
    useMutation(UpdateWorkItemStatusMutation);
  const [{ fetching: progressAssigneeUpdating }, updateWorkItem] = useMutation(
    UpdateWorkItemMutation,
  );
  const {
    chunks,
    streamState,
    reset: resetStreamingChunks,
  } = useComputerThreadChunks(threadId);

  // Plan-012 U8: instantiate the useChat AppSync transport adapter for
  // this thread. Adapter lives parallel to the legacy subscription
  // wiring above — once U13 (composer migration) consumes it as the
  // sole submit owner, the legacy SendMessageMutation invocations from
  // composers retire. The adapter is constructed eagerly here so smoke
  // pins (transportStatus) can be inspected from devtools while the
  // cutover is in flight; it has no side effects until sendMessages
  // is called.
  const urqlClient = useClient();
  const _appSyncChatTransport = useMemo(
    () =>
      threadId ? createAppSyncChatTransport({ urqlClient, threadId }) : null,
    [urqlClient, threadId],
  );
  const [{ data: turnUpdate }] = useSubscription<{
    onThreadTurnUpdated?: { threadId?: string | null } | null;
  }>({
    query: ThreadTurnUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });
  const [{ data: threadUpdate }] = useSubscription<{
    onThreadUpdated?: { threadId?: string | null } | null;
  }>({
    query: ThreadUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });
  const [{ data: messageUpdate }] = useSubscription<{
    onNewMessage?: {
      threadId?: string | null;
      messageId?: string | null;
    } | null;
  }>({
    query: NewMessageSubscription,
    variables: { threadId },
    pause: !threadId,
  });

  // Live mid-turn activity steps (plan 2026-06-03-001 U6). The step payload
  // rides in the subscription event so we reduce it straight into local turn
  // state — urql here is a document cache, not graphcache, so a bare event
  // would not update the rendered turn, and refetch-per-step would add load.
  // Accumulated per run_id, de-duplicated by seq (AppSync is at-least-once).
  const [liveStepsByRun, setLiveStepsByRun] = useState<
    Map<string, TaskThreadEvent[]>
  >(new Map());
  const [liveStreamStateByRun, setLiveStreamStateByRun] = useState<
    Map<string, UIMessageStreamState>
  >(new Map());
  const liveStepSeqByRun = useRef<Map<string, Set<number>>>(new Map());
  const [{ data: stepUpdate }] = useSubscription<{
    onThreadTurnStep?: {
      runId?: string | null;
      seq?: number | null;
      eventType?: string | null;
      level?: string | null;
      payload?: string | null;
      createdAt?: string | null;
    } | null;
  }>({
    query: ThreadTurnStepSubscription,
    variables: { threadId },
    pause: !threadId,
  });

  // Reset accumulated live steps when switching threads.
  useEffect(() => {
    setLiveStepsByRun(new Map());
    setLiveStreamStateByRun(new Map());
    liveStepSeqByRun.current = new Map();
  }, [threadId]);

  useEffect(() => {
    const step = stepUpdate?.onThreadTurnStep;
    if (!step?.runId || step.seq === null || step.seq === undefined) return;
    const runId = step.runId;
    const seq = step.seq;
    const seenSeq = liveStepSeqByRun.current.get(runId) ?? new Set<number>();
    if (seenSeq.has(seq)) return; // at-least-once de-dup
    seenSeq.add(seq);
    liveStepSeqByRun.current.set(runId, seenSeq);

    let payload: unknown = null;
    if (step.payload) {
      try {
        payload = JSON.parse(step.payload);
      } catch {
        payload = null;
      }
    }
    const uiChunk = uiMessageChunkFromThreadTurnPayload(payload);
    if (uiChunk !== null) {
      setLiveStreamStateByRun((prev) => {
        const next = new Map(prev);
        next.set(
          runId,
          mergeUIMessageChunk(next.get(runId) ?? emptyState(), uiChunk, seq),
        );
        return next;
      });
      return;
    }
    const event: TaskThreadEvent = {
      id: `${runId}:${seq}`,
      eventType: step.eventType ?? null,
      level: step.level ?? null,
      payload,
      createdAt: step.createdAt ?? null,
    };
    setLiveStepsByRun((prev) => {
      const next = new Map(prev);
      const existing = next.get(runId) ?? [];
      next.set(
        runId,
        [...existing, event].sort((a, b) => {
          const sa = Number(a.id.split(":")[1] ?? 0);
          const sb = Number(b.id.split(":")[1] ?? 0);
          return sa - sb;
        }),
      );
      return next;
    });
  }, [stepUpdate]);

  const threadTurnRows = useMemo(
    () => toThreadTurnRows(threadTurnsData?.threadTurns ?? []),
    [threadTurnsData?.threadTurns],
  );

  const refreshThreadTurnEvents = useCallback(async () => {
    if (!tenantId || !threadId) {
      setThreadTurnEventsByRun(new Map());
      return;
    }
    const visibleRows = threadTurnRows.filter(
      (row) => !isHiddenDesktopDelegationRow(row),
    );
    if (visibleRows.length === 0) {
      setThreadTurnEventsByRun(new Map());
      return;
    }
    const eventEntries = await Promise.all(
      visibleRows.map(async (row) => {
        try {
          const events = await apiFetch<ThreadTurnEventRow[]>(
            `/api/thread-turns/${encodeURIComponent(row.id)}/events?limit=500`,
            { extraHeaders: { "x-tenant-id": tenantId } },
          );
          return [row.id, events.map(taskThreadEventFromRow)] as const;
        } catch {
          return [row.id, [] as TaskThreadEvent[]] as const;
        }
      }),
    );
    setThreadTurnEventsByRun(new Map(eventEntries));
  }, [tenantId, threadId, threadTurnRows]);

  useEffect(() => {
    void refreshThreadTurnEvents();
  }, [refreshThreadTurnEvents]);

  useEffect(() => {
    if (turnUpdate?.onThreadTurnUpdated?.threadId === threadId) {
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
      reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
      reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
      reexecuteWorkItemsQuery({ requestPolicy: "network-only" });
      reexecuteProgressMarkdownQuery({ requestPolicy: "network-only" });
      reexecuteThreadTurnsQuery({ requestPolicy: "network-only" });
    }
  }, [
    reexecuteEventsQuery,
    reexecuteLinkedTasksQuery,
    reexecuteProgressMarkdownQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
    reexecuteThreadTurnsQuery,
    reexecuteWorkItemsQuery,
    threadId,
    turnUpdate?.onThreadTurnUpdated?.threadId,
  ]);

  useEffect(() => {
    if (threadUpdate?.onThreadUpdated?.threadId === threadId) {
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
      reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
      reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
      reexecuteWorkItemsQuery({ requestPolicy: "network-only" });
      reexecuteProgressMarkdownQuery({ requestPolicy: "network-only" });
      reexecuteThreadTurnsQuery({ requestPolicy: "network-only" });
    }
  }, [
    reexecuteEventsQuery,
    reexecuteLinkedTasksQuery,
    reexecuteProgressMarkdownQuery,
    reexecuteQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
    reexecuteThreadTurnsQuery,
    reexecuteWorkItemsQuery,
    threadId,
    threadUpdate?.onThreadUpdated?.threadId,
  ]);

  useEffect(() => {
    if (messageUpdate?.onNewMessage?.threadId === threadId) {
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
      reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
      reexecuteMentionTargetsQuery({ requestPolicy: "network-only" });
      reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
      reexecuteWorkItemsQuery({ requestPolicy: "network-only" });
      reexecuteProgressMarkdownQuery({ requestPolicy: "network-only" });
      reexecuteThreadTurnsQuery({ requestPolicy: "network-only" });
    }
  }, [
    messageUpdate?.onNewMessage?.messageId,
    messageUpdate?.onNewMessage?.threadId,
    reexecuteEventsQuery,
    reexecuteLinkedTasksQuery,
    reexecuteMentionTargetsQuery,
    reexecuteProgressMarkdownQuery,
    reexecuteQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
    reexecuteThreadTurnsQuery,
    reexecuteWorkItemsQuery,
    threadId,
  ]);

  useEffect(() => {
    if (
      optimisticMessage?.expectAssistantResponse === false &&
      hasPersistedUserMessage(
        routeThread?.messages?.edges,
        optimisticMessage.content,
      )
    ) {
      setOptimisticMessage(null);
    }
  }, [routeThread?.messages?.edges, optimisticMessage]);

  useEffect(() => {
    function handleRunbookDecision() {
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
    }

    window.addEventListener(
      "thinkwork:runbook-decision",
      handleRunbookDecision,
    );
    return () =>
      window.removeEventListener(
        "thinkwork:runbook-decision",
        handleRunbookDecision,
      );
  }, [
    reexecuteEventsQuery,
    reexecuteQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
  ]);

  const thread = routeThread
    ? toTaskThread(routeThread)
    : optimisticThreadStart
      ? toOptimisticTaskThread(optimisticThreadStart)
      : null;
  const threadTurns = [
    ...toTaskThreadTurns(tasksData?.computerTasks, eventsData?.computerEvents),
    ...toTaskThreadTurnsFromRows(
      threadTurnRows,
      liveStepsByRun,
      threadTurnEventsByRun,
    ),
  ];
  const liveThreadTurnStreamState = latestLiveStreamState(
    threadTurns,
    liveStreamStateByRun,
  );
  if (thread) {
    thread.turns = threadTurns;
  }
  // Latest completed (persisted) turn — target of the header-level
  // "Flag for evaluation" action. Optimistic/synthetic turn rows carry
  // non-UUID ids and are never flaggable.
  const latestCompletedTurnId = latestFlaggableTurnId(threadTurns);
  const hasPersistedPendingStartUserMessage = optimisticThreadStart
    ? hasPersistedUserMessage(
        routeThread?.messages?.edges,
        optimisticThreadStart.content,
      )
    : false;
  const hasPendingStartRealActivity = Boolean(
    optimisticThreadStart &&
    (optimisticThreadStart.expectAssistantResponse === false ||
      threadTurns.length > 0 ||
      hasDurableAssistantAfterLatestUser(thread)),
  );
  const shouldKeepPendingStartSignal = Boolean(
    optimisticThreadStart && !hasPendingStartRealActivity,
  );

  useEffect(() => {
    if (
      optimisticThreadStart &&
      hasPersistedPendingStartUserMessage &&
      hasPendingStartRealActivity
    ) {
      clearPendingThreadStart(threadId);
    }
  }, [
    hasPendingStartRealActivity,
    hasPersistedPendingStartUserMessage,
    optimisticThreadStart,
    threadId,
  ]);

  const routeStateOptimisticMessage =
    optimisticThreadStart &&
    (!hasPersistedPendingStartUserMessage || shouldKeepPendingStartSignal)
      ? {
          content: optimisticThreadStart.content,
          expectAssistantResponse:
            optimisticThreadStart.expectAssistantResponse,
          startedAt: optimisticThreadStart.startedAt ?? null,
          attachments: optimisticThreadStart.attachments,
          mentions: optimisticThreadStart.mentions,
        }
      : null;
  const effectiveOptimisticMessage =
    optimisticMessage ?? routeStateOptimisticMessage;
  const visibleThread = effectiveOptimisticMessage
    ? withOptimisticUserTurn(thread, effectiveOptimisticMessage.content, {
        expectAssistantResponse:
          effectiveOptimisticMessage.expectAssistantResponse,
        startedAt: effectiveOptimisticMessage.startedAt,
        attachments: effectiveOptimisticMessage.attachments,
        mentions: effectiveOptimisticMessage.mentions,
      })
    : thread;
  const mentionTargets = useMemo(
    () =>
      mergeAgentProfileMentionTargets(
        mentionTargetsData?.threadMentionTargets,
        agentProfilesData?.agentProfiles,
        routeThread?.spaceId ?? null,
      ),
    [
      agentProfilesData?.agentProfiles,
      mentionTargetsData?.threadMentionTargets,
      routeThread?.spaceId,
    ],
  );
  const threadArtifacts = useMemo(
    () => deriveThreadArtifacts(visibleThread),
    [visibleThread],
  );
  const effectiveSelectedArtifactId = resolveThreadArtifactSelection(
    threadArtifacts,
    selectedArtifactId,
  );
  const runbookQueues = useMemo(
    () => toRunbookQueues(runbookRunsData?.runbookRuns),
    [runbookRunsData?.runbookRuns],
  );
  const hasActiveRunbookQueue = runbookQueues.some((queue) =>
    isActiveRunbookQueue(queue.status),
  );
  const isManualRefreshFetching =
    fetching ||
    mentionTargetsFetching ||
    tasksFetching ||
    eventsFetching ||
    runbookRunsFetching ||
    workItemsFetching ||
    linkedTasksFetching ||
    progressMarkdownFetching ||
    goalFilesFetching ||
    refreshingProgress;
  const handleRefreshThread = useCallback(async () => {
    setManualRefreshStartedAt(Date.now());
    setManualRefreshObservedFetching(false);
    if (tenantId) {
      const result = await refreshThreadProgress({
        input: { tenantId, threadId },
      });
      if (result.error) {
        toast.error(result.error.message);
      }
    }
    reexecuteQuery({ requestPolicy: "network-only" });
    reexecuteTasksQuery({ requestPolicy: "network-only" });
    reexecuteEventsQuery({ requestPolicy: "network-only" });
    reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
    reexecuteMentionTargetsQuery({ requestPolicy: "network-only" });
    reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
    reexecuteWorkItemsQuery({ requestPolicy: "network-only" });
    reexecuteProgressMarkdownQuery({ requestPolicy: "network-only" });
    reexecuteGoalFilesQuery({ requestPolicy: "network-only" });
  }, [
    reexecuteEventsQuery,
    reexecuteGoalFilesQuery,
    reexecuteLinkedTasksQuery,
    reexecuteMentionTargetsQuery,
    reexecuteProgressMarkdownQuery,
    reexecuteQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
    reexecuteWorkItemsQuery,
    refreshThreadProgress,
    tenantId,
    threadId,
  ]);
  const handleProgressStatusChange = useCallback(
    async (task: ThreadInfoChecklistTask, status: WorkItemStatusSummary) => {
      if (!tenantId || progressStatusUpdating || task.source !== "work_item") {
        return;
      }
      setUpdatingProgressWorkItemId(task.id);
      const result = await updateWorkItemStatus({
        input: {
          tenantId,
          workItemId: task.id,
          statusId: status.spaceId ? status.id : undefined,
          statusCategory: status.spaceId ? undefined : status.category,
        },
      });
      setUpdatingProgressWorkItemId(null);
      if (result.error) {
        toast.error(`Couldn't update status: ${result.error.message}`);
        return;
      }
      reexecuteWorkItemsQuery({ requestPolicy: "network-only" });
    },
    [
      progressStatusUpdating,
      reexecuteWorkItemsQuery,
      tenantId,
      updateWorkItemStatus,
    ],
  );
  const handleProgressAssigneeChange = useCallback(
    async (task: ThreadInfoChecklistTask, ownerUserId: string | null) => {
      if (
        !tenantId ||
        progressAssigneeUpdating ||
        task.source !== "work_item"
      ) {
        return;
      }
      setUpdatingProgressWorkItemId(task.id);
      const result = await updateWorkItem({
        input: {
          tenantId,
          workItemId: task.id,
          ownerUserId,
        },
      });
      setUpdatingProgressWorkItemId(null);
      if (result.error) {
        toast.error(`Couldn't update assignee: ${result.error.message}`);
        return;
      }
      reexecuteWorkItemsQuery({ requestPolicy: "network-only" });
    },
    [
      progressAssigneeUpdating,
      reexecuteWorkItemsQuery,
      tenantId,
      updateWorkItem,
    ],
  );
  const handleJsonRenderActionSuccess = useCallback(
    ({ message }: JsonRenderActionSuccess) => {
      if (!isWorkItemStatusJsonRenderActionMessage(message)) return;
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteWorkItemsQuery({ requestPolicy: "network-only" });
    },
    [reexecuteQuery, reexecuteWorkItemsQuery],
  );
  const hasDurableAssistant = hasDurableAssistantAfterLatestUser(visibleThread);
  const latestMessageAwaitsAssistant =
    latestMessageRole(visibleThread) === "USER" && !hasDurableAssistant;
  const hasActiveAgentTurn =
    hasRunningThreadTurn(visibleThread) ||
    isActiveLifecycleStatus(visibleThread?.lifecycleStatus);
  const shouldPollActiveAgentResult = Boolean(
    latestMessageAwaitsAssistant &&
    (hasActiveAgentTurn ||
      (effectiveOptimisticMessage &&
        effectiveOptimisticMessage.expectAssistantResponse !== false)),
  );

  useEffect(() => {
    if (!optimisticMessage || !hasDurableAssistant) return;
    setOptimisticMessage(null);
  }, [hasDurableAssistant, optimisticMessage]);

  useEffect(() => {
    if (!shouldPollActiveAgentResult) return;

    const refreshActiveThread = () => {
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
      reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
      reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
      reexecuteWorkItemsQuery({ requestPolicy: "network-only" });
      reexecuteProgressMarkdownQuery({ requestPolicy: "network-only" });
      reexecuteThreadTurnsQuery({ requestPolicy: "network-only" });
    };

    const intervalId = window.setInterval(
      refreshActiveThread,
      ACTIVE_AGENT_REFRESH_MS,
    );
    return () => window.clearInterval(intervalId);
  }, [
    reexecuteEventsQuery,
    reexecuteLinkedTasksQuery,
    reexecuteProgressMarkdownQuery,
    reexecuteQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
    reexecuteThreadTurnsQuery,
    reexecuteWorkItemsQuery,
    shouldPollActiveAgentResult,
  ]);
  const linkedTasks = linkedTasksData?.threadLinkedTasks ?? [];
  const nativeWorkItems = workItemsData?.threadWorkItems ?? [];
  const goalFiles = goalFilesData?.threadGoalFiles ?? null;
  const goal = goalFiles?.goal ?? null;
  const progressChecklistTasks = useMemo(
    () =>
      parseProgressMarkdownTasks(
        progressMarkdownData?.threadProgressMarkdown?.content,
      ),
    [progressMarkdownData?.threadProgressMarkdown?.content],
  );
  const workItemStatuses = useMemo(() => {
    const spaceStatuses = sortWorkItemStatuses(
      workItemStatusesData?.workItemStatuses ?? [],
    );
    return spaceStatuses.length > 0 ? spaceStatuses : categoryStatuses();
  }, [workItemStatusesData?.workItemStatuses]);
  const workItemAssignees = useMemo(
    () => workItemAssigneesFromMembers(tenantMembersData?.tenantMembers ?? []),
    [tenantMembersData?.tenantMembers],
  );
  const nativeChecklistTasks = useMemo(
    () =>
      nativeWorkItems.map((workItem) =>
        toThreadInfoWorkItem(workItem, workItemAssignees),
      ),
    [nativeWorkItems, workItemAssignees],
  );
  const infoPanelChecklistTasks =
    nativeChecklistTasks.length > 0
      ? nativeChecklistTasks
      : progressChecklistTasks.length > 0
        ? progressChecklistTasks
        : linkedTasks.map(toThreadInfoChecklistTask);
  const goalReadiness = useMemo(
    () => deriveGoalReadiness(infoPanelChecklistTasks),
    [infoPanelChecklistTasks],
  );
  const goalRecords = useMemo(
    () => summarizeGoalFiles(goalFiles?.files ?? [], threadArtifacts.length),
    [goalFiles?.files, threadArtifacts.length],
  );
  const isCustomerOnboardingThread =
    Boolean(goal) ||
    goalFilesFetching ||
    hasCustomerOnboardingMetadata(data?.thread?.metadata) ||
    nativeWorkItems.length > 0 ||
    linkedTasks.length > 0 ||
    Boolean(progressMarkdownData?.threadProgressMarkdown?.content);
  const showOnboardingChecklist =
    isCustomerOnboardingThread ||
    workItemsFetching ||
    linkedTasksFetching ||
    progressMarkdownFetching ||
    goalFilesFetching;
  const completionNotificationRef = useRef<{
    threadId: string;
    hasDurableAssistant: boolean;
  } | null>(null);

  useEffect(() => {
    if (hasDurableAssistant) {
      resetStreamingChunks();
    }
  }, [hasDurableAssistant, resetStreamingChunks]);

  useEffect(() => {
    function handleDesktopRefresh(event: Event) {
      event.preventDefault();
      void handleRefreshThread();
    }

    window.addEventListener("thinkwork:desktop-refresh", handleDesktopRefresh);
    return () =>
      window.removeEventListener(
        "thinkwork:desktop-refresh",
        handleDesktopRefresh,
      );
  }, [handleRefreshThread]);

  useEffect(() => {
    if (manualRefreshStartedAt === null) return;
    if (isManualRefreshFetching) {
      setManualRefreshObservedFetching(true);
      return;
    }

    const minimumSpinMs = manualRefreshObservedFetching ? 250 : 400;
    const elapsedMs = Date.now() - manualRefreshStartedAt;
    const timeout = window.setTimeout(
      () => {
        window.dispatchEvent(
          new CustomEvent("thinkwork:desktop-refresh-complete"),
        );
        setManualRefreshStartedAt(null);
        setManualRefreshObservedFetching(false);
      },
      Math.max(0, minimumSpinMs - elapsedMs),
    );
    return () => window.clearTimeout(timeout);
  }, [
    isManualRefreshFetching,
    manualRefreshObservedFetching,
    manualRefreshStartedAt,
  ]);

  useEffect(() => {
    const previous = completionNotificationRef.current;
    completionNotificationRef.current = { threadId, hasDurableAssistant };

    if (
      !visibleThread ||
      previous?.threadId !== threadId ||
      previous.hasDurableAssistant ||
      !hasDurableAssistant
    ) {
      return;
    }

    void notifyAgentCompletion({
      title: "Agent finished",
      body: visibleThread.title
        ? `${visibleThread.title} is ready.`
        : "Thread response is ready.",
    });
  }, [hasDurableAssistant, threadId, visibleThread]);

  useEffect(() => {
    if (selectedArtifactId !== effectiveSelectedArtifactId) {
      setSelectedArtifactId(effectiveSelectedArtifactId);
    }
    if (threadArtifacts.length === 0 && artifactPanelOpen) {
      setArtifactPanelOpen(false);
    }
    if (
      (!artifactPanelOpen || threadArtifacts.length === 0) &&
      artifactFullscreen
    ) {
      setArtifactFullscreen(false);
    }
  }, [
    artifactFullscreen,
    artifactPanelOpen,
    effectiveSelectedArtifactId,
    selectedArtifactId,
    threadArtifacts.length,
  ]);

  const artifactPanelState = useMemo(
    () => ({
      artifacts: threadArtifacts,
      selectedArtifactId: effectiveSelectedArtifactId,
      isOpen: artifactPanelOpen,
      isFullscreen: artifactFullscreen,
      onOpenChange: (open: boolean) => {
        setArtifactPanelOpen(open);
        if (!open) {
          setArtifactFullscreen(false);
        }
        if (open) {
          setThreadInfoOpen(false);
        }
      },
      onSelectArtifact: (artifactId: string) => {
        if (!threadArtifacts.some((artifact) => artifact.id === artifactId)) {
          return;
        }
        setSelectedArtifactId(artifactId);
        setArtifactPanelOpen(true);
        setThreadInfoOpen(false);
      },
    }),
    [
      artifactFullscreen,
      artifactPanelOpen,
      effectiveSelectedArtifactId,
      threadArtifacts,
    ],
  );
  const handleReviewGoal = useCallback(
    async (
      action: "CONFIRM_COMPLETION" | "REQUEST_CHANGES",
      notes?: string,
    ) => {
      if (!tenantId || !goal?.id) return;
      setGoalReviewError(null);
      const result = await reviewGoal({
        input: {
          tenantId,
          goalId: goal.id,
          action,
          ...(notes ? { notes } : {}),
        },
      });
      if (result.error) {
        setGoalReviewError(result.error.message);
        toast.error(result.error.message);
        return;
      }
      toast.success(
        action === "CONFIRM_COMPLETION"
          ? "Goal completion confirmed"
          : "Goal returned for changes",
      );
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
      reexecuteWorkItemsQuery({ requestPolicy: "network-only" });
      reexecuteProgressMarkdownQuery({ requestPolicy: "network-only" });
      reexecuteGoalFilesQuery({ requestPolicy: "network-only" });
    },
    [
      goal?.id,
      reexecuteGoalFilesQuery,
      reexecuteLinkedTasksQuery,
      reexecuteProgressMarkdownQuery,
      reexecuteQuery,
      reexecuteWorkItemsQuery,
      reviewGoal,
      tenantId,
    ],
  );
  const threadInfoPanelState = useMemo<TaskThreadInfoPanelState>(
    () => ({
      isOpen: threadInfoOpen,
      onOpenChange: (open: boolean) => {
        setThreadInfoOpen(open);
        if (open) {
          setArtifactPanelOpen(false);
          setArtifactFullscreen(false);
        }
      },
      threadId: routeThread?.id ?? threadId,
      threadIdentifier: routeThread?.identifier ?? null,
      startedAt: routeThread?.createdAt ?? null,
      startedBy: resolveStartedBy(routeThread),
      agents: resolveAgentsInvolved(routeThread),
      attachments: routeThread?.attachments ?? [],
      bridgeRuns: data?.n8nAgentStepRuns ?? [],
      onDownloadAttachment: (attachmentId: string) =>
        downloadThreadAttachment(threadId, attachmentId),
      goal:
        goal || goalFilesFetching || goalFilesError
          ? {
              id: goal?.id ?? null,
              outcome: goal?.outcome ?? extractGoalLine(goalFiles, "Outcome"),
              mode: goal?.mode ?? null,
              status: goal?.status ?? null,
              ownerLabel: resolveGoalOwnerLabel(goal, userId, goalFiles),
              reviewPolicyLabel: goalReviewPolicyLabel(goal?.reviewPolicy),
              reviewRequired: goalReviewRequired(goal?.reviewPolicy),
              readyForReview: goalReadiness.readyForReview,
              isLoading: goalFilesFetching && !goal,
              error: goalFilesError?.message ?? null,
              filesLoading: goalFilesFetching,
              filesError: goalFilesError?.message ?? null,
              filesPrepared: goalFiles
                ? goalFiles.files.some((file) => Boolean(file.content))
                : undefined,
              decisionsCount: goalRecords.decisions.count,
              decisionsSummary: goalRecords.decisions.summary,
              handoffsCount: goalRecords.handoffs.count,
              handoffsSummary: goalRecords.handoffs.summary,
              artifactsCount: goalRecords.artifacts.count,
              artifactsSummary: goalRecords.artifacts.summary,
              recordGroups: goalRecords.groups,
              isReviewing: reviewingGoal,
              reviewError: goalReviewError,
              onConfirmCompletion: () => handleReviewGoal("CONFIRM_COMPLETION"),
              onRequestChanges: (notes) =>
                handleReviewGoal("REQUEST_CHANGES", notes),
            }
          : null,
      checklist: showOnboardingChecklist
        ? {
            title: "Progress",
            tasks: infoPanelChecklistTasks,
            isLoading:
              (workItemsFetching ||
                linkedTasksFetching ||
                progressMarkdownFetching) &&
              infoPanelChecklistTasks.length === 0,
            error:
              workItemsError?.message ??
              progressMarkdownError?.message ??
              linkedTasksError?.message ??
              null,
            completedAt:
              normalizeThreadStatus(routeThread?.status) === "done"
                ? routeThread?.updatedAt
                : null,
            isCompleting: completingThread,
            isRefreshing: refreshingProgress || manualRefreshStartedAt !== null,
            workItemStatuses,
            workItemAssignees,
            updatingTaskId: updatingProgressWorkItemId,
            onRefreshProgress: handleRefreshThread,
            onTaskStatusChange:
              nativeWorkItems.length > 0
                ? handleProgressStatusChange
                : undefined,
            onTaskAssigneeChange:
              nativeWorkItems.length > 0
                ? handleProgressAssigneeChange
                : undefined,
            onCompleteThread: goalReviewRequired(goal?.reviewPolicy)
              ? undefined
              : handleCompleteThread,
          }
        : null,
    }),
    [
      goal,
      goalFiles,
      goalFilesError,
      goalFilesFetching,
      goalRecords,
      goalReviewError,
      goalReadiness.readyForReview,
      handleProgressAssigneeChange,
      handleProgressStatusChange,
      handleRefreshThread,
      handleReviewGoal,
      data?.n8nAgentStepRuns,
      routeThread,
      infoPanelChecklistTasks,
      linkedTasksError?.message,
      linkedTasksFetching,
      workItemsError?.message,
      workItemsFetching,
      progressMarkdownError?.message,
      progressMarkdownFetching,
      refreshingProgress,
      manualRefreshStartedAt,
      reviewingGoal,
      showOnboardingChecklist,
      threadId,
      threadInfoOpen,
      completingThread,
      nativeWorkItems.length,
      updatingProgressWorkItemId,
      userId,
      workItemAssignees,
      workItemStatuses,
    ],
  );

  // Space breadcrumb: a clickable parent crumb (the thread's Space) before the
  // thread title, navigating to that Space's scoped thread list — mirroring the
  // sidebar's "Thread list" action. The final crumb hosts the inline-rename
  // titleContent (see AppTopBar/DesktopApplicationHeader). Degrades to the
  // title-only header when the thread has no resolved space yet (R4).
  const spaceLabel = spaceCrumbLabel(routeThread?.space ?? null);
  const displayThreadTitle = shortcutDisplayText(threadTitle, {
    mentionTargets,
    skillCatalog,
    fallbackAgentProfiles: true,
    fallbackMentions: true,
    fallbackSkills: true,
  });
  const spaceBreadcrumbs = breadcrumbParents
    ? [...breadcrumbParents, { label: displayThreadTitle }]
    : routeThread?.spaceId
      ? [
          {
            label: spaceLabel,
            href: "/threads",
            search: { spaceId: routeThread.spaceId, spaceName: spaceLabel },
          },
          { label: displayThreadTitle },
        ]
      : undefined;

  usePageHeaderActions({
    backHref,
    title: displayThreadTitle,
    breadcrumbs: spaceBreadcrumbs,
    // Tab title gets the "Thread · " prefix to match the section pattern
    // used by Memory and other pages ("Memory · ThinkWork", etc.). The
    // in-page header keeps the bare thread title — no need to repeat
    // "Thread" inside the page the user is already on.
    documentTitle: `${documentTitlePrefix} · ${displayThreadTitle}`,
    titleContent: routeThread ? (
      <ThreadTitleInlineRename
        threadId={threadId}
        title={threadTitle}
        displayTitle={
          <InlineShortcutText
            text={threadTitle}
            mentionTargets={mentionTargets}
            skillCatalog={skillCatalog}
            fallbackAgentProfiles
            fallbackMentions
            fallbackSkills
          />
        }
        className="min-w-0 max-w-[min(28rem,55vw)]"
        // Full-width while editing so long titles aren't clipped in the field.
        editingClassName="min-w-0 w-full flex-1"
        textClassName="text-sm font-medium"
        inputClassName="h-7"
        onEditingChange={setRenamingTitle}
        onRenamed={() => reexecuteQuery({ requestPolicy: "network-only" })}
      />
    ) : undefined,
    // While renaming, unmount the "…" menu entirely so its trigger can't
    // reclaim focus from the inline rename input when the menu closes.
    titleTrailing: renamingTitle ? undefined : (
      <ThreadDetailActions
        threadId={threadId}
        threadTitle={threadTitle}
        tenantId={tenantId ?? ""}
        isPinned={Boolean(routeThread?.pinnedAt)}
        attachedArtifacts={attachedArtifacts}
        onDeleted={() => {
          // ChatSidebar owns post-delete navigation because it has the
          // actual visible, filtered thread order the user is looking at.
        }}
      />
    ),
    action: (
      <div className={`flex items-center ${desktopToolbarGapClassName}`}>
        {isOperator && latestCompletedTurnId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Flag for evaluation"
            title="Flag for evaluation"
            data-testid="thread-flag-for-eval"
            className={desktopToolbarButtonClassName}
            onClick={() => {
              setFlagEvalTurnId(latestCompletedTurnId);
              setFlagEvalOpen(true);
            }}
          >
            <Flag className="size-4" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={threadInfoOpen ? "Close thread info" : "Open thread info"}
          title={threadInfoOpen ? "Close thread info" : "Open thread info"}
          className={
            threadInfoOpen
              ? desktopToolbarActiveButtonClassName
              : desktopToolbarButtonClassName
          }
          onClick={() => {
            const nextOpen = !threadInfoOpen;
            setThreadInfoOpen(nextOpen);
            if (nextOpen) {
              setArtifactPanelOpen(false);
              setArtifactFullscreen(false);
            }
          }}
        >
          <Info className="size-4" />
        </Button>
        {artifactPanelOpen && effectiveSelectedArtifactId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={
              artifactFullscreen
                ? "Minimize artifact panel"
                : "Maximize artifact panel"
            }
            title={
              artifactFullscreen
                ? "Minimize artifact panel"
                : "Maximize artifact panel"
            }
            className={
              artifactFullscreen
                ? desktopToolbarActiveButtonClassName
                : desktopToolbarButtonClassName
            }
            onClick={() => {
              setArtifactFullscreen((current) => !current);
            }}
          >
            {artifactFullscreen ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
        ) : null}
        {effectiveSelectedArtifactId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={
              artifactPanelOpen
                ? "Close artifact side panel"
                : "Open artifact side panel"
            }
            title={
              artifactPanelOpen
                ? "Close artifact side panel"
                : "Open artifact side panel"
            }
            className={
              artifactPanelOpen
                ? desktopToolbarActiveButtonClassName
                : desktopToolbarButtonClassName
            }
            onClick={() => {
              const nextOpen = !artifactPanelOpen;
              setArtifactPanelOpen(nextOpen);
              if (!nextOpen) {
                setArtifactFullscreen(false);
              }
              if (nextOpen) {
                setThreadInfoOpen(false);
              }
            }}
          >
            <PanelRight className="size-4" />
          </Button>
        ) : null}
      </div>
    ),
    actionKey: `thread-actions:${threadId}:${attachedArtifacts.length}:${threadArtifacts.length}:${effectiveSelectedArtifactId ?? ""}:${threadInfoOpen ? "info-open" : "info-closed"}:${artifactPanelOpen ? "open" : "closed"}:${artifactFullscreen ? "fullscreen" : "normal"}:${isOperator ? (latestCompletedTurnId ?? "") : "no-flag"}`,
  });

  useEffect(() => {
    if (!computerId || !hasActiveRunbookQueue) return;
    const interval = window.setInterval(() => {
      reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
    }, 2000);
    return () => window.clearInterval(interval);
  }, [
    computerId,
    hasActiveRunbookQueue,
    reexecuteEventsQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
  ]);

  async function handleCompleteThread() {
    const result = await updateThread({
      id: threadId,
      input: { status: "DONE" },
    });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Thread completed");
    reexecuteQuery({ requestPolicy: "network-only" });
    reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
    reexecuteWorkItemsQuery({ requestPolicy: "network-only" });
    reexecuteGoalFilesQuery({ requestPolicy: "network-only" });
  }

  const threadView = (
    <TaskThreadView
      thread={visibleThread}
      isLoading={
        (fetching && !routeThread && !optimisticThreadStart) ||
        hasMismatchedThreadData
      }
      error={error?.message ?? null}
      streamingChunks={
        hasDurableAssistant || liveThreadTurnStreamState ? [] : chunks
      }
      streamState={
        hasDurableAssistant
          ? undefined
          : (liveThreadTurnStreamState ?? streamState)
      }
      isSending={sending}
      mentionTargets={mentionTargets}
      skillCatalog={skillCatalog}
      approvedModels={approvedModels ?? undefined}
      selectedModelId={selectedModelId}
      onSelectedModelChange={handleSelectedModelChange}
      currentUser={{
        id: userId,
      }}
      artifactPanelState={artifactPanelState}
      infoPanelState={threadInfoPanelState}
      onFlagTurn={
        isOperator
          ? (turn) => {
              if (!isUuidLike(turn.id)) return;
              setFlagEvalTurnId(turn.id);
              setFlagEvalOpen(true);
            }
          : undefined
      }
      onJsonRenderActionSuccess={handleJsonRenderActionSuccess}
      onSendFollowUp={async (
        content,
        files,
        mentions = [],
        agentRequested = true,
        pinnedSkills = [],
        requestedModelId,
        goalMode,
      ) => {
        const skillCreatorCommand =
          normalizeSkillCreatorCommandContent(content);
        const normalizedContent = skillCreatorCommand.content;
        setOptimisticMessage({
          content: normalizedContent,
          expectAssistantResponse: agentRequested !== false,
          startedAt: new Date().toISOString(),
          // Show the attached file on the user message immediately, before the
          // upload + persist round-trip completes.
          attachments:
            files && files.length > 0
              ? files.map((file) => ({
                  name: file.name,
                  sizeBytes: file.size,
                  mimeType: file.type,
                }))
              : undefined,
          mentions: mentions.map((mention) => ({
            targetType: mention.targetType,
            targetId: mention.targetId,
            displayName: mention.displayName,
            rawText: mention.rawText,
          })),
        });
        resetStreamingChunks();

        // Upload attached files before sendMessage so persisted messages only
        // reference finalized thread_attachment rows. All-failed uploads block
        // the send; partial success sends only finalized files and tells the
        // user which part did not make it.
        const apiUrl = readRuntimeEnv("VITE_API_URL");
        let attachmentRefs: { attachmentId: string }[] = [];
        if (files && files.length > 0) {
          if (!apiUrl) {
            setOptimisticMessage(null);
            throw new Error("Attachment upload endpoint is not configured");
          }
          const token = await getIdToken();
          if (!token) {
            setOptimisticMessage(null);
            throw new Error("Sign-in required to upload attachments");
          }
          const result = await uploadThreadAttachments({
            endpoints: { apiUrl, token },
            threadId,
            files,
          });
          attachmentRefs = result.uploaded.map((a) => ({
            attachmentId: a.attachmentId,
          }));
          if (attachmentRefs.length === 0 && result.failures.length > 0) {
            setOptimisticMessage(null);
            const first = result.failures[0]!;
            throw new Error(
              `Upload failed for ${first.file.name}: ${first.message}`,
            );
          }
          if (result.failures.length > 0) {
            toast.warning(
              `${result.failures.length} attachment${result.failures.length === 1 ? "" : "s"} could not be uploaded.`,
            );
          }
        }

        const sendInput: {
          threadId: string;
          role: "USER";
          content: string;
          metadata?: string;
          mentions?: Array<{
            targetType: "USER" | "AGENT" | "AGENT_PROFILE";
            targetId: string;
            displayName: string;
            rawText: string;
          }>;
          agentRequested?: boolean;
          modelId?: string;
        } = {
          threadId,
          role: "USER",
          content: normalizedContent,
        };
        let metadata: Record<string, unknown> = {};
        if (attachmentRefs.length > 0) metadata.attachments = attachmentRefs;
        if (pinnedSkills.length > 0) {
          metadata.skills = pinnedSkills.map((slug) => ({ slug }));
        }
        if (skillCreatorCommand.command) {
          metadata.command = skillCreatorCommand.command;
        }
        const turnModelId = requestedModelId ?? selectedModelId;
        if (turnModelId) {
          sendInput.modelId = turnModelId;
          metadata.requestedModelId = turnModelId;
        }
        metadata = appendGoalModeMetadata(metadata, goalMode);
        if (Object.keys(metadata).length > 0) {
          sendInput.metadata = JSON.stringify(metadata);
        }
        if (mentions.length > 0) {
          sendInput.mentions = mentions.map(toSendMention);
        }
        if (agentRequested === false) {
          sendInput.agentRequested = false;
        }
        const result = await sendMessage({ input: sendInput });
        if (result.error) {
          setOptimisticMessage(null);
          if (attachmentRefs.length > 0) {
            toast.error(
              "Files uploaded, but the message did not send. Try sending the message again.",
            );
          }
          throw result.error;
        }
        const sentMessage = (
          result.data as { sendMessage?: { metadata?: unknown } } | undefined
        )?.sendMessage;
        const customerOnboardingHandled = isCustomerOnboardingChatUpdateHandled(
          sentMessage?.metadata,
        );
        if (customerOnboardingHandled) {
          setOptimisticMessage(null);
        }
        reexecuteQuery({ requestPolicy: "network-only" });
        reexecuteTasksQuery({ requestPolicy: "network-only" });
        reexecuteEventsQuery({ requestPolicy: "network-only" });
        reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
        reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
        reexecuteWorkItemsQuery({ requestPolicy: "network-only" });
        reexecuteGoalFilesQuery({ requestPolicy: "network-only" });
        reexecuteThreadTurnsQuery({ requestPolicy: "network-only" });
      }}
      runbookQueues={runbookQueues}
    />
  );

  return (
    <>
      {threadView}
      <FlagThreadForEvalDialog
        open={flagEvalOpen}
        onOpenChange={(open) => {
          setFlagEvalOpen(open);
          if (!open) setFlagEvalTurnId(null);
        }}
        tenantId={tenantId ?? ""}
        threadId={threadId}
        turnId={flagEvalTurnId}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Flag-for-evaluation helpers (Trust Core U7)
// ---------------------------------------------------------------------------

const FLAGGABLE_TURN_STATUSES = new Set([
  "completed",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/**
 * Latest completed persisted turn — the target of the header-level
 * "Flag for evaluation" action. Synthetic/optimistic turn rows carry
 * non-UUID ids and are skipped.
 */
export function latestFlaggableTurnId(turns: TaskThreadTurn[]): string | null {
  let best: { id: string; time: number } | null = null;
  for (const turn of turns) {
    const status = String(turn.status ?? "")
      .trim()
      .toLowerCase();
    if (!FLAGGABLE_TURN_STATUSES.has(status)) continue;
    if (!isUuidLike(turn.id)) continue;
    const time = Date.parse(turn.finishedAt ?? turn.startedAt ?? "");
    const safeTime = Number.isFinite(time) ? time : 0;
    if (!best || safeTime >= best.time) {
      best = { id: turn.id, time: safeTime };
    }
  }
  return best?.id ?? null;
}

export function deriveThreadArtifacts(
  thread: TaskThread | null,
): GeneratedArtifact[] {
  const artifacts: GeneratedArtifact[] = [];
  const seen = new Set<string>();
  for (const message of thread?.messages ?? []) {
    const artifact = message.durableArtifact;
    if (!artifact || seen.has(artifact.id)) continue;
    seen.add(artifact.id);
    artifacts.push(artifact);
  }
  return artifacts;
}

export function resolveThreadArtifactSelection(
  artifacts: GeneratedArtifact[],
  currentArtifactId: string | null,
) {
  if (
    currentArtifactId &&
    artifacts.some((artifact) => artifact.id === currentArtifactId)
  ) {
    return currentArtifactId;
  }
  return artifacts.at(-1)?.id ?? null;
}

function toSendMention(mention: ComposerMention) {
  return {
    targetType: mention.targetType,
    targetId: mention.targetId,
    displayName: mention.displayName,
    rawText: mention.rawText,
  };
}

function resolveStartedBy(thread?: ThreadResult["thread"]) {
  if (!thread) return null;
  const firstUserMessage = thread.messages?.edges?.find(
    ({ node }) => node.role.toUpperCase() === "USER",
  )?.node;
  return (
    firstUserMessage?.sender?.displayName?.trim() ||
    thread.user?.name?.trim() ||
    thread.user?.email?.trim() ||
    thread.userId ||
    null
  );
}

function resolveAgentsInvolved(thread?: ThreadResult["thread"]) {
  if (!thread) return [];
  const agents = new Set<string>();
  for (const { node } of thread.messages?.edges ?? []) {
    for (const mention of node.mentions ?? []) {
      if (mention.targetType?.toUpperCase() !== "AGENT") continue;
      const label = mention.displayName?.trim();
      if (label) agents.add(label);
    }
    if (node.role.toUpperCase() !== "USER") {
      const label = node.sender?.displayName?.trim();
      if (label) agents.add(label);
    }
  }
  const computerName = thread.computer?.name?.trim() || thread.computer?.slug;
  if (computerName) agents.add(computerName);
  return Array.from(agents);
}

function hasCustomerOnboardingMetadata(metadata: unknown) {
  const root = parseSpaceRecord(metadata);
  const onboarding = parseSpaceRecord(root.customerOnboarding);
  return onboarding.workflow === "customer_onboarding";
}

function toThreadInfoChecklistTask(
  task: LinkedTaskSummary,
): ThreadInfoChecklistTask {
  return {
    id: task.id,
    title: task.title,
    source: "linked_task",
    status: task.status,
    required: task.required,
    roleKey: task.roleKey,
    assigneeDisplay: task.assigneeDisplay,
    blocked: task.blocked,
    updatedAt: task.updatedAt,
  };
}

function toThreadInfoWorkItem(
  item: WorkItemSummary,
  assignees: WorkItemAssigneeSummary[],
): ThreadInfoChecklistTask {
  return {
    id: item.id,
    title: item.title,
    source: "work_item",
    status: threadStatusFromWorkItem(item),
    statusId: item.status?.id ?? item.statusId,
    statusCategory: workItemStatusCategory(item),
    statusColor: item.status?.color,
    required: item.required,
    roleKey: stringValue(objectValue(item.metadata)?.roleKey),
    assigneeDisplay: workItemAssigneeLabel(item, assignees),
    ownerUserId: item.ownerUserId,
    blocked: item.blocked,
    notes: item.notes,
    updatedAt: item.updatedAt,
  };
}

function workItemAssigneesFromMembers(
  members: TenantMemberSummary[],
): WorkItemAssigneeSummary[] {
  return members
    .filter(
      (member) =>
        member.principalType?.toUpperCase() === "USER" &&
        member.status?.toLowerCase() !== "removed",
    )
    .map((member) => {
      const name = member.user?.name?.trim();
      const email = member.user?.email?.trim();
      return {
        id: member.user?.id ?? member.principalId,
        name: name || email || member.principalId,
        email,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function threadStatusFromWorkItem(item: WorkItemSummary) {
  if (!item.applicable) return "not_applicable";
  if (item.completedAt) return "completed";
  switch (workItemStatusCategory(item)) {
    case "DONE":
      return "completed";
    case "SKIPPED":
      return "not_applicable";
    case "ACTIVE":
      return "in_progress";
    case "BLOCKED":
      return "blocked";
    case "TODO":
    default:
      return "todo";
  }
}

function deriveGoalReadiness(tasks: ThreadInfoChecklistTask[]) {
  const requiredTasks = tasks.filter(
    (task) =>
      task.required !== false &&
      normalizeThreadStatus(task.status) !== "not_applicable",
  );
  const completedRequired = requiredTasks.filter(
    (task) => normalizeThreadStatus(task.status) === "completed",
  ).length;
  return {
    completedRequired,
    totalRequired: requiredTasks.length,
    readyForReview:
      requiredTasks.length > 0 && completedRequired === requiredTasks.length,
  };
}

function summarizeGoalFiles(
  files: NonNullable<ThreadGoalFilesResult["threadGoalFiles"]>["files"],
  artifactFallbackCount: number,
) {
  const decisions = summarizeMarkdownList(
    goalFileContent(files, "DECISIONS"),
    "decisions",
    "Decisions",
    "DECISIONS.md",
  );
  const handoffs = summarizeMarkdownList(
    goalFileContent(files, "HANDOFFS"),
    "handoffs",
    "Handoffs",
    "HANDOFFS.md",
  );
  const artifacts = summarizeMarkdownList(
    goalFileContent(files, "ARTIFACTS"),
    "artifacts",
    "Artifacts",
    "ARTIFACTS.md",
  );
  if (artifacts.count === 0 && artifactFallbackCount > 0) {
    artifacts.count = artifactFallbackCount;
    artifacts.summary = `${artifactFallbackCount} thread artifact${artifactFallbackCount === 1 ? "" : "s"} attached`;
    artifacts.content = `- ${artifacts.summary}`;
    artifacts.items = [
      {
        id: "ARTIFACTS-0",
        type: "artifacts",
        typeLabel: "Artifacts",
        sourceFile: "Thread artifacts",
        text: artifacts.summary,
      },
    ];
  }
  return {
    decisions,
    handoffs,
    artifacts,
    groups: [
      toGoalRecordGroup(
        "decisions",
        "Decisions",
        "DECISIONS.md",
        "No decisions recorded",
        decisions,
      ),
      toGoalRecordGroup(
        "handoffs",
        "Handoffs",
        "HANDOFFS.md",
        "No handoffs recorded",
        handoffs,
      ),
      toGoalRecordGroup(
        "artifacts",
        "Artifacts",
        "ARTIFACTS.md",
        "No artifacts summarized",
        artifacts,
      ),
    ],
  };
}

function summarizeMarkdownList(
  content: string | null | undefined,
  type: ThreadInfoGoalRecord["type"],
  typeLabel: string,
  sourceFile: string,
) {
  const items = (content ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(
      (line) =>
        line && !/^none\b/i.test(line) && !/^none captured yet\.?$/i.test(line),
    )
    .map((line) => line.replace(/\s+/g, " "));
  return {
    count: items.length,
    summary: items[0] ?? null,
    content: content ?? null,
    items: items.map((text, index) => ({
      id: `${sourceFile}-${index}`,
      type,
      typeLabel,
      sourceFile,
      text,
    })),
  };
}

function toGoalRecordGroup(
  id: ThreadInfoGoalRecordGroup["id"],
  label: string,
  sourceFile: string,
  emptyLabel: string,
  summary: {
    count: number;
    summary: string | null;
    content: string | null;
    items: ThreadInfoGoalRecord[];
  },
): ThreadInfoGoalRecordGroup {
  return {
    id,
    label,
    sourceFile,
    count: summary.count,
    summary: summary.summary,
    content: summary.content,
    emptyLabel,
    records: summary.items,
  };
}

function goalFileContent(
  files: NonNullable<ThreadGoalFilesResult["threadGoalFiles"]>["files"],
  kind: string,
) {
  return files.find((file) => file.file?.toUpperCase() === kind)?.content;
}

function extractGoalLine(
  goalFiles: ThreadGoalFilesResult["threadGoalFiles"] | null,
  label: string,
) {
  const content = goalFiles ? goalFileContent(goalFiles.files, "GOAL") : null;
  if (!content) return null;
  const pattern = new RegExp(`^${label}:\\s*(.+?)\\s*$`, "im");
  return content.match(pattern)?.[1]?.trim() ?? null;
}

function resolveGoalOwnerLabel(
  goal:
    | NonNullable<ThreadGoalFilesResult["threadGoalFiles"]>["goal"]
    | null
    | undefined,
  userId: string | null,
  goalFiles: ThreadGoalFilesResult["threadGoalFiles"] | null,
) {
  const ownerType = goal?.ownerType?.toUpperCase();
  if (ownerType === "USER" && goal?.ownerId) {
    return userId && goal.ownerId === userId ? "You" : goal.ownerId;
  }
  const ownerLine = extractGoalLine(goalFiles, "Owner");
  return ownerLine ?? "Customer onboarding team";
}

function goalReviewRequired(value: unknown) {
  const policy = objectValue(value);
  return policy?.required === true || policy?.type === "human_final_review";
}

function goalReviewPolicyLabel(value: unknown) {
  return goalReviewRequired(value)
    ? "Human final review required"
    : "No final review required";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseProgressMarkdownTasks(
  content?: string | null,
): ThreadInfoChecklistTask[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const tableStart = lines.findIndex((line) =>
    /^\|\s*Task\s*\|\s*Status\s*\|\s*Owner\s*\|\s*Required\s*\|\s*Blocker\/Notes\s*\|/i.test(
      line,
    ),
  );
  if (tableStart < 0) return [];

  const subject = extractProgressSubject(lines);
  const tasks: ThreadInfoChecklistTask[] = [];
  for (const line of lines.slice(tableStart + 2)) {
    if (!line.trim().startsWith("|")) break;
    const cells = splitMarkdownTableRow(line);
    if (cells.length < 5) continue;
    const [title, status, owner, required, notes] = cells;
    if (!title || /^---+$/.test(title)) continue;
    tasks.push({
      id: `progress:${tasks.length}:${title}`,
      title: displayProgressTaskTitle(title, subject),
      source: "progress",
      status,
      assigneeDisplay: owner || null,
      required: !/^no$/i.test(required),
      blocked:
        status.toLowerCase() === "blocked" ||
        /\bblocked|waiting on|hold\b/i.test(notes),
      notes: notes || null,
    });
  }
  return tasks;
}

function extractProgressSubject(lines: string[]): string | null {
  for (const line of lines) {
    const goalMatch = line.match(
      /^Goal:\s*Complete customer onboarding for\s+(.+?)\.?\s*$/i,
    );
    if (goalMatch?.[1]) return goalMatch[1].trim();

    const threadMatch = line.match(/^Thread:\s*(.+?)\s+onboarding\s*$/i);
    if (threadMatch?.[1]) return threadMatch[1].trim();
  }
  return null;
}

function displayProgressTaskTitle(
  title: string,
  subject: string | null,
): string {
  const trimmed = title.trim();
  if (!subject) return trimmed;
  const suffix = ` - ${subject}`;
  return trimmed.endsWith(suffix)
    ? trimmed.slice(0, -suffix.length).trim()
    : trimmed;
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) =>
    cell
      .replace(/\\\|/g, "|")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function normalizeThreadStatus(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

async function downloadThreadAttachment(
  threadId: string,
  attachmentId: string,
) {
  // Optimistic chips carry synthetic ids and aren't downloadable yet; they're
  // replaced by the persisted message (with a real id) within a couple seconds.
  if (attachmentId.startsWith("optimistic-attachment-")) return;
  const apiUrl = readRuntimeEnv("VITE_API_URL");
  const token = await getIdToken();
  if (!apiUrl || !token) {
    toast.error("Sign-in required to download attachments.");
    return;
  }

  try {
    const res = await fetch(
      `${apiUrl}/api/threads/${threadId}/attachments/${attachmentId}/download`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
      },
    );
    if (!res.ok) {
      throw new Error(`download endpoint returned ${res.status}`);
    }
    const body = (await res.json()) as { url?: string };
    if (!body.url) {
      throw new Error("download endpoint returned no url");
    }
    window.open(body.url, "_blank", "noopener,noreferrer");
  } catch (err) {
    toast.error(
      `Could not download attachment: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    );
  }
}

function withOptimisticUserTurn(
  thread: TaskThread | null,
  content: string,
  options: {
    expectAssistantResponse?: boolean;
    startedAt?: string | null;
    attachments?: OptimisticAttachmentPreview[];
    mentions?: Array<{
      targetType: "USER" | "AGENT" | "AGENT_PROFILE";
      targetId: string;
      displayName: string;
      rawText?: string;
    }>;
  } = {},
): TaskThread | null {
  if (!thread) return null;
  const alreadyPersisted = thread.messages.some(
    (message) =>
      message.role.toUpperCase() === "USER" &&
      message.content?.trim() === content.trim(),
  );
  const hasOptimisticTurn = (thread.turns ?? []).some(
    (turn) => turn.id === "optimistic-computer-turn",
  );
  const hasRealActivity = hasRealActivityForOptimisticMessage(thread, content);
  const optimisticStartedAt =
    options.startedAt ??
    thread.messages.find(
      (message) =>
        message.role.toUpperCase() === "USER" &&
        message.content?.trim() === content.trim(),
    )?.createdAt ??
    new Date().toISOString();

  const turns =
    options.expectAssistantResponse === false ||
    hasOptimisticTurn ||
    hasRealActivity
      ? (thread.turns ?? [])
      : [
          {
            id: "optimistic-computer-turn",
            status: "running",
            invocationSource: "chat_message",
            startedAt: optimisticStartedAt,
          },
          ...(thread.turns ?? []),
        ];

  return {
    ...thread,
    messages: alreadyPersisted
      ? thread.messages
      : [
          ...thread.messages,
          {
            id: "optimistic-user-message",
            role: "USER",
            content,
            createdAt: optimisticStartedAt,
            // Display-ready chips shown immediately; the renderer prefers these
            // over metadata resolution while the upload is still in flight.
            optimisticAttachments:
              options.attachments && options.attachments.length > 0
                ? options.attachments.map((attachment, index) => ({
                    id: `optimistic-attachment-${index}`,
                    name: attachment.name,
                    mimeType: attachment.mimeType ?? null,
                    sizeBytes: attachment.sizeBytes ?? null,
                    label: attachment.name,
                  }))
                : undefined,
            mentions: options.mentions,
          },
        ],
    turns,
  };
}

function hasRealActivityForOptimisticMessage(
  thread: TaskThread,
  content: string,
): boolean {
  const normalizedContent = content.trim();
  let userIndex = -1;
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (
      message.role.toUpperCase() === "USER" &&
      message.content?.trim() === normalizedContent
    ) {
      userIndex = index;
      break;
    }
  }
  const userMessage = userIndex >= 0 ? thread.messages[userIndex] : undefined;

  if (!userMessage) return false;

  const hasAssistantAfterUser = thread.messages
    .slice(userIndex + 1)
    .some((message) => message.role.toUpperCase() === "ASSISTANT");
  if (hasAssistantAfterUser) return true;

  const userTime = Date.parse(userMessage.createdAt ?? "");
  if (!Number.isFinite(userTime)) return false;

  return (thread.turns ?? []).some((turn) => {
    if (turn.id === "optimistic-computer-turn") return false;
    const turnTime = Date.parse(turn.startedAt ?? "");
    return Number.isFinite(turnTime) && turnTime >= userTime;
  });
}

function latestMessageRole(thread: TaskThread | null): string | null {
  const role = thread?.messages.at(-1)?.role;
  return role ? role.toUpperCase() : null;
}

function hasRunningThreadTurn(thread: TaskThread | null): boolean {
  return Boolean(
    thread?.turns?.some((turn) => isActiveLifecycleStatus(turn.status)),
  );
}

function isActiveLifecycleStatus(status: string | null | undefined): boolean {
  return ["queued", "pending", "running", "started", "in_progress"].includes(
    String(status ?? "").toLowerCase(),
  );
}

function toTaskThread(thread: NonNullable<ThreadResult["thread"]>): TaskThread {
  return {
    id: thread.id,
    identifier: thread.identifier,
    title: thread.title,
    status: thread.status,
    lifecycleStatus: thread.lifecycleStatus,
    costSummary: thread.costSummary,
    messages: (thread.messages?.edges ?? []).map(({ node }) => ({
      id: node.id,
      role: node.role,
      content: node.content,
      sender: node.sender,
      parts: normalizePersistedParts(node.parts),
      createdAt: node.createdAt,
      metadata: node.metadata,
      mentions: node.mentions,
      toolCalls: node.toolCalls,
      toolResults: node.toolResults,
      userQuestion: node.userQuestion
        ? {
            id: node.userQuestion.id,
            status: toUserQuestionStatus(node.userQuestion.status),
            answers: node.userQuestion.answers ?? null,
            answeredVia: node.userQuestion.answeredVia ?? null,
            answeredBy: node.userQuestion.answeredBy ?? null,
            answeredAt: node.userQuestion.answeredAt ?? null,
          }
        : null,
      durableArtifact: node.durableArtifact
        ? {
            id: node.durableArtifact.id,
            title: node.durableArtifact.title,
            type: node.durableArtifact.type,
            summary: node.durableArtifact.summary,
            metadata: metadataObject(node.durableArtifact.metadata),
          }
        : null,
    })),
  };
}

function toOptimisticTaskThread(start: PendingThreadStart): TaskThread {
  return {
    id: start.threadId,
    title: start.title,
    status: "in_progress",
    lifecycleStatus: null,
    costSummary: null,
    messages: [],
    turns: [],
  };
}

function metadataObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function isWorkItemStatusJsonRenderActionMessage(
  message: JsonRenderActionSuccess["message"],
): boolean {
  const metadata = metadataObject(message?.metadata);
  const jsonRenderAction = metadataObject(metadata?.jsonRenderAction);
  const mutation = metadataObject(jsonRenderAction?.mutation);
  return mutation?.target === "work_item_status";
}

function toTaskThreadTurns(
  tasks: ThreadTasksResult["computerTasks"],
  events: ThreadEventsResult["computerEvents"],
) {
  const eventsByTaskId = new Map<
    string,
    NonNullable<ThreadEventsResult["computerEvents"]>
  >();
  for (const event of events ?? []) {
    if (!event.taskId) continue;
    const taskEvents = eventsByTaskId.get(event.taskId) ?? [];
    taskEvents.push(event);
    eventsByTaskId.set(event.taskId, taskEvents);
  }

  return (tasks ?? []).map((task) => {
    const input = metadataObject(task.input) ?? {};
    const output = metadataObject(task.output) ?? {};
    return {
      id: task.id,
      status: task.status,
      invocationSource: stringValue(input.source) ?? "chat_message",
      startedAt: task.claimedAt ?? task.createdAt,
      finishedAt: task.completedAt,
      model: stringValue(output.model),
      usageJson: output.usage,
      resultJson: output,
      error: taskErrorMessage(task.error),
      events: (eventsByTaskId.get(task.id) ?? []).map((event) => ({
        id: event.id,
        eventType: event.eventType,
        level: event.level,
        payload: event.payload,
        createdAt: event.createdAt,
      })),
    };
  });
}

function toThreadTurnRows(rows: ThreadTurnGraphqlRow[]): ThreadTurnRow[] {
  return rows.map((row) => ({
    id: row.id,
    thread_id: row.threadId ?? null,
    invocation_source: row.invocationSource ?? null,
    runtime_type: row.runtimeType ?? null,
    status: row.status ?? null,
    started_at: row.startedAt ?? null,
    finished_at: row.finishedAt ?? null,
    error: row.error ?? null,
    error_code: row.errorCode ?? null,
    system_prompt: row.systemPrompt ?? null,
    result_json: row.resultJson,
    usage_json: row.usageJson,
    total_cost: row.totalCost ?? null,
    context_snapshot: row.contextSnapshot,
    created_at: row.createdAt ?? null,
  }));
}

function toTaskThreadTurnsFromRows(
  rows: ThreadTurnRow[],
  // Live mid-turn steps keyed by run_id (plan 2026-06-03-001 U6). Injected as
  // turn.events[] so groups stream in while running; on completion the existing
  // name-based dedup in TaskThreadView converges them against
  // usage.tool_invocations without double-rendering.
  liveStepsByRun?: Map<string, TaskThreadEvent[]>,
  persistedEventsByRun?: Map<string, TaskThreadEvent[]>,
): TaskThreadTurn[] {
  return rows
    .filter((row) => !isHiddenDesktopDelegationRow(row))
    .map((row) => ({
      id: row.id,
      status: row.status,
      invocationSource: row.invocation_source ?? "chat_message",
      runtimeType: row.runtime_type ?? null,
      startedAt: row.started_at ?? row.created_at,
      finishedAt: row.finished_at,
      model: stringValue(
        metadataObject(row.context_snapshot)?.model ??
          metadataObject(row.result_json)?.model,
      ),
      usageJson: row.usage_json,
      resultJson: row.result_json,
      totalCost: row.total_cost ?? null,
      error: row.error ?? null,
      errorCode: row.error_code ?? null,
      systemPrompt: row.system_prompt ?? null,
      // Carries workspace_projection for the per-turn Projected workspace
      // panel (plan 2026-06-12-002 U9).
      contextSnapshot: row.context_snapshot,
      events: mergeTaskThreadEvents(
        persistedEventsByRun?.get(row.id),
        liveStepsByRun?.get(row.id),
      ),
    }));
}

function taskThreadEventFromRow(row: ThreadTurnEventRow): TaskThreadEvent {
  return {
    id: row.id,
    eventType: row.event_type ?? row.eventType ?? null,
    level: row.level ?? null,
    payload: row.payload ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
  };
}

function mergeTaskThreadEvents(
  persisted: TaskThreadEvent[] | undefined,
  live: TaskThreadEvent[] | undefined,
): TaskThreadEvent[] {
  const byKey = new Map<string, TaskThreadEvent>();
  for (const event of [...(persisted ?? []), ...(live ?? [])]) {
    byKey.set(taskThreadEventDedupeKey(event), event);
  }
  return [...byKey.values()].sort((a, b) => {
    const ta = eventTimestamp(a.createdAt);
    const tb = eventTimestamp(b.createdAt);
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

function latestLiveStreamState(
  turns: TaskThreadTurn[],
  states: Map<string, UIMessageStreamState>,
): UIMessageStreamState | undefined {
  for (const turn of [...turns].reverse()) {
    if (turn.status !== "running" && turn.status !== "queued") continue;
    const state = states.get(turn.id);
    if (state && state.parts.length > 0) return state;
  }
  return undefined;
}

function uiMessageChunkFromThreadTurnPayload(payload: unknown): unknown | null {
  const record = metadataObject(payload);
  if (!record) return null;
  if (record.kind !== "thread_genui.ui_message_chunk") return null;
  return record.chunk ?? null;
}

function taskThreadEventDedupeKey(event: TaskThreadEvent): string {
  return [
    event.eventType ?? "",
    event.createdAt ?? "",
    stableJsonKey(event.payload),
  ].join(":");
}

function stableJsonKey(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value ?? "");
  }
}

function eventTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function isHiddenDesktopDelegationRow(row: ThreadTurnRow): boolean {
  const snapshot = metadataObject(row.context_snapshot);
  const delegation = metadataObject(snapshot?.desktop_managed_delegation);
  return delegation?.visibility === "hidden";
}

function toRunbookQueues(runs: RunbookRunsResult["runbookRuns"]) {
  return (runs ?? []).map((run) => {
    const displayName =
      runbookDisplayName(run.definitionSnapshot) ??
      stringValue(run.runbookSlug)?.replace(/-/g, " ") ??
      "Runbook";
    const phaseOrder = new Map<string, number>();
    const phases = new Map<
      string,
      {
        id: string;
        title: string;
        tasks: Array<{
          id: string;
          key?: string;
          taskKey?: string;
          title?: string;
          summary?: string;
          status?: string;
          dependsOn?: unknown;
          capabilityRoles?: unknown;
          sortOrder?: number;
        }>;
      }
    >();

    for (const task of run.tasks ?? []) {
      const phaseId = stringValue(task.phaseId) ?? "runbook";
      if (!phaseOrder.has(phaseId)) phaseOrder.set(phaseId, phaseOrder.size);
      const phase = phases.get(phaseId) ?? {
        id: phaseId,
        title: stringValue(task.phaseTitle) ?? "Runbook",
        tasks: [],
      };
      phase.tasks.push({
        id: task.id,
        key: stringValue(task.taskKey) ?? undefined,
        taskKey: stringValue(task.taskKey) ?? undefined,
        title: stringValue(task.title) ?? undefined,
        summary: stringValue(task.summary) ?? undefined,
        status: stringValue(task.status) ?? undefined,
        dependsOn: task.dependsOn,
        capabilityRoles: task.capabilityRoles,
        sortOrder: task.sortOrder ?? undefined,
      });
      phases.set(phaseId, phase);
    }

    const sortedPhases = [...phases.values()]
      .sort((a, b) => (phaseOrder.get(a.id) ?? 0) - (phaseOrder.get(b.id) ?? 0))
      .map((phase) => ({
        ...phase,
        tasks: phase.tasks.sort(
          (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
        ),
      }));

    return {
      runbookRunId: run.id,
      runbookSlug: stringValue(run.runbookSlug) ?? undefined,
      runbookVersion: stringValue(run.runbookVersion) ?? undefined,
      displayName,
      status: stringValue(run.status) ?? undefined,
      phases: sortedPhases,
    };
  });
}

function isActiveRunbookQueue(status: unknown) {
  const normalized = stringValue(status)?.toLowerCase().replace(/_/g, "-");
  return Boolean(
    normalized &&
    !["completed", "failed", "error", "cancelled", "rejected"].includes(
      normalized,
    ),
  );
}

function runbookDisplayName(definitionSnapshot: unknown) {
  const definition = metadataObject(definitionSnapshot);
  const catalog = metadataObject(definition?.catalog);
  return stringValue(catalog?.displayName);
}

function taskErrorMessage(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  const record = metadataObject(value);
  return stringValue(record?.message) ?? stringValue(record?.code);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isCustomerOnboardingChatUpdateHandled(metadata: unknown): boolean {
  const record = metadataObject(metadata);
  const update = metadataObject(record?.customerOnboardingChatUpdate);
  return update?.handled === true && update.agentDispatchRequired !== true;
}

function threadTitleFallbackFromState(state: unknown, threadId: string) {
  if (!state || typeof state !== "object") return null;
  const fallback = (state as { threadTitleFallback?: unknown })
    .threadTitleFallback;
  if (!fallback || typeof fallback !== "object") return null;
  const record = fallback as { threadId?: unknown; title?: unknown };
  if (record.threadId !== threadId) return null;
  return stringValue(record.title);
}

function hasPersistedUserMessage(
  edges:
    | Array<{ node: { role: string; content?: string | null } }>
    | undefined
    | null,
  content: string,
) {
  return (edges ?? []).some(
    ({ node }) =>
      node.role.toUpperCase() === "USER" &&
      node.content?.trim() === content.trim(),
  );
}

function hasDurableAssistantAfterLatestUser(thread: TaskThread | null) {
  if (!thread) return false;
  const latestUserIndex = findLastIndex(
    thread.messages,
    (message) => message.role.toUpperCase() === "USER",
  );
  if (latestUserIndex < 0) return false;
  return thread.messages
    .slice(latestUserIndex + 1)
    .some((message) => message.role.toUpperCase() === "ASSISTANT");
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}
