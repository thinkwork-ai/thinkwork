import {
  ArrowUp,
  AlertCircle,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDashed,
  Code2,
  Copy,
  Database,
  Download,
  FileText,
  Flag,
  ListChecks,
  RotateCcw,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from "@thinkwork/ui";
import { Link } from "@tanstack/react-router";
import { useTenant } from "@/context/TenantContext";
import {
  Children,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSpeechButton,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  SkillTokenInput,
  type SkillTokenInputHandle,
} from "@/components/workbench/SkillTokenInput";
import { ComposerModelPicker } from "@/components/workbench/ComposerModelPicker";
import {
  GoalModeDialog,
  GoalModeToggle,
} from "@/components/workbench/GoalModeControls";
import {
  WorkItemAssigneeSelector,
  WorkItemStatusIconSelector,
} from "@/components/work-items/WorkItemInlineControls";
import type {
  WorkItemAssigneeSummary,
  WorkItemStatusSummary,
} from "@/components/work-items/work-item-display";
import {
  resolveStartGoalModeSubmission,
  type ComposerGoalModeIntent,
} from "@/components/workbench/goal-mode";
import {
  GoalRunCard,
  goalRunFromTurnEvidence,
  type GoalRunEvidence,
} from "@/components/workbench/GoalRunCard";
import {
  formatWikiContextTraceDetail,
  WikiContextTraceCard,
  wikiContextTraceFromRecord,
  wikiContextTraceKey,
  wikiContextTraceTitle,
} from "@/components/workbench/WikiContextTraceCard";
import { IconCircleCheckFilled, IconPaperclip } from "@tabler/icons-react";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import {
  formatDuration,
  formatTurnHeader,
  isRunningStatus,
} from "@/components/workbench/turnHeader";
import { useTurnElapsed } from "@/components/workbench/useTurnElapsed";
import { renderTypedParts } from "@/components/workbench/render-typed-part";
import type { JsonRenderActionSuccessHandler } from "@/components/workbench/json-render/use-json-render-action";
import type { UserQuestionRecord } from "@/lib/ui-message-types";
import { resolveUserQuestionRecord } from "@/lib/user-question-record";
import {
  TaskQueue,
  taskQueueFromRunbookQueue,
} from "@/components/runbooks/RunbookQueue";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import type {
  AccumulatedPart,
  UIMessageStreamState,
} from "@/lib/ui-message-merge";
import {
  resolveMessageAttachments,
  type MessageAttachmentDisplay,
} from "@/lib/thread-message-attachments";
import type {
  RunbookQueueData,
  TaskQueueData,
  TaskQueueGroup,
  TaskQueueItem,
} from "@/lib/ui-message-types";
import { useComposerState } from "@/lib/use-composer-state";
import { cn } from "@/lib/utils";
import { deriveAgentDefault } from "@/lib/agent-mode";
import {
  GeneratedArtifactCard,
  GeneratedArtifactPreview,
  type GeneratedArtifact,
} from "@/components/workbench/GeneratedArtifactCard";
import {
  SkillDraftStatusCard,
  type SkillDraftStatusData,
} from "@/components/workbench/SkillDraftStatusCard";
import { InlineShortcutText } from "@/components/workbench/InlineShortcutText";
import { StreamingMessageBuffer } from "@/components/workbench/StreamingMessageBuffer";
import {
  filterMentionTargets,
  MentionMenu,
  type MentionTarget,
} from "@/components/spaces/MentionMenu";
import { SkillMenu, type SkillOption } from "@/components/spaces/SkillMenu";
import {
  extractPinnedSkillSlugs,
  useComposerSkillPins,
} from "@/components/workbench/useComposerSkillPins";
import type { ComputerThreadChunk } from "@/lib/use-computer-thread-chunks";
import type { ApprovedModelOption } from "@/lib/approved-model-selection";
import { ProjectedWorkspacePanel } from "@/components/workbench/ProjectedWorkspacePanel";
import {
  agentsMdContentMayDiffer,
  parseWorkspaceProjection,
  selectLatestProjection,
  type LatestProjectionRef,
} from "@/components/workbench/workspace-projection";
import {
  BridgeRunTelemetryPanel,
  type BridgeRunTelemetry,
} from "@/components/workbench/BridgeRunTelemetryPanel";

const DEFAULT_COMPOSER_BOTTOM_INSET_PX = 220;
const COMPOSER_TRANSCRIPT_GAP_PX = 32;

export interface TaskThreadMessage {
  id: string;
  role: string;
  content?: string | null;
  sender?: TaskThreadMessageSender | null;
  createdAt?: string | null;
  metadata?: unknown;
  mentions?: Array<{
    targetType?: string | null;
    targetId?: string | null;
    displayName?: string | null;
    rawText?: string | null;
  }> | null;
  toolCalls?: unknown;
  toolResults?: unknown;
  parts?: AccumulatedPart[];
  /**
   * Answer-state record for ask_user_question messages (resolved from
   * pending_user_questions via Message.userQuestion); null for ordinary
   * messages. Parts carry questions only — answered state derives from
   * this row, never from parts mutation.
   */
  userQuestion?: UserQuestionRecord | null;
  durableArtifact?: GeneratedArtifact | null;
  /**
   * Display-ready chips for a not-yet-persisted optimistic user message, so the
   * attached file shows immediately instead of waiting for the upload + persist
   * round-trip. Real messages resolve attachments from `metadata` instead.
   */
  optimisticAttachments?: MessageAttachmentDisplay[] | null;
}

export interface TaskThreadMessageSender {
  type?: string | null;
  id?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface CurrentUserIdentity {
  id?: string | null;
  name?: string | null;
  email?: string | null;
}

export interface TaskThread {
  id: string;
  identifier?: string | null;
  title?: string | null;
  status?: string | null;
  lifecycleStatus?: string | null;
  costSummary?: number | null;
  messages: TaskThreadMessage[];
  turns?: TaskThreadTurn[];
}

export interface TaskThreadTurn {
  id: string;
  status?: string | null;
  invocationSource?: string | null;
  runtimeType?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  displayStartedAt?: string | null;
  displayFinishedAt?: string | null;
  model?: string | null;
  usageJson?: unknown;
  resultJson?: unknown;
  totalCost?: number | null;
  error?: string | null;
  errorCode?: string | null;
  systemPrompt?: string | null;
  /** Raw ThreadTurn.contextSnapshot (AWSJSON) — carries workspace_projection. */
  contextSnapshot?: unknown;
  events?: TaskThreadEvent[];
}

export interface TaskThreadEvent {
  id: string;
  eventType?: string | null;
  level?: string | null;
  payload?: unknown;
  createdAt?: string | null;
}

interface TaskThreadViewProps {
  thread: TaskThread | null;
  isLoading?: boolean;
  error?: string | null;
  streamingChunks?: ComputerThreadChunk[];
  streamState?: UIMessageStreamState;
  runbookQueues?: RunbookQueueData[];
  isSending?: boolean;
  mentionTargets?: MentionTarget[];
  skillCatalog?: SkillOption[];
  currentUser?: CurrentUserIdentity | null;
  onSendFollowUp?: (
    content: string,
    files?: File[],
    mentions?: ComposerMention[],
    agentRequested?: boolean,
    pinnedSkills?: string[],
    selectedModelId?: string,
    goalMode?: ComposerGoalModeIntent,
  ) => Promise<void> | void;
  approvedModels?: ApprovedModelOption[];
  selectedModelId?: string | null;
  onSelectedModelChange?: (modelId: string) => void;
  artifactPanelState?: TaskThreadArtifactPanelState;
  infoPanelState?: TaskThreadInfoPanelState;
  /**
   * Flag-for-evaluation affordance (Trust Core U7). Rendered per
   * completed turn when provided — the host gates it on the operator
   * role (TenantContext.isOperator); the server enforces regardless.
   */
  onFlagTurn?: (turn: TaskThreadTurn) => void;
  onJsonRenderActionSuccess?: JsonRenderActionSuccessHandler;
}

export interface TaskThreadArtifactPanelState {
  artifacts: GeneratedArtifact[];
  selectedArtifactId: string | null;
  isOpen: boolean;
  isFullscreen?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectArtifact: (artifactId: string) => void;
}

export interface TaskThreadInfoPanelState {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  threadId?: string | null;
  threadIdentifier?: string | null;
  startedAt?: string | null;
  startedBy?: string | null;
  agents: string[];
  attachments: ThreadInfoAttachment[];
  bridgeRuns?: BridgeRunTelemetry[] | null;
  onDownloadAttachment: (attachmentId: string) => void | Promise<void>;
  goal?: ThreadInfoGoalState | null;
  checklist?: ThreadInfoChecklistState | null;
}

export interface ThreadInfoGoalState {
  id?: string | null;
  outcome?: string | null;
  mode?: string | null;
  status?: string | null;
  ownerLabel?: string | null;
  reviewPolicyLabel?: string | null;
  reviewRequired?: boolean;
  readyForReview?: boolean;
  isLoading?: boolean;
  error?: string | null;
  filesLoading?: boolean;
  filesError?: string | null;
  filesPrepared?: boolean;
  decisionsCount?: number;
  decisionsSummary?: string | null;
  handoffsCount?: number;
  handoffsSummary?: string | null;
  artifactsCount?: number;
  artifactsSummary?: string | null;
  recordGroups?: ThreadInfoGoalRecordGroup[];
  isReviewing?: boolean;
  reviewError?: string | null;
  onConfirmCompletion?: () => Promise<void> | void;
  onRequestChanges?: (notes: string) => Promise<void> | void;
}

export interface ThreadInfoGoalRecordGroup {
  id: "decisions" | "handoffs" | "artifacts";
  label: string;
  sourceFile: string;
  count: number;
  summary?: string | null;
  content?: string | null;
  emptyLabel: string;
  records: ThreadInfoGoalRecord[];
}

export interface ThreadInfoGoalRecord {
  id: string;
  type: "decisions" | "handoffs" | "artifacts";
  typeLabel: string;
  sourceFile: string;
  text: string;
}

export interface ThreadInfoAttachment {
  id: string;
  name?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt?: string | null;
}

export interface ThreadInfoChecklistState {
  title?: string;
  tasks: ThreadInfoChecklistTask[];
  isLoading?: boolean;
  error?: string | null;
  completedAt?: string | null;
  isCompleting?: boolean;
  isRefreshing?: boolean;
  workItemStatuses?: WorkItemStatusSummary[];
  workItemAssignees?: WorkItemAssigneeSummary[];
  updatingTaskId?: string | null;
  onRefreshProgress?: () => Promise<void> | void;
  onCompleteThread?: () => Promise<void> | void;
  onTaskStatusChange?: (
    task: ThreadInfoChecklistTask,
    status: WorkItemStatusSummary,
  ) => Promise<void> | void;
  onTaskAssigneeChange?: (
    task: ThreadInfoChecklistTask,
    ownerUserId: string | null,
  ) => Promise<void> | void;
}

export interface ThreadInfoChecklistTask {
  id: string;
  title: string;
  status?: string | null;
  statusId?: string | null;
  statusCategory?: string | null;
  statusColor?: string | null;
  source?: "work_item" | "linked_task" | "progress";
  required?: boolean | null;
  roleKey?: string | null;
  assigneeDisplay?: string | null;
  ownerUserId?: string | null;
  blocked?: boolean | null;
  notes?: string | null;
  updatedAt?: string | null;
}

export interface ComposerMention {
  targetType: "USER" | "AGENT" | "AGENT_PROFILE";
  targetId: string;
  displayName: string;
  rawText: string;
}

export function TaskThreadView({
  thread,
  isLoading = false,
  error,
  streamingChunks = [],
  streamState,
  runbookQueues = [],
  isSending = false,
  mentionTargets = [],
  skillCatalog = [],
  approvedModels,
  selectedModelId,
  onSelectedModelChange,
  currentUser,
  onSendFollowUp,
  artifactPanelState,
  infoPanelState,
  onFlagTurn,
  onJsonRenderActionSuccess,
}: TaskThreadViewProps) {
  const { isOperator } = useTenant();
  const composerDockRef = useRef<HTMLDivElement | null>(null);
  const [composerBottomInsetPx, setComposerBottomInsetPx] = useState(
    DEFAULT_COMPOSER_BOTTOM_INSET_PX,
  );
  const [composerPrefill, setComposerPrefill] = useState<{
    text: string;
    token: number;
  } | null>(null);

  useLayoutEffect(() => {
    const composerDock = composerDockRef.current;
    if (!composerDock) return;

    const updateComposerBottomInset = () => {
      const nextInset =
        Math.ceil(composerDock.getBoundingClientRect().height) +
        COMPOSER_TRANSCRIPT_GAP_PX;
      if (nextInset <= 0) return;
      setComposerBottomInsetPx((currentInset) =>
        Math.abs(currentInset - nextInset) > 1 ? nextInset : currentInset,
      );
    };

    updateComposerBottomInset();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(updateComposerBottomInset);
    resizeObserver.observe(composerDock);
    window.addEventListener("resize", updateComposerBottomInset);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateComposerBottomInset);
    };
  }, []);

  // Most recent workspace projection across the thread — older turns'
  // AGENTS.md viewers label their (current-state) content as possibly
  // differing from that turn's render (plan 2026-06-12-002 U9). Memoized:
  // selecting re-parses every turn's contextSnapshot, which would otherwise
  // run on every streaming chunk render.
  const turns = thread?.turns;
  const latestProjection = useMemo(
    () => selectLatestProjection(turns ?? []),
    [turns],
  );

  if (isLoading) {
    return <TaskThreadState label="Loading..." />;
  }
  if (error || !thread) {
    return <TaskThreadState label={error ?? "Thread not found"} tone="error" />;
  }

  const visibleMessages = withTurnResponseFallback(thread);
  const transcriptMessages = visibleMessages.filter(
    (message) => !isTaskQueueAssistantMessage(message),
  );
  const promptTaskQueue = selectPromptTaskQueue(
    visibleMessages,
    runbookQueues,
    streamState?.parts ?? [],
  );
  const hasTypedStreamParts = (streamState?.parts.length ?? 0) > 0;
  const showStreamingBuffer =
    (streamingChunks.length > 0 || hasTypedStreamParts) &&
    !hasAssistantAfterLatestUser(visibleMessages);
  const latestUserIndex = findLastIndex(
    transcriptMessages,
    (message) => message.role.toUpperCase() === "USER",
  );
  const turnByUserMessageId = mapTurnsToUserMessages(
    transcriptMessages,
    thread.turns ?? [],
  );
  const selectedArtifact =
    artifactPanelState?.artifacts.find(
      (artifact) => artifact.id === artifactPanelState.selectedArtifactId,
    ) ?? null;
  const artifactPanelOpen = Boolean(
    artifactPanelState?.isOpen && selectedArtifact,
  );
  const infoPanelOpen = infoPanelState?.isOpen ?? false;

  return (
    <main className="relative flex h-full w-full overflow-hidden bg-background">
      <section
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-background"
        aria-label="Thread conversation"
      >
        <Conversation
          // Leave the outer StickToBottom div as a layout container only.
          // The library's inner scroll wrapper (set up in StickToBottom.Content
          // with overflow:auto + scrollbarGutter "stable both-edges") owns
          // scrolling. Adding overflow-y-auto here forces a second scroll
          // container and produces visible double scrollbars at the right
          // edge of the conversation column once the artifact side panel
          // narrows it.
          className="flex-1"
          aria-label="Thread transcript"
        >
          <ConversationContent
            data-testid="thread-conversation-content"
            className={cn(
              "w-full gap-0 px-4 pt-4 sm:px-6",
              infoPanelOpen && "md:pr-[336px]",
            )}
            style={{ paddingBottom: composerBottomInsetPx }}
          >
            <div
              data-testid="thread-conversation-column"
              className="mx-auto grid w-full max-w-[750px] gap-3 px-3"
            >
              {transcriptMessages.length === 0 ? (
                <ThinkingRow
                  title="Working…"
                  running
                  detail="ThinkWork is preparing this thread."
                />
              ) : (
                transcriptMessages.map((message, index) => {
                  const turn = turnByUserMessageId.get(message.id);
                  return (
                    <TranscriptSegment
                      key={message.id}
                      message={message}
                      turn={turn}
                      threadId={thread.id}
                      latestProjection={latestProjection}
                      isLatestUser={index === latestUserIndex}
                      streamingChunks={
                        index === latestUserIndex && showStreamingBuffer
                          ? streamingChunks
                          : []
                      }
                      streamState={
                        index === latestUserIndex && showStreamingBuffer
                          ? streamState
                          : undefined
                      }
                      onOpenArtifact={artifactPanelState?.onSelectArtifact}
                      onSendFollowUp={onSendFollowUp}
                      isSending={isSending}
                      threadAttachments={infoPanelState?.attachments ?? []}
                      onDownloadAttachment={
                        infoPanelState?.onDownloadAttachment
                      }
                      currentUser={currentUser}
                      mentionTargets={mentionTargets}
                      skillCatalog={skillCatalog}
                      viewerIsOperator={isOperator}
                      onFlagTurn={onFlagTurn}
                      onJsonRenderActionSuccess={onJsonRenderActionSuccess}
                    />
                  );
                })
              )}
            </div>
          </ConversationContent>
        </Conversation>

        <ThreadInfoPanel
          state={infoPanelState}
          onTaskPrompt={(task) =>
            setComposerPrefill({
              text: `${task.title}: `,
              token: Date.now(),
            })
          }
        />

        <div
          ref={composerDockRef}
          data-testid="follow-up-composer-dock"
          className={cn(
            "pointer-events-none shrink-0 px-4 sm:px-6",
            infoPanelOpen && "md:pr-[336px]",
          )}
        >
          <div className="pointer-events-auto mx-auto w-full max-w-[750px] bg-background pb-4">
            <FollowUpComposer
              threadId={thread.id}
              taskQueue={promptTaskQueue}
              disabled={!onSendFollowUp || isSending}
              isSending={isSending}
              mentionTargets={mentionTargets}
              skillCatalog={skillCatalog}
              approvedModels={approvedModels}
              selectedModelId={selectedModelId}
              onSelectedModelChange={onSelectedModelChange}
              threadMessages={thread.messages}
              currentUserId={currentUser?.id ?? null}
              prefill={composerPrefill}
              onSubmit={onSendFollowUp}
            />
          </div>
        </div>
      </section>

      <ArtifactSidePanel
        artifact={selectedArtifact}
        open={artifactPanelOpen}
        fullscreen={artifactPanelState?.isFullscreen ?? false}
      />
    </main>
  );
}

function ArtifactSidePanel({
  artifact,
  open,
  fullscreen,
}: {
  artifact: GeneratedArtifact | null;
  open: boolean;
  fullscreen: boolean;
}) {
  const [width, setWidth] = useState(500);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging || fullscreen) return;

    const handlePointerMove = (event: PointerEvent) => {
      const maxWidth = Math.max(420, window.innerWidth - 360);
      setWidth(clamp(window.innerWidth - event.clientX, 360, maxWidth));
    };

    const handlePointerUp = () => {
      setIsDragging(false);
    };

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [fullscreen, isDragging]);

  if (!open || !artifact) return null;

  return (
    <aside
      className={cn(
        "relative hidden h-full shrink-0 flex-col border-l border-border bg-background shadow-xl md:flex",
        fullscreen && "absolute inset-0 z-30 w-full border-l-0",
      )}
      style={fullscreen ? undefined : { width }}
      aria-label="Artifact side panel"
      data-testid="artifact-side-panel"
    >
      {!fullscreen ? (
        <div
          role="separator"
          aria-label="Resize artifact panel"
          aria-orientation="vertical"
          aria-valuemin={360}
          aria-valuemax={Math.max(420, window.innerWidth - 360)}
          aria-valuenow={width}
          tabIndex={0}
          className="absolute inset-y-0 left-0 z-20 w-2 -translate-x-1 cursor-col-resize outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const delta = event.key === "ArrowLeft" ? 24 : -24;
            const maxWidth = Math.max(420, window.innerWidth - 360);
            setWidth((currentWidth) =>
              clamp(currentWidth + delta, 360, maxWidth),
            );
          }}
        />
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <GeneratedArtifactPreview artifact={artifact} bare />
      </div>
    </aside>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function ThreadInfoPanel({
  state,
  onTaskPrompt,
}: {
  state?: TaskThreadInfoPanelState;
  onTaskPrompt: (task: ThreadInfoChecklistTask) => void;
}) {
  if (!state?.isOpen) return null;

  return <ThreadInfoPanelBody state={state} onTaskPrompt={onTaskPrompt} />;
}

function ThreadInfoPanelBody({
  state,
  onTaskPrompt,
}: {
  state: TaskThreadInfoPanelState;
  onTaskPrompt: (task: ThreadInfoChecklistTask) => void;
}) {
  const { isOperator } = useTenant();
  const startedAt = formatInfoDate(state.startedAt);
  const startedBy = state.startedBy?.trim() || "Unknown";
  const hasGoal = Boolean(state.goal);

  return (
    <aside
      className="tw-thread-info-panel absolute bottom-4 right-5 top-2.5 z-20 hidden w-[300px] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#2b2b2b]/95 text-[#ececec] shadow-2xl md:grid"
      aria-label={hasGoal ? "Thread Goal info" : "Thread info"}
      data-testid="thread-info-panel"
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        <div className="space-y-5 p-5">
          <section>
            <h2 className="mb-3 text-sm font-medium text-white/55">Thread</h2>
            <div className="space-y-3">
              {state.threadIdentifier ? (
                <InfoPanelCopyRow
                  label="Thread number"
                  value={state.threadIdentifier}
                />
              ) : null}
              {state.threadId ? (
                <InfoPanelCopyRow
                  label="Thread ID"
                  value={state.threadId}
                  valueClassName="block break-all font-mono text-[10px] leading-snug text-white/80"
                />
              ) : null}
              <InfoPanelInlineRow
                icon={<CalendarDays className="size-4" />}
                value={startedAt || "Unknown"}
              />
              <InfoPanelInlineRow
                icon={<Zap className="size-4" />}
                value={`Triggered by ${startedBy}`}
              />
              {isOperator && state.threadId ? (
                <Link
                  to="/activity/$threadId"
                  params={{ threadId: state.threadId }}
                  className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-white/70 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:bg-white/10"
                >
                  <FileText className="size-4 shrink-0 text-white/45" />
                  <span className="min-w-0 flex-1">Open thread detail</span>
                  <ChevronRight className="size-4 shrink-0 text-white/40" />
                </Link>
              ) : null}
            </div>
          </section>

          {state.attachments.length > 0 ? (
            <section className="border-t border-white/10 pt-4">
              <h2 className="mb-2 text-sm font-medium text-white/55">
                Attachments
              </h2>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {state.attachments.map((attachment) => (
                  <InfoPanelAttachmentButton
                    key={attachment.id}
                    attachment={attachment}
                    onDownload={state.onDownloadAttachment}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {state.bridgeRuns?.length ? (
            <div className="border-t border-white/10 pt-4">
              <BridgeRunTelemetryPanel
                runs={state.bridgeRuns}
                title="n8n agent steps"
                compact
                className="border-white/10 bg-white/5"
              />
            </div>
          ) : null}

          {state.goal ? (
            <div className="border-t border-white/10 pt-4">
              <ThreadInfoGoal goal={state.goal} />
            </div>
          ) : null}

          {state.checklist ? (
            <ThreadInfoChecklist
              checklist={state.checklist}
              onTaskPrompt={onTaskPrompt}
            />
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function ThreadInfoGoal({ goal }: { goal: ThreadInfoGoalState }) {
  const status = normalizeInfoStatus(goal.status);
  const reviewReady = goal.readyForReview || status === "in_review";
  const canReview =
    status === "in_review" &&
    Boolean(goal.onConfirmCompletion && goal.onRequestChanges);
  const [changesDialogOpen, setChangesDialogOpen] = useState(false);
  const [changesNotes, setChangesNotes] = useState("");
  const changesNotesValue = changesNotes.trim();

  async function handleRequestChangesSubmit(event: FormEvent) {
    event.preventDefault();
    if (!changesNotesValue || goal.isReviewing) return;
    await goal.onRequestChanges?.(changesNotesValue);
    setChangesDialogOpen(false);
    setChangesNotes("");
  }

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-medium text-white/55">Goal</h2>
          {goal.status ? (
            <span className="shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-medium text-white/75">
              {formatInfoStatus(goal.status)}
            </span>
          ) : null}
        </div>
        {goal.isLoading ? (
          <p className="text-sm text-white/55">Loading Goal...</p>
        ) : goal.error ? (
          <p className="rounded-lg border border-red-400/30 px-3 py-2 text-xs text-red-100">
            {goal.error}
          </p>
        ) : (
          <>
            <p className="text-sm font-medium leading-snug text-white/85">
              {goal.outcome?.trim() || "Goal outcome unavailable"}
            </p>
            <div className="space-y-2">
              {goal.mode ? (
                <InfoPanelInlineRow
                  icon={<Sparkles className="size-4" />}
                  value={`${formatInfoStatus(goal.mode)} mode`}
                />
              ) : null}
              {goal.ownerLabel ? (
                <InfoPanelInlineRow
                  icon={<Bot className="size-4" />}
                  value={`Owner: ${goal.ownerLabel}`}
                />
              ) : null}
              {goal.reviewPolicyLabel ? (
                <InfoPanelInlineRow
                  icon={<ListChecks className="size-4" />}
                  value={goal.reviewPolicyLabel}
                />
              ) : null}
            </div>
          </>
        )}
      </section>

      <section className="border-t border-white/10 pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/55">
          Review
        </h2>
        <p className="mt-2 text-sm text-white/70">
          {goalReviewMessage(goal, reviewReady)}
        </p>
        {goal.reviewError ? (
          <p className="mt-3 rounded-lg border border-red-400/30 px-3 py-2 text-xs text-red-100">
            {goal.reviewError}
          </p>
        ) : null}
        {canReview ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-label="Confirm Goal completion"
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-white/12 px-2 text-xs font-medium text-white transition-colors hover:bg-white/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={goal.isReviewing}
              onClick={() => void goal.onConfirmCompletion?.()}
            >
              <CheckCircle2 className="size-3.5" />
              {goal.isReviewing ? "Reviewing" : "Confirm"}
            </button>
            <button
              type="button"
              aria-label="Request Goal changes"
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-white/12 px-2 text-xs font-medium text-white/75 transition-colors hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={goal.isReviewing}
              onClick={() => setChangesDialogOpen(true)}
            >
              <RotateCcw className="size-3.5" />
              Changes
            </button>
          </div>
        ) : null}
      </section>
      <Dialog open={changesDialogOpen} onOpenChange={setChangesDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(event) => void handleRequestChangesSubmit(event)}>
            <DialogHeader>
              <DialogTitle>Request changes</DialogTitle>
              <DialogDescription>
                Describe what needs to change before this Goal can be closed.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-2">
              <Label htmlFor="goal-review-changes-notes">Change request</Label>
              <Textarea
                id="goal-review-changes-notes"
                value={changesNotes}
                onChange={(event) => setChangesNotes(event.target.value)}
                rows={4}
                placeholder="Example: final summary needs AP contact and updated handoff notes."
                autoFocus
              />
            </div>
            <DialogFooter className="mt-4">
              <button
                type="button"
                className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setChangesDialogOpen(false)}
                disabled={goal.isReviewing}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex min-h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!changesNotesValue || goal.isReviewing}
              >
                {goal.isReviewing ? "Requesting..." : "Create follow-up"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ThreadInfoGoalFiles({ goal }: { goal: ThreadInfoGoalState }) {
  const [openRecordGroupId, setOpenRecordGroupId] = useState<
    ThreadInfoGoalRecordGroup["id"] | null
  >(null);
  const recordGroups =
    goal.recordGroups ?? fallbackGoalRecordGroupsFromLegacyCounts(goal);
  const firstOpenableGroup = recordGroups.find(
    (group) => group.records.length > 0 || Boolean(group.content?.trim()),
  );
  const hasNarrative =
    recordGroups.some(
      (group) =>
        group.count > 0 ||
        Boolean(group.summary?.trim()) ||
        Boolean(group.content?.trim()),
    ) ||
    goal.filesLoading ||
    goal.filesError ||
    goal.filesPrepared === false;

  if (!hasNarrative) return null;

  return (
    <section className="border-t border-white/10 pt-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/55">
          Goal files
        </h2>
        {firstOpenableGroup ? (
          <button
            type="button"
            aria-label="View Goal files"
            className="inline-flex size-7 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
            onClick={() => setOpenRecordGroupId(firstOpenableGroup.id)}
          >
            <FileText className="size-3.5" />
          </button>
        ) : null}
      </div>
      {goal.filesLoading ? (
        <p className="mt-3 text-sm text-white/55">Preparing Goal files...</p>
      ) : goal.filesError ? (
        <p className="mt-3 rounded-lg border border-amber-300/30 px-3 py-2 text-xs text-amber-100">
          Goal files unavailable. Structured progress is still current.
        </p>
      ) : goal.filesPrepared === false ? (
        <p className="mt-3 text-sm text-white/55">
          Goal files are still being prepared.
        </p>
      ) : null}
      <div className="mt-3 space-y-2">
        {recordGroups.map((group) => (
          <GoalRecordLine
            key={group.id}
            label={group.label}
            count={group.count}
            summary={group.summary}
            emptyLabel={group.emptyLabel}
            canOpen={group.records.length > 0 || Boolean(group.content?.trim())}
            onOpen={() => setOpenRecordGroupId(group.id)}
          />
        ))}
      </div>
      <GoalFilesDialog
        open={openRecordGroupId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenRecordGroupId(null);
        }}
        activeGroupId={openRecordGroupId}
        onActiveGroupChange={setOpenRecordGroupId}
        groups={recordGroups}
      />
    </section>
  );
}

function GoalRecordLine({
  label,
  count,
  summary,
  emptyLabel,
  canOpen,
  onOpen,
}: {
  label: string;
  count: number;
  summary?: string | null;
  emptyLabel: string;
  canOpen?: boolean;
  onOpen?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-mono text-white/75">
          {sourceFileLabel(label)}
        </span>
        <span className="shrink-0 text-xs text-white/45">
          {count} item{count === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-xs text-white/50">
        {summary?.trim() || emptyLabel}
      </p>
    </>
  );

  if (canOpen) {
    return (
      <button
        type="button"
        aria-label={`View ${sourceFileLabel(label)}`}
        className="block w-full min-w-0 rounded-md px-1 py-1 text-left transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
        onClick={onOpen}
      >
        {content}
      </button>
    );
  }

  return <div className="min-w-0">{content}</div>;
}

function GoalFilesDialog({
  open,
  onOpenChange,
  activeGroupId,
  onActiveGroupChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeGroupId: ThreadInfoGoalRecordGroup["id"] | null;
  onActiveGroupChange: (groupId: ThreadInfoGoalRecordGroup["id"]) => void;
  groups: ThreadInfoGoalRecordGroup[];
}) {
  const activeGroup =
    groups.find((group) => group.id === activeGroupId) ?? groups[0] ?? null;
  const markdown =
    activeGroup?.content?.trim() ||
    activeGroup?.records.map((record) => `- ${record.text}`).join("\n") ||
    "This Goal file has not been prepared yet.";

  const title = activeGroup?.sourceFile
    ? `Goal files: ${activeGroup.sourceFile}`
    : "Goal files";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="z-[1000] grid max-h-[min(86vh,720px)] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border border-white/12 shadow-[0_18px_80px_rgba(0,0,0,0.65)] sm:max-w-3xl"
        style={{ backgroundColor: "rgb(8, 8, 8)" }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Markdown source files from this thread&apos;s portable Goal folder.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              aria-pressed={group.id === activeGroup?.id}
              className={cn(
                "inline-flex min-h-8 items-center gap-2 rounded-md border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35",
                group.id === activeGroup?.id
                  ? "border-white/22 bg-white/12 text-white"
                  : "border-white/10 text-white/60 hover:bg-white/8 hover:text-white",
              )}
              onClick={() => onActiveGroupChange(group.id)}
            >
              <span className="font-mono">{group.sourceFile}</span>
              <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[11px] text-white/55">
                {group.count}
              </span>
            </button>
          ))}
        </div>

        <div className="min-h-0 overflow-hidden rounded-lg border border-white/10 bg-black">
          <pre className="h-full overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-6 text-white/80">
            {markdown}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function sourceFileLabel(label: string) {
  return `${label.toUpperCase()}.md`;
}

function fallbackGoalRecordGroupsFromLegacyCounts(
  goal: ThreadInfoGoalState,
): ThreadInfoGoalRecordGroup[] {
  return [
    {
      id: "decisions",
      label: "Decisions",
      sourceFile: "DECISIONS.md",
      count: goal.decisionsCount ?? 0,
      summary: goal.decisionsSummary,
      emptyLabel: "No decisions recorded",
      content: goal.decisionsSummary ? `- ${goal.decisionsSummary}` : null,
      records: [],
    },
    {
      id: "handoffs",
      label: "Handoffs",
      sourceFile: "HANDOFFS.md",
      count: goal.handoffsCount ?? 0,
      summary: goal.handoffsSummary,
      emptyLabel: "No handoffs recorded",
      content: goal.handoffsSummary ? `- ${goal.handoffsSummary}` : null,
      records: [],
    },
    {
      id: "artifacts",
      label: "Artifacts",
      sourceFile: "ARTIFACTS.md",
      count: goal.artifactsCount ?? 0,
      summary: goal.artifactsSummary,
      emptyLabel: "No artifacts summarized",
      content: goal.artifactsSummary ? `- ${goal.artifactsSummary}` : null,
      records: [],
    },
  ];
}

function InfoPanelAttachmentButton({
  attachment,
  onDownload,
}: {
  attachment: ThreadInfoAttachment;
  onDownload: (attachmentId: string) => void | Promise<void>;
}) {
  const label = attachment.name || "Attachment";
  return (
    <button
      type="button"
      aria-label={`Download ${label}`}
      className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-2 text-left text-sm text-white/75 transition-colors hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
      onClick={() => void onDownload(attachment.id)}
    >
      <FileText className="size-4 shrink-0 text-white/45" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {attachment.sizeBytes ? (
          <span className="block text-xs text-white/40">
            {formatFileSize(attachment.sizeBytes)}
          </span>
        ) : null}
      </span>
      <Download className="size-3.5 shrink-0 text-white/45" />
    </button>
  );
}

function ThreadInfoChecklist({
  checklist,
  onTaskPrompt,
}: {
  checklist: ThreadInfoChecklistState;
  onTaskPrompt: (task: ThreadInfoChecklistTask) => void;
}) {
  const visibleTasks = checklist.tasks.filter(
    (task) => normalizeInfoStatus(task.status) !== "not_applicable",
  );
  const requiredTasks = visibleTasks.filter((task) => task.required !== false);
  const completed = requiredTasks.filter(
    (task) => normalizeInfoStatus(task.status) === "completed",
  ).length;
  const total = requiredTasks.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  const latestUpdatedAt = useMemo(
    () => pickLatestUpdatedAt(visibleTasks),
    [visibleTasks],
  );

  return (
    <section className="border-t border-white/10 pt-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/55">
          Progress
        </h2>
        <div className="flex items-center gap-2">
          {checklist.onRefreshProgress ? (
            <button
              type="button"
              className="grid size-6 place-items-center rounded-md text-white/45 transition-colors hover:bg-white/8 hover:text-white/75 disabled:cursor-wait disabled:opacity-60"
              aria-label="Refresh progress"
              title="Refresh progress"
              disabled={checklist.isRefreshing}
              onClick={() => void checklist.onRefreshProgress?.()}
            >
              <RotateCcw
                className={cn(
                  "size-3.5",
                  checklist.isRefreshing ? "animate-spin" : "",
                )}
                aria-hidden
              />
            </button>
          ) : null}
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-white/75">
            {progress}%
          </span>
        </div>
      </div>

      {total > 0 ? (
        <p className="mt-1 text-xs text-white/55">
          {completed}/{total} required complete
        </p>
      ) : null}

      {total > 0 ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-white/40"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}

      {checklist.error ? (
        <p className="mt-3 rounded-lg border border-red-400/30 px-3 py-2 text-xs text-red-100">
          {checklist.error}
        </p>
      ) : checklist.isLoading && visibleTasks.length === 0 ? (
        <p className="mt-3 text-sm text-white/55">Loading checklist...</p>
      ) : visibleTasks.length === 0 ? (
        <p className="mt-3 text-sm text-white/55">No linked tasks</p>
      ) : (
        <div className="mt-3 space-y-2">
          {visibleTasks.map((task) => (
            <ThreadInfoChecklistRow
              key={task.id}
              task={task}
              checklist={checklist}
              onTaskPrompt={onTaskPrompt}
            />
          ))}
        </div>
      )}

      {checklist.completedAt ? (
        <p className="mt-3 text-xs text-white/45">
          Thread completed {formatInfoDate(checklist.completedAt)}
        </p>
      ) : null}
      {latestUpdatedAt && !checklist.completedAt ? (
        <p className="mt-1 text-[10px] text-white/45">
          Updated {relativeChecklistTime(latestUpdatedAt)}
        </p>
      ) : null}
      <ThreadInfoCompletionAction checklist={checklist} />
    </section>
  );
}

function ThreadInfoChecklistRow({
  task,
  checklist,
  onTaskPrompt,
}: {
  task: ThreadInfoChecklistTask;
  checklist: ThreadInfoChecklistState;
  onTaskPrompt: (task: ThreadInfoChecklistTask) => void;
}) {
  const status = normalizeInfoStatus(task.status);
  const isComplete = status === "completed";
  const isBlocked = task.blocked || status === "blocked";
  const isWorkItem = task.source === "work_item";
  const assignee = task.assigneeDisplay?.trim() || "Unassigned";
  const isUpdating = checklist.updatingTaskId === task.id;
  const canEditStatus =
    isWorkItem &&
    Boolean(checklist.onTaskStatusChange) &&
    (checklist.workItemStatuses?.length ?? 0) > 0;
  const canEditAssignee = isWorkItem && Boolean(checklist.onTaskAssigneeChange);

  return (
    <div className="block w-full rounded-md text-left text-sm">
      <div className="flex items-start gap-2">
        {canEditStatus ? (
          <WorkItemStatusIconSelector
            title={task.title}
            currentStatusId={task.statusId}
            currentCategory={task.statusCategory}
            currentColor={task.statusColor}
            statuses={checklist.workItemStatuses ?? []}
            disabled={isUpdating}
            triggerClassName="mt-0.5 size-5 text-white/70 hover:bg-white/10"
            onChange={(nextStatus) =>
              void checklist.onTaskStatusChange?.(task, nextStatus)
            }
          />
        ) : isComplete ? (
          <IconCircleCheckFilled
            className="mt-1 size-3.5 shrink-0 text-white/55"
            aria-hidden
            data-testid="checklist-icon-completed"
          />
        ) : isBlocked ? (
          <AlertCircle
            className="mt-1 size-3.5 shrink-0 text-red-300"
            aria-hidden
            data-testid="checklist-icon-blocked"
          />
        ) : (
          <CircleDashed
            className="mt-1 size-3.5 shrink-0 text-white/45"
            aria-hidden
            data-testid="checklist-icon-todo"
          />
        )}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="line-clamp-2 text-left text-white/80 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            onClick={() => onTaskPrompt(task)}
            aria-label={`Update ${task.title}`}
          >
            {task.title}
          </button>
          {canEditAssignee ? (
            <WorkItemAssigneeSelector
              label={assignee}
              selectedId={task.ownerUserId ?? null}
              assignees={checklist.workItemAssignees ?? []}
              disabled={isUpdating}
              variant="text"
              triggerClassName="mt-1 max-w-full text-[10px] text-white/55 hover:text-white/85"
              onChange={(ownerUserId) =>
                void checklist.onTaskAssigneeChange?.(task, ownerUserId)
              }
            />
          ) : assignee ? (
            <p className="mt-0.5 truncate text-[10px] text-white/55">
              {assignee}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ThreadInfoCompletionAction({
  checklist,
}: {
  checklist: ThreadInfoChecklistState;
}) {
  const requiredTasks = checklist.tasks.filter(
    (task) =>
      task.required !== false &&
      normalizeInfoStatus(task.status) !== "not_applicable",
  );
  const allRequiredComplete =
    requiredTasks.length > 0 &&
    requiredTasks.every(
      (task) => normalizeInfoStatus(task.status) === "completed",
    );
  const hasBlockers = requiredTasks.some(
    (task) => task.blocked || normalizeInfoStatus(task.status) === "blocked",
  );
  const canComplete =
    allRequiredComplete &&
    !hasBlockers &&
    !checklist.completedAt &&
    Boolean(checklist.onCompleteThread);
  const label = checklist.completedAt ? "Completed" : "Mark as completed";

  if (!checklist.onCompleteThread && !checklist.completedAt) return null;

  return (
    <div className="mt-2 flex justify-end">
      <button
        type="button"
        className="text-xs font-medium text-white/45 transition-colors hover:text-primary disabled:cursor-not-allowed disabled:hover:text-white/45 disabled:opacity-45"
        disabled={!canComplete || checklist.isCompleting}
        onClick={() => void checklist.onCompleteThread?.()}
      >
        {checklist.isCompleting ? "Marking completed..." : label}
      </button>
    </div>
  );
}

function goalReviewMessage(goal: ThreadInfoGoalState, reviewReady: boolean) {
  const status = normalizeInfoStatus(goal.status);
  if (status === "completed") return "Completion has been confirmed.";
  if (status === "cancelled") return "This Goal has been cancelled.";
  if (reviewReady && goal.reviewRequired) {
    return "Required work is complete. A human reviewer must confirm before closure.";
  }
  if (reviewReady) return "Required work is complete and ready to close.";
  if (goal.reviewRequired) {
    return "Human review is required after the remaining work is complete.";
  }
  return "Continue the workflow until the completion rule is met.";
}

function InfoPanelInlineRow({
  icon,
  value,
}: {
  icon: ReactNode;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm text-white/75">
      <span className="shrink-0 text-white/45">{icon}</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

function InfoPanelCopyRow({
  label,
  value,
  valueClassName = "block truncate font-mono text-xs text-white/80",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API is unavailable.");
      }
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch (err) {
      console.warn("[ThreadInfoPanel] clipboard write failed", err);
    }
  }

  return (
    <button
      type="button"
      className="group flex min-w-0 items-center gap-2 text-left text-sm text-white/75 transition hover:text-white"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={handleCopy}
    >
      <span className="shrink-0 text-white/45 group-hover:text-white/65">
        <Copy className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] uppercase tracking-normal text-white/35">
          {label}
        </span>
        <span className={valueClassName}>{value}</span>
      </span>
      {copied ? (
        <span className="shrink-0 text-xs text-white/45">Copied</span>
      ) : null}
    </button>
  );
}

function formatInfoDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function normalizeInfoStatus(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function formatInfoStatus(value?: string | null) {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase()
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Unknown"
  );
}

function pickLatestUpdatedAt(tasks: ThreadInfoChecklistTask[]): string | null {
  let best: { value: string; time: number } | null = null;
  for (const task of tasks) {
    if (!task.updatedAt) continue;
    const time = new Date(task.updatedAt).getTime();
    if (Number.isNaN(time)) continue;
    if (!best || time > best.time) {
      best = { value: task.updatedAt, time };
    }
  }
  return best?.value ?? null;
}

function relativeChecklistTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (absMs >= ms) {
      return formatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return "just now";
}

function formatFileSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function isTaskQueueAssistantMessage(message: TaskThreadMessage) {
  if (message.role.toUpperCase() === "USER") return false;
  const metadata = parseRecord(message.metadata);
  const key = stringValue(metadata.runbookMessageKey);
  if (key?.startsWith("runbook-queue:")) return true;
  const taskQueueKey = stringValue(metadata.taskQueueMessageKey);
  if (taskQueueKey?.startsWith("task-queue:")) return true;
  const parts = message.parts ?? [];
  if (parts.some((part) => part.type === "data-runbook-queue")) return true;
  return (
    !stringValue(message.content) &&
    parts.some((part) => part.type === "data-task-queue")
  );
}

function skillDraftStatusFromMessage(
  message: TaskThreadMessage,
): SkillDraftStatusData | null {
  if (message.role.toUpperCase() === "USER") return null;
  const metadata = parseRecord(message.metadata);
  const draft = parseRecord(metadata.skillDraft ?? metadata.skill_draft);
  const id = stringValue(draft.id);
  const slug = stringValue(draft.slug);
  const status = stringValue(draft.status);
  if (!id && !slug && !status) return null;
  const trust = parseRecord(draft.trust ?? draft.trustReport);
  const severityCounts = parseRecord(
    draft.severityCounts ?? trust.severityCounts ?? trust.severity_counts,
  );

  return {
    id,
    slug,
    displayName: stringValue(draft.displayName ?? draft.display_name),
    title: stringValue(draft.title),
    summary: stringValue(draft.summary),
    status,
    trustStatus: stringValue(
      draft.trustStatus ?? draft.trust_status ?? trust.status,
    ),
    failureMessage: stringValue(draft.failureMessage ?? draft.failure_message),
    fileCount: numberValue(draft.fileCount ?? draft.file_count),
    currentContentHash: stringValue(
      draft.currentContentHash ?? draft.current_content_hash,
    ),
    publishedCatalogSlug: stringValue(
      draft.publishedCatalogSlug ?? draft.published_catalog_slug,
    ),
    severityCounts: {
      critical: numberValue(severityCounts.critical),
      high: numberValue(severityCounts.high),
      medium: numberValue(severityCounts.medium),
      low: numberValue(severityCounts.low),
      info: numberValue(severityCounts.info),
    },
  };
}

function TranscriptSegment({
  message,
  turn,
  threadId,
  latestProjection,
  isLatestUser,
  streamingChunks,
  streamState,
  onOpenArtifact,
  onSendFollowUp,
  isSending,
  threadAttachments,
  onDownloadAttachment,
  currentUser,
  mentionTargets,
  skillCatalog,
  viewerIsOperator,
  onFlagTurn,
  onJsonRenderActionSuccess,
}: {
  message: TaskThreadMessage;
  turn?: TaskThreadTurn;
  threadId?: string;
  latestProjection?: LatestProjectionRef | null;
  isLatestUser: boolean;
  streamingChunks: ComputerThreadChunk[];
  streamState?: UIMessageStreamState;
  onOpenArtifact?: (artifactId: string) => void;
  onSendFollowUp?: (
    content: string,
    files?: File[],
    mentions?: ComposerMention[],
    agentRequested?: boolean,
    pinnedSkills?: string[],
    selectedModelId?: string,
    goalMode?: ComposerGoalModeIntent,
  ) => Promise<void> | void;
  isSending?: boolean;
  threadAttachments: ThreadInfoAttachment[];
  onDownloadAttachment?: (attachmentId: string) => void | Promise<void>;
  currentUser?: CurrentUserIdentity | null;
  mentionTargets?: MentionTarget[];
  skillCatalog?: SkillOption[];
  viewerIsOperator?: boolean;
  onFlagTurn?: (turn: TaskThreadTurn) => void;
  onJsonRenderActionSuccess?: JsonRenderActionSuccessHandler;
}) {
  // Plan-012 U14: when typed UIMessage parts are flowing for this turn,
  // render via renderTypedParts (Reasoning + Tool + Response per part).
  // Falls back to the legacy chunk-based StreamingMessageBuffer when the
  // wire still produces {text} envelopes (non-Computer agents and
  // pre-U6 historical messages).
  const hasTypedParts = streamState != null && streamState.parts.length > 0;
  const skillDraft = skillDraftStatusFromMessage(message);
  return (
    <>
      <TranscriptMessage
        message={message}
        threadId={threadId}
        onOpenArtifact={onOpenArtifact}
        onSendFollowUp={onSendFollowUp}
        isSending={isSending}
        threadAttachments={threadAttachments}
        onDownloadAttachment={onDownloadAttachment}
        currentUser={currentUser}
        mentionTargets={mentionTargets}
        skillCatalog={skillCatalog}
        onJsonRenderActionSuccess={onJsonRenderActionSuccess}
      />
      {skillDraft ? (
        <SkillDraftStatusCard
          draft={skillDraft}
          viewerIsOperator={viewerIsOperator}
        />
      ) : null}
      {turn ? (
        <ThreadTurnActivity
          turn={turn}
          message={message}
          threadId={threadId}
          latestProjection={latestProjection}
          onFlagTurn={onFlagTurn}
          onSendFollowUp={onSendFollowUp}
        />
      ) : null}
      {isLatestUser ? (
        <>
          {hasTypedParts ? (
            <article aria-label="Streaming assistant response">
              {renderTypedParts(streamState!.parts, {
                keyPrefix: `${message.id}::stream`,
                live: true,
                threadId,
                onJsonRenderActionSuccess,
              })}
              {streamState!.status === "streaming" ? (
                <span
                  aria-label="ThinkWork is typing"
                  className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground align-middle"
                />
              ) : null}
            </article>
          ) : streamingChunks.length > 0 ? (
            <StreamingMessageBuffer chunks={streamingChunks} />
          ) : null}
        </>
      ) : null}
    </>
  );
}

// Full DB turn-status vocabulary that warrants a rendered surface. `skipped`
// is intentionally absent (formatTurnHeader returns null for it).
const RENDERED_TURN_STATUSES = new Set([
  "running",
  "pending",
  "queued",
  "claimed",
  "completed",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

function normalizeStatus(status: unknown) {
  return String(status ?? "")
    .toLowerCase()
    .trim();
}

// Terminal statuses an operator can flag into an eval dataset (U7). The
// server rejects in-flight turns regardless; `skipped` never renders a
// turn surface at all.
const FLAGGABLE_TURN_STATUSES = new Set([
  "completed",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

function ThreadTurnActivity({
  turn,
  message,
  threadId,
  latestProjection,
  onFlagTurn,
  onSendFollowUp,
}: {
  turn?: TaskThreadTurn;
  message?: TaskThreadMessage;
  threadId?: string;
  latestProjection?: LatestProjectionRef | null;
  onFlagTurn?: (turn: TaskThreadTurn) => void;
  onSendFollowUp?: (
    content: string,
    files?: File[],
    mentions?: ComposerMention[],
    agentRequested?: boolean,
    pinnedSkills?: string[],
    selectedModelId?: string,
    goalMode?: ComposerGoalModeIntent,
  ) => Promise<void> | void;
}) {
  const status = normalizeStatus(turn?.status);
  const running = isRunningStatus(status);
  // One hook per turn surface (KTD3): live-elapsed only ticks while running,
  // freezes on terminal status, and is null for not-yet-started turns.
  const elapsedMs = useTurnElapsed(displayStartedAtForTurn(turn), running);
  // Per-turn workspace projection (U9): absent on pre-feature turns.
  // Memoized on the snapshot value (an AWSJSON string) so streaming chunk
  // re-renders don't re-JSON.parse every turn's snapshot.
  const contextSnapshot = turn?.contextSnapshot;
  const projection = useMemo(
    () => parseWorkspaceProjection(contextSnapshot),
    [contextSnapshot],
  );

  if (!turn) return null;

  const usage = parseRecord(turn.usageJson);
  const rows = actionRowsForTurn(turn, usage, message);
  const goalRun = goalRunFromTurnEvidence(turn.resultJson, turn.usageJson);

  // Single source of truth for the header label (KTD2): derived from
  // turn.status, never from "assistant message present". skipped → null.
  const durationMs = running ? elapsedMs : turnDurationMs(turn);
  const header = formatTurnHeader(status, running, durationMs);
  const costLabel =
    header && !running && turn.totalCost != null && turn.totalCost > 0
      ? formatUsd(turn.totalCost)
      : null;
  const usageLabel = header && !running ? formatTokenUsage(usage) : null;
  const shouldRender =
    header !== null &&
    (RENDERED_TURN_STATUSES.has(status) ||
      rows.length > 0 ||
      Boolean(turn.error));
  if (!shouldRender) return null;

  const elapsedLabel =
    running && elapsedMs != null ? formatDuration(elapsedMs) : null;
  const failureDetail =
    status === "failed" ? turn.error || "No error detail was provided." : null;

  // Per-turn flag-for-evaluation affordance (U7): completed turns only,
  // and only when the host wired the (operator-gated) callback.
  const canFlag =
    Boolean(onFlagTurn) && !running && FLAGGABLE_TURN_STATUSES.has(status);

  // Default closed so activity rows do not shift the page mid-read or after
  // loading; failed turns keep an explicit header and reveal details on manual
  // expansion. Manual toggle persists across re-renders.
  return (
    <div className="flex min-w-0 max-w-full items-start gap-1">
      <div className="min-w-0 flex-1">
        <ThinkingRow
          title={header}
          usageLabel={usageLabel}
          costLabel={costLabel}
          running={running}
          elapsedLabel={elapsedLabel}
          defaultOpen={false}
          detail={turnSummary(turn, usage)}
          ariaLabel="Turn activity"
        >
          {projection ? (
            <ProjectedWorkspacePanel
              projection={projection}
              threadId={threadId}
              agentsMdMayDiffer={agentsMdContentMayDiffer(
                turn.id,
                projection,
                latestProjection ?? null,
              )}
            />
          ) : null}
          {goalRun ? (
            <GoalRunCard
              goalRun={goalRun}
              onResume={
                goalRun.resumeEligible && onSendFollowUp
                  ? (resumeGoalRun) =>
                      resumeGoalRunFromThread(onSendFollowUp, resumeGoalRun)
                  : undefined
              }
            />
          ) : null}
          {rows.map((row, index) => (
            <ActionRow
              key={`${turn.id}-${index}-${row.title}`}
              title={row.title}
              detail={row.detail}
              content={row.content}
              kind={row.kind}
              hideIcon={row.hideIcon}
              childrenRows={row.children}
            />
          ))}
          {failureDetail ? (
            <ActionRow title="Run failed" detail={failureDetail} kind="tool" />
          ) : null}
        </ThinkingRow>
      </div>
      {canFlag ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Flag turn for evaluation"
          title="Flag for evaluation"
          data-testid={`flag-turn-${turn.id}`}
          className="shrink-0 text-muted-foreground/50 hover:text-foreground"
          onClick={() => onFlagTurn?.(turn)}
        >
          <Flag className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

function turnDurationMs(turn: TaskThreadTurn): number | null {
  const startedAt = displayStartedAtForTurn(turn);
  const finishedAt = turn.displayFinishedAt ?? turn.finishedAt;
  if (!startedAt || !finishedAt) return null;
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) {
    return null;
  }
  return finish - start;
}

function displayStartedAtForTurn(
  turn: TaskThreadTurn | null | undefined,
): string | null {
  return turn?.displayStartedAt ?? turn?.startedAt ?? null;
}

// Match each USER message to its corresponding turn so multi-turn threads
// render one Thinking row per turn (parity with the admin thread view).
// Attach each turn to the user message that actually triggered it, by
// timestamp causality rather than document-order position. Positional pairing
// (the i-th user message -> the i-th turn) misaligns in multi-player threads:
// other humans' messages are USER messages that trigger no turn, so a later
// turn's "Working…" row gets pinned to an earlier message. Causal pairing maps
// each turn (sorted ASC by startedAt) to the nearest-preceding user message
// (the last one created at or before the turn started).
//
// Notes:
//  - A turn that precedes every user message (e.g. a scheduled-job trigger)
//    anchors to the earliest user message so it stays discoverable.
//  - When several turns map to the same user message, the latest turn wins —
//    the transcript renders one activity disclosure per user message.
//  - Limitation: turn.startedAt derives from the task's claim time, which can
//    lag the trigger; two user messages sent before the first turn is claimed
//    can mis-attribute. A turn->message id link would remove this; see plan U3.
function mapTurnsToUserMessages(
  messages: TaskThreadMessage[],
  turns: TaskThreadTurn[],
): Map<string, TaskThreadTurn> {
  const map = new Map<string, TaskThreadTurn>();
  if (turns.length === 0) return map;

  const userMessages = messages.filter(
    (message) => message.role.toUpperCase() === "USER",
  );
  if (userMessages.length === 0) return map;

  const userTimes = userMessages.map((message) =>
    parseEventTimestamp(message.createdAt ?? null),
  );

  const sortedTurns = [...turns].sort((a, b) => {
    const ta = parseEventTimestamp(a.startedAt ?? null);
    const tb = parseEventTimestamp(b.startedAt ?? null);
    if (ta !== tb) return ta - tb;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });

  // Causal pairing needs user-message timestamps. Older/synthetic threads omit
  // createdAt; fall back to positional pairing (i-th turn -> i-th user message)
  // so they still render one disclosure per turn.
  const userTimesUsable = userTimes.some((time) => time > 0);
  if (!userTimesUsable) {
    const pairCount = Math.min(userMessages.length, sortedTurns.length);
    for (let i = 0; i < pairCount; i += 1) {
      map.set(userMessages[i].id, sortedTurns[i]);
    }
    if (sortedTurns.length > userMessages.length) {
      map.set(
        userMessages[userMessages.length - 1].id,
        sortedTurns[sortedTurns.length - 1],
      );
    }
    return map;
  }

  for (const turn of sortedTurns) {
    const turnTime = parseEventTimestamp(turn.startedAt ?? null);
    // Nearest-preceding user message: the last one (in chronological/document
    // order) created at or before this turn started.
    let targetIndex =
      turn.id === "optimistic-computer-turn" ? userMessages.length - 1 : -1;
    if (targetIndex < 0) {
      for (let i = 0; i < userMessages.length; i += 1) {
        if (userTimes[i] <= turnTime) targetIndex = i;
      }
    }
    // A turn before every user message anchors to the earliest one.
    if (targetIndex < 0) targetIndex = 0;
    // Latest turn wins when several map to the same message.
    map.set(
      userMessages[targetIndex].id,
      withUserVisibleTurnTiming(turn, userMessages[targetIndex], messages),
    );
  }

  return map;
}

function withUserVisibleTurnTiming(
  turn: TaskThreadTurn,
  userMessage: TaskThreadMessage,
  messages: TaskThreadMessage[],
): TaskThreadTurn {
  const userIndex = messages.findIndex(
    (message) => message.id === userMessage.id,
  );
  if (userIndex < 0) return turn;

  const userTime = parseEventTimestamp(userMessage.createdAt ?? null);
  const turnTime = parseEventTimestamp(turn.startedAt ?? null);
  const displayStartedAt =
    userTime > 0 && (turnTime === 0 || turnTime >= userTime)
      ? userMessage.createdAt
      : turn.startedAt;
  const displayStartTime = parseEventTimestamp(displayStartedAt ?? null);
  const assistantMessage = messages
    .slice(userIndex + 1)
    .find((message) => message.role.toUpperCase() === "ASSISTANT");
  const assistantTime = parseEventTimestamp(
    assistantMessage?.createdAt ?? null,
  );
  const displayFinishedAt =
    assistantMessage?.createdAt && assistantTime >= displayStartTime
      ? assistantMessage.createdAt
      : turn.finishedAt;

  if (
    displayStartedAt === turn.startedAt &&
    displayFinishedAt === turn.finishedAt
  ) {
    return turn;
  }

  return {
    ...turn,
    displayStartedAt,
    displayFinishedAt,
  };
}

function withTurnResponseFallback(thread: TaskThread): TaskThreadMessage[] {
  const turns = thread.turns ?? [];
  if (turns.length === 0) return thread.messages;

  // The fallback exists for the brief window between a turn finishing and its
  // assistant message being persisted/refetched. We reconstruct a synthetic
  // response for EVERY completed turn whose user message has no durable
  // assistant reply yet, inserted directly after that user message — not just
  // the latest one tail-appended.
  //
  // Tail-appending only the latest completed turn used to drop an earlier
  // turn's still-synthetic response the instant a new follow-up user message
  // arrived (e.g. an optimistic send): the earlier response, never durable,
  // simply vanished until the new turn finished, flashing the transcript. The
  // per-turn / position-aware reconstruction below keeps prior responses
  // anchored to their own user message across new turns. The
  // "no durable assistant before the next user message" guard still prevents a
  // phantom duplicate once the real assistant message has landed.
  const messages = thread.messages;
  const turnByUserMessageId = mapTurnsToUserMessages(messages, turns);
  if (turnByUserMessageId.size === 0) return messages;

  const result: TaskThreadMessage[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    result.push(message);
    if (message.role.toUpperCase() !== "USER") continue;

    const turn = turnByUserMessageId.get(message.id);
    if (!turn) continue;
    if (
      !["completed", "succeeded"].includes(
        String(turn.status ?? "").toLowerCase(),
      )
    ) {
      continue;
    }
    const response = stringValue(parseRecord(turn.resultJson).response);
    if (!response) continue;

    // Skip when a durable assistant message already follows this user message
    // (before the next user message) — the real reply landed, so synthesizing
    // would duplicate it.
    let nextUserIndex = messages.length;
    for (let j = i + 1; j < messages.length; j += 1) {
      if (messages[j].role.toUpperCase() === "USER") {
        nextUserIndex = j;
        break;
      }
    }
    const hasDurableAssistant = messages
      .slice(i + 1, nextUserIndex)
      .some((m) => m.role.toUpperCase() === "ASSISTANT");
    if (hasDurableAssistant) continue;

    result.push({
      id: `turn-${turn.id}-response`,
      role: "ASSISTANT",
      content: response,
      createdAt: turn.finishedAt,
      metadata: {
        source: "thread_turn_result",
        turnId: turn.id,
      },
    });
  }
  return result;
}

function hasAssistantAfterLatestUser(messages: TaskThreadMessage[]) {
  const latestUserIndex = findLastIndex(
    messages,
    (message) => message.role.toUpperCase() === "USER",
  );
  if (latestUserIndex < 0) return false;
  return messages
    .slice(latestUserIndex + 1)
    .some((message) => message.role.toUpperCase() === "ASSISTANT");
}

function resumeGoalRunFromThread(
  onSendFollowUp: NonNullable<TaskThreadViewProps["onSendFollowUp"]>,
  goalRun: GoalRunEvidence,
) {
  const content = goalRun.objective
    ? `Resume goal: ${goalRun.objective}`
    : "Resume goal";
  return onSendFollowUp(content, [], [], true, undefined, undefined, {
    enabled: true,
    action: "resume",
    ...(goalRun.objective ? { objective: goalRun.objective } : {}),
    ...(goalRun.goalId ? { goalRunId: goalRun.goalId } : {}),
  });
}

// 10 lines x leading-5 (20px) of the user bubble's text rhythm.
const COLLAPSE_MAX_HEIGHT_PX = 200;

function CollapsibleUserMessageBody({
  body,
  mentions,
  mentionTargets,
  skillCatalog,
}: {
  body: string;
  mentions?: TaskThreadMessage["mentions"];
  mentionTargets?: MentionTarget[];
  skillCatalog?: SkillOption[];
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const measure = () => {
      setIsOverflowing(el.scrollHeight > COLLAPSE_MAX_HEIGHT_PX);
    };

    measure();

    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [body]);

  if (!body) {
    return <>(No message content)</>;
  }

  const collapsed = !isExpanded && isOverflowing;

  return (
    <>
      <div
        ref={wrapperRef}
        data-testid="collapsible-user-body"
        data-collapsed={collapsed ? "true" : "false"}
        className={cn("relative", collapsed && "overflow-hidden")}
        style={collapsed ? { maxHeight: COLLAPSE_MAX_HEIGHT_PX } : undefined}
      >
        <InlineShortcutText
          text={body}
          mentions={mentions ?? []}
          mentionTargets={mentionTargets ?? []}
          skillCatalog={skillCatalog ?? []}
          fallbackAgentProfiles
          fallbackMentions
          fallbackSkills
        />
        {collapsed ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-muted to-transparent"
          />
        ) : null}
      </div>
      {isOverflowing ? (
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {isExpanded ? "Show less" : "Show more"}
          {isExpanded ? (
            <ChevronUp className="size-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4" aria-hidden="true" />
          )}
        </button>
      ) : null}
    </>
  );
}

function TranscriptMessage({
  message,
  threadId,
  onOpenArtifact,
  onSendFollowUp,
  isSending,
  threadAttachments,
  onDownloadAttachment,
  currentUser,
  mentionTargets,
  skillCatalog,
  onJsonRenderActionSuccess,
}: {
  message: TaskThreadMessage;
  threadId?: string;
  onOpenArtifact?: (artifactId: string) => void;
  onSendFollowUp?: (
    content: string,
    files?: File[],
    mentions?: ComposerMention[],
  ) => Promise<void> | void;
  isSending?: boolean;
  threadAttachments: ThreadInfoAttachment[];
  onDownloadAttachment?: (attachmentId: string) => void | Promise<void>;
  currentUser?: CurrentUserIdentity | null;
  mentionTargets?: MentionTarget[];
  skillCatalog?: SkillOption[];
  onJsonRenderActionSuccess?: JsonRenderActionSuccessHandler;
}) {
  const role = message.role.toUpperCase();
  const isUser = role === "USER";
  const isOwnMessage = isCurrentUserMessage(message, currentUser);
  const avatarKind = messageAvatarKind(message, isOwnMessage);
  const actions = actionRowsForMessage(message);
  const questionCards = !isUser ? questionCardsForMessage(message) : [];
  const body = message.content?.trim() ?? "";
  const attachments = isUser
    ? (message.optimisticAttachments ??
      resolveMessageAttachments({
        metadata: message.metadata,
        threadAttachments,
      }))
    : [];
  const typedParts = !isUser ? (message.parts ?? []) : [];
  const userQuestion = resolveUserQuestionRecord(message.userQuestion, {
    currentUser,
    mentionTargets,
  });
  const renderedTypedParts =
    typedParts.length > 0
      ? renderTypedParts(typedParts, {
          keyPrefix: message.id,
          sourceMessageId: message.id,
          threadId,
          userQuestion,
          onJsonRenderActionSuccess,
        }).filter(Boolean)
      : [];
  const transcriptContentClassName =
    "grid w-full grid-cols-[minmax(0,1fr)] gap-0.5 overflow-visible py-1";
  const userBubbleClassName =
    "rounded-2xl bg-muted/70 !px-3 !py-2 text-[15px] leading-5 text-foreground";
  const timestamp = formatMessageTimestamp(message.createdAt);
  const senderName = messageSenderName(message);

  return (
    <Message
      from={isOwnMessage ? "user" : "assistant"}
      className={isOwnMessage ? "my-1 max-w-[78%]" : "my-1 max-w-full"}
      data-message-role={isUser ? "user" : "assistant"}
    >
      <div
        className={cn(
          "min-w-0",
          isOwnMessage && "grid gap-1",
          avatarKind && "grid grid-cols-[2rem_minmax(0,1fr)] gap-3",
        )}
      >
        {avatarKind ? (
          <MessageSenderAvatar sender={message.sender} kind={avatarKind} />
        ) : null}
        {isOwnMessage && timestamp ? (
          <p className="justify-self-end pr-1 text-[11px] font-medium leading-none text-muted-foreground">
            {timestamp}
          </p>
        ) : null}
        <MessageContent
          className={
            isOwnMessage ? userBubbleClassName : transcriptContentClassName
          }
        >
          {isOwnMessage ? (
            <div className="grid min-w-0 gap-2">
              {body ? (
                <CollapsibleUserMessageBody
                  body={body}
                  mentions={message.mentions}
                  mentionTargets={mentionTargets}
                  skillCatalog={skillCatalog}
                />
              ) : null}
              {attachments.length > 0 ? (
                <MessageAttachmentList
                  attachments={attachments}
                  onDownloadAttachment={onDownloadAttachment}
                />
              ) : null}
              {!body && attachments.length === 0 ? (
                <>(No message content)</>
              ) : null}
            </div>
          ) : (
            <>
              <MessageByline name={senderName} timestamp={timestamp} />
              {actions.length > 0 ? (
                <div className="grid gap-2">
                  {actions.map((action) => (
                    <ActionRow
                      key={`${message.id}-${action.title}`}
                      {...action}
                    />
                  ))}
                </div>
              ) : null}
              {questionCards.length > 0 ? (
                <div className="grid gap-3">
                  {questionCards.map((card) => (
                    <QuestionCard
                      key={`${message.id}-${card.id}`}
                      card={card}
                      disabled={!onSendFollowUp || isSending}
                      onSubmit={(content) => onSendFollowUp?.(content, [], [])}
                    />
                  ))}
                </div>
              ) : null}
              {renderedTypedParts.length > 0 ? (
                <div className="mt-2 grid min-w-0 gap-2">
                  {renderedTypedParts}
                </div>
              ) : body ? (
                <Response className="prose-invert text-sm leading-5 text-foreground prose-p:my-1.5 prose-p:leading-5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-li:leading-5 prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold prose-strong:font-semibold prose-hr:my-3">
                  {body}
                </Response>
              ) : (
                <p className="text-sm leading-5 text-foreground">
                  (No message content)
                </p>
              )}
              {attachments.length > 0 ? (
                <MessageAttachmentList
                  attachments={attachments}
                  onDownloadAttachment={onDownloadAttachment}
                />
              ) : null}
              {!isUser && message.durableArtifact ? (
                <GeneratedArtifactCard
                  artifact={message.durableArtifact}
                  onOpenArtifact={onOpenArtifact}
                />
              ) : null}
            </>
          )}
        </MessageContent>
      </div>
    </Message>
  );
}

function MessageByline({
  name,
  timestamp,
}: {
  name: string;
  timestamp: string | null;
}) {
  return (
    <p className="text-xs leading-none text-muted-foreground">
      <span className="font-semibold text-muted-foreground">{name}</span>
      {timestamp ? <span className="ml-1">{timestamp}</span> : null}
    </p>
  );
}

function MessageSenderAvatar({
  sender,
  kind,
}: {
  sender?: TaskThreadMessageSender | null;
  kind: "agent" | "user";
}) {
  const name = sender?.displayName?.trim() || "Agent";
  const initials = initialsForName(name);

  return (
    <div
      aria-label={`${name} message`}
      data-testid={`message-avatar-${kind}`}
      className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.06] text-[11px] font-semibold text-white/65"
    >
      {kind === "agent" ? (
        <Bot className="size-4 text-[#54a9ff]" aria-hidden="true" />
      ) : sender?.avatarUrl ? (
        <img
          src={sender.avatarUrl}
          alt=""
          className="size-full object-cover"
          draggable={false}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </div>
  );
}

function messageAvatarKind(
  message: TaskThreadMessage,
  isOwnMessage: boolean,
): "agent" | "user" | null {
  if (isOwnMessage) return null;
  const role = message.role.toUpperCase();
  if (role !== "USER") return "agent";
  return message.sender ? "user" : null;
}

function messageSenderName(message: TaskThreadMessage) {
  const fallback = message.role.toUpperCase() === "USER" ? "User" : "Agent";
  return message.sender?.displayName?.trim() || fallback;
}

function isCurrentUserMessage(
  message: TaskThreadMessage,
  currentUser?: CurrentUserIdentity | null,
) {
  if (message.role.toUpperCase() !== "USER") return false;
  const sender = message.sender;
  if (!sender) return true;

  const senderType = sender.type?.trim().toLowerCase();
  if (!senderType && !sender.id) return true;
  if (senderType && senderType !== "user") return false;

  if (sameIdentity(sender.id, currentUser?.id)) return true;
  return false;
}

function sameIdentity(left?: string | null, right?: string | null) {
  return Boolean(left?.trim() && right?.trim() && left.trim() === right.trim());
}

function initialsForName(name: string) {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatMessageTimestamp(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return null;

  const diffMs = Date.now() - time;
  if (diffMs >= 0 && diffMs < 86_400_000) {
    const minutes = Math.max(1, Math.floor(diffMs / 60_000));
    if (minutes < 60) return `${minutes} min ago`;
    return `${Math.floor(minutes / 60)} hr ago`;
  }

  const hours = date.getHours();
  const hour12 = hours % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, "0");
  const meridiem = hours < 12 ? "am" : "pm";
  return `${date.getMonth() + 1}/${date.getDate()} ${hour12}:${minute} ${meridiem}`;
}

function MessageAttachmentList({
  attachments,
  onDownloadAttachment,
}: {
  attachments: MessageAttachmentDisplay[];
  onDownloadAttachment?: (attachmentId: string) => void | Promise<void>;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {attachments.map((attachment) => (
        <button
          key={attachment.id}
          type="button"
          aria-label={`Download ${attachment.label}`}
          disabled={!onDownloadAttachment}
          className="inline-flex min-h-9 max-w-full min-w-0 items-center gap-2 rounded-full border border-border/70 bg-background/45 px-3 py-1.5 text-sm text-foreground/90 transition-colors hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void onDownloadAttachment?.(attachment.id)}
        >
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{attachment.label}</span>
          {attachment.sizeBytes ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatFileSize(attachment.sizeBytes)}
            </span>
          ) : null}
          <Download className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}

export function normalizePersistedParts(
  value: unknown,
  toolResults?: unknown,
): AccumulatedPart[] {
  const rawParts = parseArray(value);
  const parts: AccumulatedPart[] = [];
  for (const rawPart of rawParts) {
    const record = parseRecord(rawPart);
    const type = stringValue(record.type);
    if (!type) continue;
    if (type === "text") {
      parts.push({
        type: "text",
        id: stringValue(record.id) ?? `text-${parts.length}`,
        text: typeof record.text === "string" ? record.text : "",
        state: "done",
      });
      continue;
    }
    if (type === "reasoning") {
      parts.push({
        type: "reasoning",
        id: stringValue(record.id) ?? `reasoning-${parts.length}`,
        text: typeof record.text === "string" ? record.text : "",
        state: "done",
      });
      continue;
    }
    if (type.startsWith("data-")) {
      // Some producers (e.g. the user-question intake) persist their fields
      // flat on the part with no `data` envelope. Fold the extra fields into
      // `data` so renderers see one shape.
      const { type: _type, id: _id, data, ...rest } = record;
      parts.push({
        type: type as `data-${string}`,
        id: stringValue(record.id) ?? undefined,
        data:
          data !== undefined && data !== null
            ? data
            : Object.keys(rest).length > 0
              ? rest
              : undefined,
      });
    }
  }
  return [...parts, ...mcpAppPartsFromToolResults(toolResults, parts.length)];
}

function mcpAppPartsFromToolResults(
  value: unknown,
  startIndex: number,
): AccumulatedPart[] {
  const parts: AccumulatedPart[] = [];
  for (const result of parseArray(value)) {
    for (const app of mcpAppsFromToolResult(result)) {
      parts.push({
        type: "data-mcp-app",
        id: `mcp-app:${sanitizePartId(app.uri)}:${startIndex + parts.length}`,
        data: app,
      });
    }
  }
  return parts;
}

function mcpAppsFromToolResult(value: unknown): McpAppData[] {
  const record = parseRecord(value);
  const directApps = mcpAppsFromDetails(parseRecord(record.details));
  if (directApps.length > 0) return directApps;

  const result = parseRecord(record.result);
  const resultApps = mcpAppsFromDetails(parseRecord(result.details));
  if (resultApps.length > 0) return resultApps;

  return [
    ...mcpAppsFromRawMcpResponse(parseRecord(record.raw)),
    ...mcpAppsFromRawMcpResponse(parseRecord(result.raw)),
  ];
}

function mcpAppsFromDetails(details: Record<string, unknown>): McpAppData[] {
  const declaredApps = parseArray(details.mcp_apps)
    .map((app) => {
      const record = parseRecord(app);
      const uri = stringValue(record.uri);
      const html = stringValue(record.html);
      const mimeType = stringValue(record.mimeType);
      if (!uri || !html || mimeType !== "text/html") return null;
      return mcpAppData({
        uri,
        html,
        title: stringValue(record.title),
        serverName: stringValue(record.serverName),
        toolName: stringValue(record.toolName),
      });
    })
    .filter((app): app is McpAppData => app !== null);
  if (declaredApps.length > 0) return declaredApps;
  return mcpAppsFromRawMcpResponse(parseRecord(details.raw));
}

function mcpAppsFromRawMcpResponse(raw: Record<string, unknown>): McpAppData[] {
  return parseArray(raw.content)
    .map((item) => {
      const record = parseRecord(item);
      const resource = parseRecord(record.resource);
      const candidate = Object.keys(resource).length > 0 ? resource : record;
      const uri = stringValue(candidate.uri);
      const html = stringValue(candidate.text);
      const mimeType = stringValue(candidate.mimeType);
      if (!uri || !html || mimeType !== "text/html") return null;
      return mcpAppData({
        uri,
        html,
        title: titleFromHtml(html),
      });
    })
    .filter((app): app is McpAppData => app !== null);
}

type McpAppData = Record<string, unknown> & {
  uri: string;
  html: string;
  mimeType: "text/html";
};

function mcpAppData(input: {
  uri: string;
  html: string;
  title?: string | null;
  serverName?: string | null;
  toolName?: string | null;
}): McpAppData {
  return {
    schemaVersion: "thinkwork-mcp-app/v1",
    status: "ready",
    uri: input.uri,
    mimeType: "text/html",
    html: input.html,
    ...(input.title ? { title: input.title } : {}),
    ...(input.serverName ? { serverName: input.serverName } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
  };
}

function titleFromHtml(html: string): string | null {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
}

function sanitizePartId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64);
}

/**
 * Simple paperclip-icon trigger that opens the native file picker via the
 * PromptInput's attachments context. Replaces the upstream
 * `PromptInputActionAddAttachments` (which is a `DropdownMenuItem` that
 * requires an enclosing menu we don't render here). The PromptInputAttachments
 * row above the textarea renders the chip list once files are added.
 */
function PromptInputAttachButton() {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      type="button"
      variant="ghost"
      onClick={() => attachments.openFileDialog()}
      aria-label="Attach file"
      title="Attach file"
      className="text-white hover:bg-white/10"
    >
      <IconPaperclip stroke={2} className="h-4 w-4" />
    </PromptInputButton>
  );
}

function FollowUpComposer({
  threadId,
  taskQueue,
  disabled,
  isSending,
  mentionTargets,
  skillCatalog = [],
  threadMessages,
  currentUserId,
  prefill,
  onSubmit,
  approvedModels,
  selectedModelId,
  onSelectedModelChange,
}: {
  threadId: string;
  taskQueue?: ActiveTaskQueue | null;
  disabled?: boolean;
  isSending?: boolean;
  mentionTargets: MentionTarget[];
  skillCatalog?: SkillOption[];
  threadMessages?: TaskThreadMessage[];
  currentUserId?: string | null;
  prefill?: { text: string; token: number } | null;
  onSubmit?: (
    content: string,
    files?: File[],
    mentions?: ComposerMention[],
    agentRequested?: boolean,
    pinnedSkills?: string[],
    selectedModelId?: string,
    goalMode?: ComposerGoalModeIntent,
  ) => Promise<void> | void;
  approvedModels?: ApprovedModelOption[];
  selectedModelId?: string | null;
  onSelectedModelChange?: (modelId: string) => void;
}) {
  const composer = useComposerState(null);
  const textareaRef = useRef<SkillTokenInputHandle | null>(null);
  const [mentions, setMentions] = useState<ComposerMention[]>([]);
  const agentDefaultOn = useMemo(
    () =>
      deriveAgentDefault({
        currentUserId,
        threadMessages: (threadMessages ?? []).map((message) => ({
          role: message.role,
          senderType: message.sender?.type ?? null,
          senderId: message.sender?.id ?? null,
        })),
        draftMentions: mentions.map((mention) => ({
          targetType: mention.targetType,
          targetId: mention.targetId,
        })),
      }).agentDefaultOn,
    [currentUserId, threadMessages, mentions],
  );
  const [agentEnabled, setAgentEnabled] = useState(agentDefaultOn);
  // Whether the user has manually toggled the agent in this thread. While
  // false, the toggle tracks the derived default; once true, the manual choice
  // persists until the thread changes (which clears it).
  const agentOverriddenRef = useRef(false);
  const [goalModeEnabled, setGoalModeEnabled] = useState(false);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const prefillText = prefill?.text;
  const prefillToken = prefill?.token;
  const mentionQuery = useMemo(
    () => currentMentionQuery(composer.text),
    [composer.text],
  );
  const mentionOptions = useMemo(
    () =>
      mentionQuery === null
        ? []
        : filterMentionTargets(mentionTargets, mentionQuery.query, {
            includeDefaultAgentShortcut: true,
            targetTypes:
              mentionQuery.trigger === "#"
                ? ["AGENT_PROFILE"]
                : ["USER", "AGENT"],
          }),
    [mentionQuery, mentionTargets],
  );
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  // Escape dismisses the mention menu without committing. Because mentionQuery
  // is derived from the composer text (not state we can clear), we suppress the
  // menu with a flag that resets whenever the query changes.
  const [mentionMenuDismissed, setMentionMenuDismissed] = useState(false);
  const mentionMenuOpen =
    mentionQuery !== null && mentionOptions.length > 0 && !mentionMenuDismissed;
  const defaultAgentTarget = useMemo(
    () =>
      mentionTargets.find(
        (target) =>
          target.targetType === "AGENT" && target.isDefaultAgent === true,
      ) ?? null,
    [mentionTargets],
  );
  const agentForcedOn = useMemo(
    () =>
      hasDefaultAgentMentionAlias(composer.text) ||
      hasStructuredDefaultAgentMention(mentions, defaultAgentTarget),
    [composer.text, defaultAgentTarget, mentions],
  );
  const goalModeSubmission = useMemo(
    () => resolveStartGoalModeSubmission(composer.text, goalModeEnabled),
    [composer.text, goalModeEnabled],
  );
  const effectiveAgentEnabled = agentForcedOn || agentEnabled;
  const goalModeBlocked =
    goalModeSubmission.requested && !effectiveAgentEnabled;
  const skillPins = useComposerSkillPins({
    value: composer.text,
    onChange: composer.setText,
    catalog: skillCatalog,
    goalDisabled: !effectiveAgentEnabled,
  });
  const modelSelectionBlocked =
    approvedModels !== undefined &&
    (approvedModels.length === 0 || !selectedModelId);
  const canSubmit =
    (goalModeSubmission.content.length > 0 ||
      (composer.files.length > 0 && !goalModeSubmission.requested)) &&
    !disabled &&
    !isSending &&
    !modelSelectionBlocked &&
    !goalModeBlocked;

  useEffect(() => {
    if (agentForcedOn) setAgentEnabled(true);
  }, [agentForcedOn]);

  // Switching threads clears any manual override and re-derives the default.
  useEffect(() => {
    agentOverriddenRef.current = false;
    setAgentEnabled(agentDefaultOn);
    setGoalModeEnabled(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Track the derived default (single -> on, multiplayer -> off) as the draft
  // mentions or thread history change, until the user manually overrides; the
  // manual choice then persists within the thread.
  useEffect(() => {
    if (!agentOverriddenRef.current) setAgentEnabled(agentDefaultOn);
  }, [agentDefaultOn]);

  useEffect(() => {
    setActiveMentionIndex(0);
    setMentionMenuDismissed(false);
  }, [mentionQuery, mentionOptions.length]);

  useEffect(() => {
    if (!prefillText) return;
    composer.setText(prefillText);
    const focusPrefilledComposer = () => {
      // Focus through the editor handle (the contenteditable token field).
      textareaRef.current?.focus();
      const node = document.querySelector<HTMLElement>(
        '[aria-label="Follow up"]',
      );
      if (!node) return document.activeElement != null;
      // Place the caret at the end of the contenteditable token field.
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return document.activeElement === node;
    };
    const timeoutIds: number[] = [];
    const scheduleTimeout = (delay: number) => {
      const timeoutId = window.setTimeout(focusPrefilledComposer, delay);
      timeoutIds.push(timeoutId);
    };
    const animationFrameId = window.requestAnimationFrame(() => {
      if (!focusPrefilledComposer()) {
        scheduleTimeout(0);
        scheduleTimeout(75);
      }
    });
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [prefillText, prefillToken]);

  // Plan-012 U13: in-thread composer migrated to AI Elements
  // <PromptInput>. Shares useComposerState with the empty-thread
  // composer; submit semantics unchanged. The composer never invokes
  // the turn-start mutation directly (single-submit invariant, P0) —
  // the route's onSendFollowUp is the sole owner of the call.
  //
  // U1 of finance pilot (2026-05-14-002): the composer now forwards
  // attached files alongside text. The route's onSendFollowUp is
  // responsible for uploading them via the U2 presign + finalize
  // endpoints and including the resulting attachmentId references in
  // the sendMessage metadata.
  async function handlePromptSubmit(message: PromptInputMessage) {
    if (!canSubmit || !onSubmit) return;
    composer.setError(null);
    composer.setSubmitting(true);
    try {
      if (goalModeSubmission.requested && !goalModeSubmission.goalMode) {
        throw new Error("Goal mode needs an objective.");
      }
      if (goalModeBlocked) {
        throw new Error("Turn on agent handling to use Goal.");
      }
      // PromptInput emits FileUIPart entries with blob URLs. Fetch the
      // blob and rebuild File objects so the route's upload helper can
      // POST the bytes through presign + PUT + finalize.
      const files = await fileUiPartsToFiles(message.files);
      const content = goalModeSubmission.content;
      const submittedMentions = mentions.filter((mention) =>
        content.includes(mention.rawText),
      );
      const pinnedSkills = extractPinnedSkillSlugs(content, skillCatalog);
      const submittedGoalMode = goalModeSubmission.goalMode;
      if (selectedModelId && submittedGoalMode) {
        await onSubmit(
          content,
          files,
          submittedMentions,
          true,
          pinnedSkills,
          selectedModelId,
          submittedGoalMode,
        );
      } else if (selectedModelId) {
        await onSubmit(
          content,
          files,
          submittedMentions,
          effectiveAgentEnabled,
          pinnedSkills,
          selectedModelId,
        );
      } else if (submittedGoalMode) {
        await onSubmit(
          content,
          files,
          submittedMentions,
          true,
          pinnedSkills,
          undefined,
          submittedGoalMode,
        );
      } else {
        await onSubmit(
          content,
          files,
          submittedMentions,
          effectiveAgentEnabled,
          pinnedSkills,
        );
      }
      composer.clear();
      setMentions([]);
      setGoalModeEnabled(false);
    } catch (err) {
      composer.setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      composer.setSubmitting(false);
    }
  }

  const hasTaskQueue = Boolean(taskQueue);
  const agentToggleTitle = agentForcedOn
    ? "Agent handling is required by @agent or @think"
    : goalModeSubmission.requested
      ? "Goal mode requires agent handling"
      : effectiveAgentEnabled
        ? "Agent will respond"
        : "Send without waking the agent";

  function selectMention(target: MentionTarget) {
    const trigger = target.targetType === "AGENT_PROFILE" ? "#" : "@";
    const replacement = `${trigger}${target.displayName} `;
    const query = mentionQuery?.query ?? "";
    const prefix = composer.text.slice(
      0,
      composer.text.length - query.length - 1,
    );
    composer.setText(`${prefix}${replacement}`);
    setMentions((current) => [
      ...current.filter(
        (mention) =>
          !(
            mention.targetType === target.targetType &&
            mention.targetId === target.targetId
          ),
      ),
      {
        targetType: target.targetType,
        targetId: target.targetId,
        displayName: target.displayName,
        rawText: replacement.trim(),
      },
    ]);
    if (target.targetType === "AGENT" && target.isDefaultAgent) {
      setAgentEnabled(true);
    }
  }

  function applyGoalObjective(objective: string) {
    composer.setText(`/goal ${objective}`);
    setGoalModeEnabled(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLElement>) {
    // `@` and `/` menus are mutually exclusive. When the mention menu isn't
    // open, hand navigation to the skill-pin menu.
    if (!mentionMenuOpen) {
      skillPins.handleKeyDown(event);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveMentionIndex((index) => (index + 1) % mentionOptions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveMentionIndex(
        (index) => (index - 1 + mentionOptions.length) % mentionOptions.length,
      );
      return;
    }
    // Tab and Enter both commit the highlighted mention.
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const target =
        mentionOptions[
          Math.min(activeMentionIndex, Math.max(mentionOptions.length - 1, 0))
        ];
      if (target) selectMention(target);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setMentionMenuDismissed(true);
    }
  }

  return (
    <div
      className={cn(
        "grid gap-2",
        hasTaskQueue &&
          "tw-composer-shell overflow-hidden rounded-[28px] border border-white/10 text-white shadow-lg",
      )}
    >
      {taskQueue ? (
        <PromptTaskQueue key={taskQueue.id} queue={taskQueue.data} />
      ) : null}
      <div className="relative">
        {mentionMenuOpen ? (
          <MentionMenu
            targets={mentionOptions}
            query={mentionQuery?.query ?? ""}
            activeIndex={activeMentionIndex}
            includeDefaultAgentShortcut
            onSelect={selectMention}
          />
        ) : null}
        {!mentionMenuOpen && skillPins.menuOpen ? (
          <SkillMenu
            options={skillPins.options}
            query={skillPins.slashQuery ?? ""}
            activeIndex={skillPins.activeIndex}
            placement="top"
            onSelect={skillPins.selectSkill}
          />
        ) : null}
        <PromptInput
          className={cn(
            "tw-composer-surface text-white motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:zoom-in-95 [&_[data-slot=input-group]]:min-h-14 [&_[data-slot=input-group]]:border-white/10 [&_[data-slot=input-group]]:px-2 [&_[data-slot=input-group]]:!ring-0 [&_[data-slot=input-group]]:focus-within:border-white/10",
            hasTaskQueue
              ? "[&_[data-slot=input-group]]:rounded-none [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:shadow-none"
              : "[&_[data-slot=input-group]]:rounded-3xl [&_[data-slot=input-group]]:shadow-lg",
          )}
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          maxFiles={5}
          maxFileSize={25 * 1024 * 1024}
          multiple
          onError={(err) => composer.setError(err.message)}
          onSubmit={handlePromptSubmit}
        >
          <PromptInputBody>
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
            <SkillTokenInput
              ref={textareaRef}
              aria-label="Follow up"
              className="min-h-12 max-h-24 py-3 text-base text-white placeholder:text-white/75"
              value={composer.text}
              onChange={composer.setText}
              catalog={skillCatalog}
              mentions={mentions}
              onKeyDown={handleComposerKeyDown}
              placeholder="Type @ to mention people, # for agent profiles, or / to use a skill"
              disabled={disabled}
            />
          </PromptInputBody>
          <PromptInputFooter className="px-2 pb-2">
            <PromptInputTools>
              <PromptInputAttachButton />
            </PromptInputTools>
            <div
              className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1"
              data-testid="follow-up-action-controls"
            >
              <button
                type="button"
                onClick={() => {
                  if (!agentForcedOn) {
                    agentOverriddenRef.current = true;
                    setAgentEnabled((value) => !value);
                  }
                }}
                aria-label="Send to agent"
                aria-pressed={effectiveAgentEnabled}
                title={agentToggleTitle}
                disabled={disabled || isSending || agentForcedOn}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg text-white/60 transition-opacity hover:opacity-80 disabled:pointer-events-none disabled:opacity-80",
                  effectiveAgentEnabled && "text-[#54a9ff]",
                )}
              >
                <Bot className="size-5" />
              </button>
              <GoalModeToggle
                enabled={goalModeSubmission.requested && effectiveAgentEnabled}
                objective={goalModeSubmission.content}
                disabled={disabled || isSending || !effectiveAgentEnabled}
                tone="dark"
                onClick={() => setGoalDialogOpen(true)}
              />
              <ComposerModelPicker
                models={approvedModels}
                value={selectedModelId}
                onValueChange={onSelectedModelChange}
                disabled={disabled || isSending || !effectiveAgentEnabled}
                tone="dark"
              />
              <PromptInputSpeechButton
                textareaRef={
                  textareaRef as React.RefObject<HTMLTextAreaElement | null>
                }
                onTranscriptionChange={composer.setText}
                aria-label="Voice input"
                title="Voice input"
                className="text-white/60 hover:bg-white/10"
                disabled={disabled || isSending}
              />
              <PromptInputSubmit
                className="shrink-0 rounded-full bg-zinc-100 text-zinc-950 hover:bg-white disabled:bg-zinc-500 disabled:text-zinc-200"
                disabled={!canSubmit}
                status={isSending ? "submitted" : undefined}
                aria-label={isSending ? "Sending" : "Send"}
              />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
      {composer.error ? (
        <p className="text-sm text-destructive">{composer.error}</p>
      ) : null}
      <GoalModeDialog
        open={goalDialogOpen}
        initialObjective={
          goalModeSubmission.content ||
          (composer.text.startsWith("/") ? "" : composer.text)
        }
        onOpenChange={setGoalDialogOpen}
        onSubmit={applyGoalObjective}
      />
    </div>
  );
}

function currentMentionQuery(
  content: string,
): { trigger: "@" | "#"; query: string } | null {
  const match = content.match(/(?:^|\s)([@#])([\w.'-]*)$/u);
  return match
    ? { trigger: match[1] as "@" | "#", query: match[2] ?? "" }
    : null;
}

function hasStructuredDefaultAgentMention(
  mentions: ComposerMention[],
  defaultAgentTarget: MentionTarget | null,
) {
  if (!defaultAgentTarget) return false;
  return mentions.some(
    (mention) =>
      mention.targetType === "AGENT" &&
      mention.targetId === defaultAgentTarget.targetId,
  );
}

function hasDefaultAgentMentionAlias(content: string) {
  return /(^|[\s([{"'])@(agent|think)(?=$|[^\p{L}\p{N}_-])/iu.test(content);
}

function PromptTaskQueue({ queue }: { queue: TaskQueueData }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);
  const title = stringValue(queue.title) ?? "Task queue";
  const status = statusLabel(normalizeTaskQueueStatus(queue.status));
  const counts = countTaskQueueItems(queue);
  const panelId = `task-prompt-queue-${queue.queueId ?? "active"}`;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open]);

  return (
    <section
      ref={containerRef}
      className="overflow-hidden border-b border-white/10 bg-[#262626] text-white"
      aria-label="Active task queue"
    >
      <div className="flex min-h-10 items-center gap-3 px-4 py-1.5">
        <ListChecks aria-hidden className="size-4 shrink-0 text-sky-300" />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <p className="truncate text-xs font-medium text-white">{title}</p>
          <p className="shrink-0 truncate text-[11px] text-white/60">
            {queueSummary(counts)}
          </p>
        </div>
        <span className="hidden shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] capitalize text-white/70 sm:inline-flex">
          {status}
        </span>
        <button
          type="button"
          className="shrink-0 text-xs font-medium text-sky-300 transition-colors hover:text-sky-200"
          aria-label={open ? "Collapse task queue" : "Expand task queue"}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide tasks" : "Review tasks"}
        </button>
      </div>
      {open ? (
        <div
          id={panelId}
          className="max-h-[34vh] overflow-y-auto border-t border-white/10 p-3"
        >
          <TaskQueue
            data={queue}
            compact
            className="border-white/10 bg-black/20 text-white"
          />
        </div>
      ) : null}
    </section>
  );
}

interface ActiveTaskQueue {
  id: string;
  data: TaskQueueData;
  source: "persisted" | "run" | "stream";
}

function selectPromptTaskQueue(
  messages: TaskThreadMessage[],
  runbookQueues: RunbookQueueData[],
  streamParts: AccumulatedPart[],
): ActiveTaskQueue | null {
  const queues: ActiveTaskQueue[] = [];

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const queue = activeQueueFromPart(part, "persisted");
      if (queue) queues.push(queue);
    }
  }

  for (const data of runbookQueues) {
    const taskQueue = taskQueueFromRunbookQueue(data);
    const id =
      stringValue(taskQueue.queueId) ??
      stringValue(data.runbookSlug) ??
      `runbook-${queues.length}`;
    queues.push({ id, data: taskQueue, source: "run" });
  }

  for (const part of streamParts) {
    const queue = activeQueueFromPart(part, "stream");
    if (queue) queues.push(queue);
  }

  const terminalRunQueueById = new Map<string, ActiveTaskQueue>();
  for (const queue of queues) {
    if (queue.source !== "run") continue;
    if (!isTerminalTaskQueueStatus(queue.data.status)) continue;
    terminalRunQueueById.set(taskQueueIdentity(queue), queue);
  }

  for (let index = queues.length - 1; index >= 0; index -= 1) {
    const queue = queues[index];
    const terminalRunQueue = terminalRunQueueById.get(taskQueueIdentity(queue));
    if (terminalRunQueue && queue.source !== "run") {
      continue;
    }
    if (isPromptWorthyTaskQueue(queue)) return queue;
  }

  return null;
}

function activeQueueFromPart(
  part: AccumulatedPart,
  source: ActiveTaskQueue["source"],
): ActiveTaskQueue | null {
  if (part.type !== "data-task-queue" && part.type !== "data-runbook-queue") {
    return null;
  }
  const record = parseRecord(part.data);
  const data =
    part.type === "data-runbook-queue"
      ? taskQueueFromRunbookQueue(record as RunbookQueueData)
      : (record as TaskQueueData);
  const id = stringValue(data.queueId) ?? stringValue(part.id) ?? "active";
  return { id, data, source };
}

const HIDDEN_PROMPT_QUEUE_STATUSES = new Set(["rejected"]);

function isPromptWorthyTaskQueue(queue: ActiveTaskQueue) {
  const status = normalizeTaskQueueStatus(queue.data.status);
  if (status === "completed" && queue.source === "persisted") return false;
  return !HIDDEN_PROMPT_QUEUE_STATUSES.has(status);
}

function taskQueueIdentity(queue: ActiveTaskQueue) {
  return (
    stringValue(queue.data.queueId) ??
    stringValue(queue.data.source?.id) ??
    stringValue(queue.data.source?.slug) ??
    queue.id
  );
}

function isTerminalTaskQueueStatus(status: unknown) {
  return ["completed", "failed", "error", "cancelled"].includes(
    normalizeTaskQueueStatus(status),
  );
}

function countTaskQueueItems(queue: TaskQueueData) {
  let total = 0;
  let completed = 0;
  let running = 0;
  let failed = 0;
  let pending = 0;
  for (const item of taskQueueItems(queue)) {
    total += 1;
    const status = normalizeTaskQueueStatus(item.status);
    if (status === "completed") {
      completed += 1;
    } else if (status === "running" || status === "in-progress") {
      running += 1;
    } else if (status === "failed" || status === "error") {
      failed += 1;
    } else {
      pending += 1;
    }
  }
  return { total, completed, running, failed, pending };
}

function taskQueueItems(queue: TaskQueueData): TaskQueueItem[] {
  const grouped = taskQueueGroups(queue).flatMap((group) => group.items ?? []);
  if (grouped.length > 0) return grouped;
  return Array.isArray(queue.items) ? queue.items : [];
}

function taskQueueGroups(queue: TaskQueueData): TaskQueueGroup[] {
  if (Array.isArray(queue.groups) && queue.groups.length > 0) {
    return queue.groups;
  }
  if (Array.isArray(queue.items) && queue.items.length > 0) {
    return [{ id: "tasks", title: "Tasks", items: queue.items }];
  }
  return [];
}

function queueSummary(counts: ReturnType<typeof countTaskQueueItems>) {
  if (counts.total === 0) return "Preparing tasks";
  const taskLabel = counts.total === 1 ? "task" : "tasks";
  const segments = [`${counts.total} ${taskLabel}`];
  if (counts.completed > 0) segments.push(`${counts.completed} completed`);
  if (counts.running > 0) segments.push(`${counts.running} running`);
  if (counts.failed > 0) segments.push(`${counts.failed} failed`);
  if (counts.pending > 0) segments.push(`${counts.pending} pending`);
  return segments.join(" · ");
}

function normalizeTaskQueueStatus(value: unknown) {
  const raw = stringValue(value)?.toLowerCase().replace(/_/g, "-") ?? "";
  return raw || "pending";
}

function statusLabel(status: string) {
  if (!status) return "Pending";
  return status.replace(/-/g, " ");
}

const SHIMMER_CHAR_DURATION_MS = 120;

/**
 * Per-character shimmer matching the "Loading…" page-load treatment
 * (`tw-shimmer-char`). Used for the running "Working…" header. No role/live
 * wrapper of its own — the caller owns the `role="status"` region.
 */
function ShimmerText({ text }: { text: string }) {
  return (
    <span aria-hidden="true">
      {text.split("").map((char, index) => (
        <span
          className="tw-shimmer-char"
          key={`${char}-${index}`}
          style={{ animationDelay: `${index * SHIMMER_CHAR_DURATION_MS}ms` }}
        >
          {char}
        </span>
      ))}
    </span>
  );
}

function ThinkingRow({
  title,
  usageLabel,
  costLabel,
  running = false,
  elapsedLabel,
  defaultOpen = false,
  detail,
  ariaLabel,
  children,
}: {
  title: string;
  usageLabel?: string | null;
  costLabel?: string | null;
  /** Render the header in shimmer style and announce it via a live region. */
  running?: boolean;
  /** Live elapsed-time string shown next to a running header (aria-hidden). */
  elapsedLabel?: string | null;
  defaultOpen?: boolean;
  detail?: string;
  ariaLabel?: string;
  children?: ReactNode;
}) {
  // React.Children.toArray + filter Boolean handles arrays containing empty
  // arrays (truthy in plain JS) and falsy nodes correctly; a bare children.some
  // would render an empty container when rows=[] because Boolean([]) is true.
  const hasChildren = Children.toArray(children).some(Boolean);
  // Codex-style consolidated header (no brain icon, no "Thinking" label):
  // "Working…" shimmer while running, "Worked for Xm Ys" collapsed when done.
  // Built on the AI Elements Reasoning primitive so it shares the same
  // collapsible substrate as typed reasoning parts.
  return (
    <Reasoning
      defaultOpen={defaultOpen}
      className="mb-0 min-w-0 max-w-full text-muted-foreground"
      aria-label={ariaLabel}
    >
      <ReasoningTrigger
        aria-label={title}
        className="group gap-2 text-sm"
        icon={null}
        getThinkingMessage={() => (
          <span
            className="flex items-center gap-2"
            role="status"
            aria-live="polite"
          >
            {running ? (
              <>
                <ShimmerText text={title} />
                <span className="sr-only">{title}</span>
              </>
            ) : (
              <span>{title}</span>
            )}
            {!running && (usageLabel || costLabel) ? (
              <span className="relative top-px inline-flex items-center gap-1 text-[13px] leading-none text-muted-foreground transition-colors group-hover:text-foreground">
                {usageLabel ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{usageLabel}</span>
                  </>
                ) : null}
                {costLabel ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{costLabel}</span>
                  </>
                ) : null}
              </span>
            ) : null}
            {running && elapsedLabel ? (
              <span
                aria-hidden="true"
                className="font-mono text-sm text-muted-foreground/60"
              >
                {elapsedLabel}
              </span>
            ) : null}
          </span>
        )}
      />
      {detail || hasChildren ? (
        <ReasoningContent className="ml-6 mt-2 min-w-0 max-w-full text-sm leading-6 text-muted-foreground">
          {detail ? <p className="max-w-xl">{detail}</p> : null}
          {hasChildren ? (
            <div className="mt-3 grid min-w-0 max-w-full gap-2">{children}</div>
          ) : null}
        </ReasoningContent>
      ) : null}
    </Reasoning>
  );
}

function ActionRow({
  title,
  detail,
  content,
  kind,
  hideIcon = false,
  childrenRows = [],
}: {
  title: string;
  detail?: string;
  content?: ReactNode;
  kind: "thinking" | "tool" | "source" | "code";
  hideIcon?: boolean;
  childrenRows?: ActionRowData[];
}) {
  const Icon =
    kind === "source"
      ? Database
      : kind === "code"
        ? Code2
        : kind === "tool"
          ? Sparkles
          : Bot;
  return (
    <details className="group/action w-full min-w-0 max-w-full text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-sm transition-colors hover:text-foreground">
        {hideIcon ? null : <Icon className="size-4" />}
        {title}
        <ChevronRight className="size-4 transition-transform group-open/action:rotate-90" />
      </summary>
      {detail ? (
        <pre className="ml-7 mt-2 max-w-[calc(100%-1.75rem)] whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          {detail}
        </pre>
      ) : null}
      {content ? (
        <div className="ml-7 mt-2 max-w-[calc(100%-1.75rem)] min-w-0">
          {content}
        </div>
      ) : null}
      {childrenRows.length > 0 ? (
        <div className="ml-7 mt-2 grid min-w-0 max-w-[calc(100%-1.75rem)] gap-2 border-l border-white/10 pl-3">
          {childrenRows.map((child, index) => (
            <ActionRow
              key={`${title}-child-${index}-${child.title}`}
              title={child.title}
              detail={child.detail}
              content={child.content}
              kind={child.kind}
              hideIcon={child.hideIcon}
              childrenRows={child.children}
            />
          ))}
        </div>
      ) : null}
    </details>
  );
}

interface QuestionCardPayload {
  id: string;
  title: string;
  fields: QuestionCardField[];
}

interface QuestionCardField {
  id: string;
  label: string;
  type: "text" | "boolean";
}

function QuestionCard({
  card,
  disabled,
  onSubmit,
}: {
  card: QuestionCardPayload;
  disabled?: boolean;
  onSubmit?: (content: string) => Promise<void> | void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const answeredCount = card.fields.filter((field) =>
    isQuestionCardAnswerPresent(values[field.id]),
  ).length;
  const canSubmit = answeredCount > 0 && !disabled;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !onSubmit) return;
    await onSubmit(questionCardAnswerContent(card, values));
  }

  return (
    <form
      className="grid max-w-2xl gap-3 rounded-2xl border border-white/10 bg-[#242424] p-4 text-white shadow-lg"
      aria-label={card.title}
      onSubmit={handleSubmit}
    >
      <div className="space-y-1">
        <p className="text-sm font-medium text-white">{card.title}</p>
        <p className="text-xs text-white/55">
          Answer what you know. Blank fields can stay blank.
        </p>
      </div>
      <div className="grid gap-3">
        {card.fields.map((field) => (
          <QuestionCardFieldControl
            key={field.id}
            field={field}
            value={values[field.id]}
            disabled={disabled}
            onChange={(nextValue) =>
              setValues((current) => ({
                ...current,
                [field.id]: nextValue,
              }))
            }
          />
        ))}
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/45"
        >
          Submit answers
        </button>
      </div>
    </form>
  );
}

function QuestionCardFieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: QuestionCardField;
  value: string | boolean | undefined;
  disabled?: boolean;
  onChange: (value: string | boolean) => void;
}) {
  if (field.type === "boolean") {
    return (
      <div className="grid gap-1.5">
        <p className="text-xs font-medium text-white/75">{field.label}</p>
        <div className="flex gap-2">
          {[
            { label: "yes", value: true },
            { label: "no", value: false },
          ].map((option) => {
            const nextValue = option.value;
            const selected = value === nextValue;
            return (
              <button
                key={option.label}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
                  selected
                    ? "border-white/60 bg-white text-zinc-950"
                    : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10 hover:text-white",
                  disabled && "cursor-not-allowed opacity-60",
                )}
                onClick={() => onChange(nextValue)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-white/75">{field.label}</span>
      <input
        type="text"
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-white/30 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

function actionRowsForMessage(message: TaskThreadMessage) {
  const rows: Array<{
    title: string;
    detail?: string;
    kind: "thinking" | "tool" | "source" | "code";
  }> = [];

  const toolCalls = parseArray(message.toolCalls);
  for (const call of toolCalls) {
    const record = parseRecord(call);
    const name =
      stringValue(record.name) ||
      stringValue(record.toolName) ||
      stringValue(record.tool_name) ||
      "tool";
    rows.push({
      title: `Using ${name}`,
      detail: JSON.stringify(record, null, 2),
      kind: name.includes("code") || name.includes("patch") ? "code" : "tool",
    });
  }

  const toolResults = parseArray(message.toolResults);
  for (const result of toolResults) {
    const record = parseRecord(result);
    if (isQuestionCardRecord(record)) continue;
    const name =
      stringValue(record.name) ||
      stringValue(record.toolName) ||
      stringValue(record.tool_name) ||
      "tool result";
    rows.push({
      title: `Loaded ${name}`,
      detail: JSON.stringify(record, null, 2),
      kind: "source",
    });
  }

  return rows;
}

function questionCardsForMessage(
  message: TaskThreadMessage,
): QuestionCardPayload[] {
  return parseArray(message.toolResults)
    .map((result) => parseQuestionCard(result))
    .filter((card): card is QuestionCardPayload => card !== null);
}

function parseQuestionCard(value: unknown): QuestionCardPayload | null {
  const record = parseRecord(value);
  if (!isQuestionCardRecord(record)) return null;

  const schema = parseRecord(record.schema);
  const id = stringValue(schema.id) ?? "question_card";
  const title = stringValue(schema.title) ?? "Questions";
  const fields = parseArray(schema.fields)
    .map((field) => {
      const fieldRecord = parseRecord(field);
      const fieldId = stringValue(fieldRecord.id);
      const label = stringValue(fieldRecord.label);
      const rawType = stringValue(fieldRecord.type)?.toLowerCase();
      if (!fieldId || !label) return null;
      return {
        id: fieldId,
        label,
        type: rawType === "boolean" ? "boolean" : "text",
      } satisfies QuestionCardField;
    })
    .filter((field): field is QuestionCardField => field !== null);

  if (fields.length === 0) return null;
  return { id, title, fields };
}

function isQuestionCardRecord(record: Record<string, unknown>) {
  return stringValue(record._type) === "question_card";
}

function isQuestionCardAnswerPresent(value: string | boolean | undefined) {
  if (typeof value === "boolean") return true;
  return typeof value === "string" && value.trim().length > 0;
}

const QUESTION_CARD_CANONICAL_LABELS: Record<string, string> = {
  opportunityUrl: "opportunity link",
  salesRep: "sales owner",
  contacts: "primary customer contact",
  dealValue: "deal value",
  productPlan: "product plan",
  closeDate: "target onboarding date",
  documents: "contract link",
  primaryContact: "primary contact",
  accountsPayableContact: "accounts payable contact",
  billingAddress: "billing address",
  shippingAddress: "shipping address",
  taxExempt: "tax exempt",
  creditTermsRequested: "credit terms requested",
  docusignRecipient: "DocuSign recipient",
};

function questionCardAnswerContent(
  card: QuestionCardPayload,
  values: Record<string, string | boolean>,
) {
  const lines = ["Customer onboarding intake answers:"];
  for (const field of card.fields) {
    const value = values[field.id];
    if (!isQuestionCardAnswerPresent(value)) continue;
    const label = QUESTION_CARD_CANONICAL_LABELS[field.id] ?? field.label;
    const answer = typeof value === "boolean" ? (value ? "yes" : "no") : value;
    lines.push(`- ${label}: ${answer}`);
  }
  return lines.join("\n");
}

interface ActionRowData {
  title: string;
  detail?: string;
  content?: ReactNode;
  kind: "thinking" | "tool" | "source" | "code";
  hideIcon?: boolean;
  children?: ActionRowData[];
}

const OKF_WIKI_TRACE_EVENT_TYPE = "wiki_context_trace";

// Exported for convergence testing (plan 2026-06-03-001 R1): live step events
// and the finalized usage.tool_invocations must collapse to one row set.
export function actionRowsForTurn(
  turn: TaskThreadTurn,
  usage: Record<string, unknown>,
  message?: TaskThreadMessage,
): ActionRowData[] {
  const rows: ActionRowData[] = [];

  const toolsCalled = parseArray(usage.tools_called)
    .map((tool) => (typeof tool === "string" ? tool : null))
    .filter(Boolean) as string[];
  const toolInvocations = parseArray(usage.tool_invocations);
  const agentProfileRuns = parseArray(usage.agent_profile_runs)
    .map((run) => parseRecord(run))
    .filter((run) => Object.keys(run).length > 0);
  const profileRunEntries = agentProfileRuns.map((run, index) => ({
    run,
    key: profileKeyFromAgentProfileRun(run) || `profile:${index}`,
  }));
  const consumedProfileRunKeys = new Set<string>();
  const seen = new Set<string>();
  const workspaceDiagnosticsRow = actionRowForWorkspaceDiagnostics(usage);
  if (workspaceDiagnosticsRow) rows.push(workspaceDiagnosticsRow);
  const agentCorePhasesRow = actionRowForAgentCorePhases(usage);
  if (agentCorePhasesRow) rows.push(agentCorePhasesRow);
  const sortedEvents = [...(turn.events ?? [])].sort((a, b) => {
    const ta = parseEventTimestamp(a.createdAt);
    const tb = parseEventTimestamp(b.createdAt);
    if (ta !== tb) return ta - tb;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
  const profileEventChildren = profileChildRowsByProfileKey(sortedEvents);

  for (const invocation of toolInvocations) {
    const record = parseRecord(invocation);
    const agentProfileRun =
      matchingProfileRunForToolInvocation(
        record,
        profileRunEntries,
        consumedProfileRunKeys,
      ) ?? agentProfileRunFromRecord(record);
    const name =
      stringValue(record.tool_name) ||
      stringValue(record.toolName) ||
      stringValue(record.name) ||
      "tool";
    if (agentProfileRun) {
      const profileKey = profileKeyFromAgentProfileRun(agentProfileRun);
      consumedProfileRunKeys.add(profileKey);
      const toolKey = `${name.toLowerCase()}:${profileKey.toLowerCase()}`;
      if (!seen.has(toolKey)) {
        seen.add(toolKey);
        rows.push({
          title: toolActionTitle(name),
          detail: toolInvocationDetail(record),
          kind: toolKind(name),
        });
      }
      const key = `agent_profile:${profileKey.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(
        agentProfileActionRow(
          agentProfileRun,
          profileChildrenForAgentProfileRun(
            agentProfileRun,
            profileEventChildren,
          ),
        ),
      );
      continue;
    }
    const okfWikiRow = okfWikiContextTraceActionRow(record);
    if (okfWikiRow) {
      const key = `okf_wiki_trace:${wikiContextTraceKey(record)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(okfWikiRow);
      continue;
    }
    const wikiRow = wikiContextActionRow(record);
    if (wikiRow) {
      const key = `wiki_context:${wikiContextKey(record)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(wikiRow);
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const detail = toolInvocationDetail(record);
    rows.push({
      title: toolActionTitle(name),
      detail,
      kind: toolKind(name),
    });
    if (detail && isTurnFinished(turn.status)) {
      rows.push({
        title: "tool invocation completed",
        detail: toolInvocationCompletionDetail(record),
        kind: toolKind(name),
      });
    }
  }

  for (const name of toolsCalled) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      title: toolActionTitle(name),
      detail: toolCalledFallbackDetail(name),
      kind: toolKind(name),
    });
  }

  for (const event of sortedEvents) {
    if (isAgentProfileToolEvent(event)) continue;
    if (stringValue(event.eventType)?.startsWith("agent_profile_run")) {
      const payload = parseRecord(event.payload);
      const profileKey = profileKeyFromAgentProfileRun(payload);
      if (seen.has(`agent_profile:${profileKey.toLowerCase()}`)) continue;
    }
    if (stringValue(event.eventType) === OKF_WIKI_TRACE_EVENT_TYPE) {
      const key = `okf_wiki_trace:${wikiContextTraceKey(parseRecord(event.payload))}`;
      if (seen.has(key)) continue;
      const row = actionRowForEvent(event);
      if (!row) continue;
      seen.add(key);
      rows.push(row);
      continue;
    }
    const row = actionRowForEvent(event);
    if (!row) continue;
    // Live tool_invocation_started events emitted by the Strands runtime
    // dedup against the post-turn `usage.tool_invocations` row. Once the
    // turn finishes and the invocation is in `seen` by tool-name, the live
    // event for the same tool would otherwise re-render as a duplicate.
    if (stringValue(event.eventType) === "tool_invocation_started") {
      const payload = parseRecord(event.payload);
      const toolName =
        stringValue(payload.tool_name) ||
        stringValue(payload.toolName) ||
        stringValue(payload.name);
      if (toolName) {
        const profileSlug = stringValue(payload.profile_slug);
        const toolKey = profileSlug
          ? `agent_profile_tool:${profileSlug}:${toolName.toLowerCase()}`
          : toolName.toLowerCase();
        if (seen.has(toolKey)) continue;
        seen.add(toolKey);
      }
    }
    if (stringValue(event.eventType)?.startsWith("agent_profile_run")) {
      const payload = parseRecord(event.payload);
      const profileKey = profileKeyFromAgentProfileRun(payload);
      row.children = profileChildrenForAgentProfileRun(
        payload,
        profileEventChildren,
      );
      seen.add(`agent_profile:${profileKey.toLowerCase()}`);
    }
    const key = `${event.eventType ?? row.title}:${row.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  for (const entry of profileRunEntries) {
    if (consumedProfileRunKeys.has(entry.key)) continue;
    const key = `agent_profile:${entry.key.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(
      agentProfileActionRow(
        entry.run,
        profileChildrenForAgentProfileRun(entry.run, profileEventChildren),
      ),
    );
  }

  const hasProfileRow = [...seen].some((key) =>
    key.startsWith("agent_profile:"),
  );
  const profileMention = !hasProfileRow
    ? agentProfileMentionForMessage(message)
    : null;
  if (profileMention) {
    rows.unshift({
      title: `Agent Profile: ${profileMention.displayName}`,
      detail: `Delegated via ${profileMention.rawText ?? `#${profileMention.displayName}`}. Waiting for profile lane activity.`,
      kind: "thinking",
    });
  }

  return rows;
}

function matchingProfileRunForToolInvocation(
  record: Record<string, unknown>,
  entries: Array<{ run: Record<string, unknown>; key: string }>,
  consumed: Set<string>,
) {
  const nestedId =
    stringValue(record.profileRunId) ??
    stringValue(record.profile_run_id) ??
    stringValue(parseRecord(record.agent_profile_run).profileRunId) ??
    stringValue(parseRecord(record.agent_profile_run).profile_run_id) ??
    stringValue(parseRecord(record.agentProfileRun).profile_run_id) ??
    stringValue(parseRecord(record.agentProfileRun).profileRunId);
  if (nestedId) {
    const match = entries.find((entry) => {
      if (consumed.has(entry.key)) return false;
      return profileKeyFromAgentProfileRun(entry.run) === nestedId;
    });
    if (match) return match.run;
  }

  const args = parseRecord(record.args);
  const slug =
    stringValue(record.profileSlug) ??
    stringValue(record.profile_slug) ??
    stringValue(args.profileSlug) ??
    stringValue(args.profile_slug) ??
    stringValue(args.profile);
  if (!slug) return null;
  const match = entries.find((entry) => {
    if (consumed.has(entry.key)) return false;
    const profileSlug =
      stringValue(
        agentProfileField(entry.run, "profileSlug", "profile_slug"),
      ) ?? "";
    return profileSlug.toLowerCase() === slug.toLowerCase();
  });
  return match?.run ?? null;
}

function actionRowForWorkspaceDiagnostics(usage: Record<string, unknown>) {
  const diagnostics = parseRecord(usage.diagnostics);
  const workspaceDiagnostics = parseRecord(diagnostics.workspace_diagnostics);
  const timings = parseRecord(diagnostics.local_pi_timings_ms);
  if (
    Object.keys(workspaceDiagnostics).length === 0 &&
    Object.keys(timings).length === 0
  ) {
    return null;
  }
  const detail = formatWorkspaceDiagnostics(workspaceDiagnostics, timings);
  if (!detail) return null;
  return {
    title: "Workspace sync",
    detail,
    kind: "source" as const,
  };
}

function actionRowForAgentCorePhases(usage: Record<string, unknown>) {
  const diagnostics = parseRecord(usage.diagnostics);
  const phases = parseArray(diagnostics.agentcore_phases)
    .map((phase) => parseRecord(phase))
    .filter((phase) => stringValue(phase.phase));
  if (phases.length === 0) return null;

  const lines = phases.map((phase) => {
    const name = stringValue(phase.phase) ?? "runtime";
    const status = stringValue(phase.status);
    const duration = Number(phase.duration_ms);
    const count = Number(phase.count);
    const parts = [
      status,
      Number.isFinite(duration) && duration >= 0
        ? formatTimingMs(duration)
        : null,
      Number.isFinite(count) && count >= 0
        ? `count ${Math.round(count)}`
        : null,
      stringValue(phase.detail),
    ].filter(Boolean);
    return `${name.replace(/^runtime\./, "").replace(/_/g, " ")}${
      parts.length ? `: ${parts.join(" · ")}` : ""
    }`;
  });

  return {
    title: "AgentCore phases",
    detail: lines.join("\n"),
    kind: "thinking" as const,
  };
}

function isTurnFinished(status: unknown) {
  const normalized = stringValue(status)?.toLowerCase();
  return normalized !== "running" && normalized !== "queued";
}

function formatWorkspaceDiagnostics(
  workspaceDiagnostics: Record<string, unknown>,
  timings: Record<string, unknown>,
) {
  const normalized: Record<string, unknown> =
    Object.keys(workspaceDiagnostics).length > 0
      ? workspaceDiagnostics
      : workspaceDiagnosticsFromLegacyTimings(timings);
  const timingKeys = [
    "source_freshness_ms",
    "manifest_render_ms",
    "hydration_copy_ms",
    "workspace_sync_ms",
    "sdk_session_ms",
    "model_tool_run_ms",
    "workspace_diff_ms",
    "reconcile_writeback_ms",
  ];
  const countKeys = [
    "file_count",
    "total_files",
    "hydrated_files",
    "synced_files",
    "skipped_files",
    "deleted_files",
    "changed_files",
    "persisted_files",
    "rejected_files",
    "conflicted_files",
  ];

  const seen = new Set<string>();
  const timingLines: string[] = [];
  for (const key of [
    ...timingKeys,
    ...Object.keys(normalized)
      .filter((key) => key.endsWith("_ms"))
      .sort((a, b) => a.localeCompare(b)),
  ]) {
    if (seen.has(key)) continue;
    seen.add(key);
    const value = Number(normalized[key]);
    if (!Number.isFinite(value) || value < 0) continue;
    timingLines.push(`${humanizeTimingKey(key)}: ${formatTimingMs(value)}`);
  }

  const countLines: string[] = [];
  for (const key of countKeys) {
    const value = Number(normalized[key]);
    if (!Number.isFinite(value) || value < 0) continue;
    countLines.push(`${humanizeTimingKey(key)}: ${Math.round(value)}`);
  }

  const stateLines = [
    booleanDiagnosticLine(normalized, "cache_hit", "cache hit"),
    booleanDiagnosticLine(normalized, "cache_stale", "cache stale"),
    booleanDiagnosticLine(
      normalized,
      "access_revalidated",
      "access revalidated",
    ),
    stringValue(normalized.reconcile_status)
      ? `reconcile status: ${stringValue(normalized.reconcile_status)}`
      : null,
    stringValue(normalized.prefix)
      ? `prefix: ${stringValue(normalized.prefix)}`
      : null,
  ].filter(Boolean);

  const sections = [
    timingLines.length ? `Timings\n${timingLines.join("\n")}` : null,
    countLines.length ? `Counts\n${countLines.join("\n")}` : null,
    stateLines.length ? `State\n${stateLines.join("\n")}` : null,
  ].filter(Boolean);
  return sections.length > 0 ? sections.join("\n\n") : null;
}

function workspaceDiagnosticsFromLegacyTimings(
  timings: Record<string, unknown>,
): Record<string, unknown> {
  return {
    workspace_sync_ms: timings.workspace_sync_ms,
    hydration_copy_ms: timings.workspace_sync_ms,
    sdk_session_ms: sumDiagnosticTimings(timings, [
      "sdk_load_ms",
      "agent_prompt_files_ms",
      "mcp_adapter_config_ms",
      "shared_extensions_ms",
      "resource_loader_reload_ms",
      "model_config_ms",
      "sdk_session_create_ms",
      "bind_extensions_ms",
    ]),
    model_tool_run_ms: timings.sdk_prompt_ms,
    workspace_diff_ms: timings.workspace_diff_ms,
    reconcile_writeback_ms: timings.finalize_callback_ms,
  };
}

function sumDiagnosticTimings(
  timings: Record<string, unknown>,
  keys: string[],
) {
  let total = 0;
  let seen = false;
  for (const key of keys) {
    const value = Number(timings[key]);
    if (!Number.isFinite(value) || value < 0) continue;
    total += value;
    seen = true;
  }
  return seen ? total : undefined;
}

function booleanDiagnosticLine(
  diagnostics: Record<string, unknown>,
  key: string,
  label: string,
) {
  return typeof diagnostics[key] === "boolean"
    ? `${label}: ${diagnostics[key] ? "yes" : "no"}`
    : null;
}

function humanizeTimingKey(key: string) {
  return key.replace(/_ms$/, "").replace(/_/g, " ");
}

function formatTimingMs(value: number) {
  return value < 1000
    ? `${Math.round(value)}ms`
    : `${(value / 1000).toFixed(1)}s`;
}

function actionRowForEvent(event: TaskThreadEvent) {
  const eventType = stringValue(event.eventType);
  if (!eventType) return null;
  const payload = parseRecord(event.payload);
  const detail = eventDetail(event, payload);

  if (
    eventType === "agent_profile_run" ||
    eventType === "agent_profile_run_started" ||
    eventType === "agent_profile_run_completed" ||
    eventType === "agent_profile_run_failed"
  ) {
    return agentProfileActionRow({
      ...payload,
      status:
        payload.status ??
        (eventType.endsWith("_started")
          ? "running"
          : eventType.endsWith("_failed")
            ? "failed"
            : "completed"),
      event_detail: detail,
    });
  }
  if (eventType === "tool_invocation_started") {
    const toolName =
      stringValue(payload.tool_name) ||
      stringValue(payload.toolName) ||
      stringValue(payload.name) ||
      "tool";
    const profileName = stringValue(payload.profile_name);
    return {
      title: profileName
        ? `${profileName}: ${toolActionTitle(toolName)}`
        : toolActionTitle(toolName),
      detail,
      kind: toolKind(toolName),
    };
  }
  if (eventType === "wiki_context_result") {
    return (
      wikiContextActionRow(payload) ?? {
        title: "Wiki returned 0 pages",
        detail,
        kind: "source" as const,
      }
    );
  }
  if (eventType === "wiki_context_trace") {
    return (
      okfWikiContextTraceActionRow(payload) ?? {
        title: "OKF wiki trace",
        detail,
        kind: "source" as const,
      }
    );
  }
  if (eventType === "browser_automation_started") {
    return { title: "Opening browser", detail, kind: "source" as const };
  }
  if (eventType === "browser_automation_completed") {
    return { title: "Browser completed", detail, kind: "source" as const };
  }
  if (eventType === "browser_automation_failed") {
    return { title: "Browser failed", detail, kind: "tool" as const };
  }
  if (eventType === "browser_automation_unavailable") {
    return { title: "Browser unavailable", detail, kind: "tool" as const };
  }
  if (eventType.startsWith("computer_task_")) {
    return {
      title: eventType
        .replace(/^computer_task_/, "Workspace run ")
        .replace(/_/g, " "),
      detail,
      kind: "thinking" as const,
    };
  }
  return {
    title: eventType.replace(/_/g, " "),
    detail,
    kind: "tool" as const,
  };
}

function agentProfileRunFromRecord(record: Record<string, unknown>) {
  const direct = parseRecord(
    record.agent_profile_run ?? record.agentProfileRun,
  );
  if (Object.keys(direct).length > 0) return direct;

  const result = parseRecord(record.result);
  const nested = parseRecord(
    result.agent_profile_run ?? result.agentProfileRun,
  );
  if (Object.keys(nested).length > 0) return nested;

  if (
    stringValue(record.profile_slug) ||
    stringValue(record.profileSlug) ||
    stringValue(record.profile_name) ||
    stringValue(record.profileName)
  ) {
    return record;
  }

  return null;
}

function isAgentProfileToolEvent(event: TaskThreadEvent) {
  if (stringValue(event.eventType) !== "tool_invocation_started") return false;
  const payload = parseRecord(event.payload);
  return Boolean(
    stringValue(payload.profile_slug) ||
    stringValue(payload.profileSlug) ||
    stringValue(payload.profile_name) ||
    stringValue(payload.profileName) ||
    stringValue(payload.profile_run_id) ||
    stringValue(payload.profileRunId),
  );
}

function profileKeyFromAgentProfileRun(run: Record<string, unknown>) {
  return (
    stringValue(run.profileRunId) ??
    stringValue(run.profile_run_id) ??
    stringValue(run.profileSlug) ??
    stringValue(run.profile_slug) ??
    stringValue(run.profileName) ??
    stringValue(run.profile_name) ??
    "profile"
  );
}

function profileChildRowsByProfileKey(events: TaskThreadEvent[]) {
  const rowsByKey = new Map<string, ActionRowData[]>();
  for (const event of events) {
    if (!isAgentProfileToolEvent(event)) continue;
    const payload = parseRecord(event.payload);
    const row = actionRowForEvent(event);
    if (!row) continue;
    const keys = agentProfileKeysForChildPayload(payload);
    for (const key of keys) {
      const normalizedKey = key.toLowerCase();
      const rows = rowsByKey.get(normalizedKey) ?? [];
      appendUniqueActionRow(rows, row);
      rowsByKey.set(normalizedKey, rows);
    }
  }
  return rowsByKey;
}

function profileChildrenForAgentProfileRun(
  run: Record<string, unknown>,
  eventChildren: Map<string, ActionRowData[]>,
) {
  const rows: ActionRowData[] = [];
  for (const row of childToolRowsForAgentProfileRun(run)) {
    appendUniqueActionRow(rows, row);
  }
  for (const key of agentProfileKeysForChildPayload(run)) {
    for (const row of eventChildren.get(key.toLowerCase()) ?? []) {
      appendUniqueActionRow(rows, row);
    }
  }
  return rows;
}

function childToolRowsForAgentProfileRun(run: Record<string, unknown>) {
  const profileName =
    stringValue(agentProfileField(run, "profileName", "profile_name")) ??
    "Agent Profile";
  const rows: ActionRowData[] = [];
  for (const value of parseArray(
    agentProfileField(run, "toolInvocations", "tool_invocations"),
  )) {
    const record = parseRecord(value);
    const name =
      stringValue(record.tool_name) ||
      stringValue(record.toolName) ||
      stringValue(record.name);
    if (!name) continue;
    rows.push({
      title: `${profileName}: ${toolActionTitle(name)}`,
      detail:
        toolInvocationDetail(record) ??
        toolInvocationCompletionDetail(record) ??
        undefined,
      kind: toolKind(name),
    });
  }
  return rows;
}

function agentProfileKeysForChildPayload(payload: Record<string, unknown>) {
  return [
    stringValue(payload.profileRunId),
    stringValue(payload.profile_run_id),
    stringValue(payload.profileSlug),
    stringValue(payload.profile_slug),
    stringValue(payload.profileName),
    stringValue(payload.profile_name),
  ].filter((key): key is string => Boolean(key));
}

function appendUniqueActionRow(rows: ActionRowData[], row: ActionRowData) {
  const key = `${row.title}:${row.detail ?? ""}`;
  if (
    rows.some(
      (existing) => `${existing.title}:${existing.detail ?? ""}` === key,
    )
  ) {
    return;
  }
  rows.push(row);
}

function agentProfileActionRow(
  run: Record<string, unknown>,
  children: ActionRowData[] = [],
): ActionRowData {
  const displayName =
    stringValue(agentProfileField(run, "profileName", "profile_name")) ??
    displayNameFromMentionSlug(
      stringValue(agentProfileField(run, "profileSlug", "profile_slug")),
    ) ??
    "Agent Profile";
  const slug =
    stringValue(agentProfileField(run, "profileSlug", "profile_slug")) ??
    displayName.toLowerCase().replace(/\s+/g, "-");
  const model =
    stringValue(agentProfileField(run, "model", "model")) ??
    stringValue(agentProfileField(run, "modelId", "model_id"));
  const input = numberValue(
    agentProfileField(run, "inputTokens", "input_tokens"),
  );
  const output = numberValue(
    agentProfileField(run, "outputTokens", "output_tokens"),
  );
  const cached = numberValue(
    agentProfileField(run, "cachedReadTokens", "cached_read_tokens"),
  );
  const cost = numberValue(agentProfileField(run, "costUsd", "cost_usd"));
  const duration = numberValue(
    agentProfileField(run, "durationMs", "duration_ms"),
  );
  const status = stringValue(agentProfileField(run, "status", "status"));
  const loopEvidence = parseRecord(
    agentProfileField(run, "loopEvidence", "loop_evidence"),
  );
  const loopLines = agentProfileLoopDetailLines(loopEvidence);
  const handoff =
    stringValue(agentProfileField(run, "handoffSummary", "handoff_summary")) ??
    stringValue(agentProfileField(run, "summary", "summary"));
  const task =
    stringValue(agentProfileField(run, "task", "task")) ??
    stringValue(agentProfileField(run, "instruction", "instruction"));
  const eventDetailLine = stringValue(
    agentProfileField(run, "eventDetail", "event_detail"),
  );

  const lines = [
    slug ? `Profile: #${slug}` : null,
    model ? `Model: ${shortenModelName(model)}` : null,
    input == null && output == null
      ? null
      : `Tokens: ${formatCount(input ?? 0)} in / ${formatCount(output ?? 0)} out${
          cached && cached > 0 ? ` (${formatCount(cached)} cached)` : ""
        }`,
    cost == null ? null : `Cost: ${formatUsd(cost)}`,
    duration == null ? null : `Duration: ${formatDuration(duration)}`,
    status ? `Status: ${status.replace(/_/g, " ")}` : null,
    ...loopLines,
    task ? `Task: ${task}` : null,
    handoff ? `Handoff: ${handoff}` : null,
    eventDetailLine,
  ].filter(Boolean);

  return {
    title: `Agent Profile: ${displayName}`,
    detail: lines.join("\n") || undefined,
    kind: "thinking",
    children,
  };
}

function agentProfileLoopDetailLines(evidence: Record<string, unknown>) {
  if (Object.keys(evidence).length === 0) return [];
  const phases = parseArray(evidence.phases).map((item) => parseRecord(item));
  if (phases.length > 0) {
    return [
      "Loop:",
      ...phases.map((phase) => {
        const phaseLabel = loopPhaseLabel(stringValue(phase.phase));
        const status = stringValue(phase.status)?.replace(/_/g, " ");
        const verdict = stringValue(phase.verdict);
        const summary = stringValue(phase.summary);
        const feedback = stringValue(phase.feedback);
        return [
          `- ${phaseLabel}`,
          status ? `: ${status}` : "",
          verdict ? ` · verdict ${verdict.replace(/_/g, " ")}` : "",
          summary ? ` — ${summary}` : "",
          feedback ? ` Feedback: ${feedback}` : "",
        ].join("");
      }),
    ];
  }
  const latest =
    latestLoopRecordFromEvidence(evidence, "iterations") ??
    latestLoopRecordFromEvidence(evidence, "phases");
  const goalState = parseRecord(evidence.goalState);
  const completion = parseRecord(goalState.completion);
  const handoff = parseRecord(evidence.handoff);
  const phase = stringValue(latest?.phase);
  const status = stringValue(latest?.status);
  const verdict =
    stringValue(latest?.verdict) ||
    stringValue(handoff.verdict) ||
    stringValue(completion.verdict);
  const iteration = numberValue(latest?.index);
  const parts = [
    phase ? loopPhaseLabel(phase) : null,
    status ? status.replace(/_/g, " ") : null,
    verdict ? `verdict ${verdict.replace(/_/g, " ")}` : null,
    iteration != null ? `iteration ${iteration}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? [`Loop: ${parts.join(" · ")}`] : [];
}

function loopPhaseLabel(value?: string | null) {
  if (!value) return "Unknown";
  const normalized = value.toLowerCase();
  if (normalized === "self_review" || normalized === "final_review") {
    return "Verification";
  }
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function latestLoopRecordFromEvidence(
  evidence: Record<string, unknown>,
  key: "iterations" | "phases",
) {
  const records = parseArray(evidence[key]).map((item) => parseRecord(item));
  if (records.length === 0) return null;
  if (key === "phases") {
    const active = [...records].reverse().find((record) => {
      const status = stringValue(record.status)?.toLowerCase();
      return status !== "skipped";
    });
    return active ?? records[records.length - 1];
  }
  return records[records.length - 1];
}

function agentProfileField(
  run: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
) {
  return run[camelKey] ?? run[snakeKey];
}

function agentProfileMentionForMessage(message?: TaskThreadMessage) {
  const structured = (message?.mentions ?? []).find(
    (mention) =>
      stringValue(mention.targetType)?.toLowerCase() === "agent_profile" &&
      stringValue(mention.displayName),
  );
  if (structured) {
    return {
      displayName: stringValue(structured.displayName) ?? "Agent Profile",
      slug:
        stringValue(structured.targetId) ??
        stringValue(structured.displayName)?.toLowerCase(),
      rawText:
        stringValue(structured.rawText) ??
        `#${stringValue(structured.displayName) ?? "Agent Profile"}`,
    };
  }

  const rawMatch = message?.content?.match(/[#@]([a-z][a-z0-9_-]*)/i);
  const rawMention = rawMatch?.[1];
  const displayName = displayNameFromMentionSlug(rawMention);
  return displayName
    ? { displayName, slug: rawMention ?? null, rawText: rawMatch?.[0] }
    : null;
}

function displayNameFromMentionSlug(slug: string | null | undefined) {
  if (!slug) return null;
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatUsd(value: number) {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function eventDetail(event: TaskThreadEvent, payload: Record<string, unknown>) {
  const inputPreview =
    stringValue(payload.input_preview) || stringValue(payload.inputPreview);
  const outputPreview =
    stringValue(payload.output_preview) || stringValue(payload.outputPreview);
  const detail = {
    ...(event.createdAt ? { createdAt: event.createdAt } : {}),
    ...(event.level ? { level: event.level } : {}),
    ...sanitizeEventPayload(payload),
  };
  const parts = [
    Object.keys(detail).length ? JSON.stringify(detail, null, 2) : null,
    inputPreview ? `Input: ${formatToolPreview(inputPreview)}` : null,
    outputPreview ? `Output: ${formatToolPreview(outputPreview)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join("\n\n") : undefined;
}

function sanitizeEventPayload(payload: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (isPreviewPayloadKey(key)) continue;
    sanitized[sanitizeEventPayloadKey(key)] = sanitizeEventPayloadValue(value);
  }
  return sanitized;
}

function isPreviewPayloadKey(key: string) {
  return ["input_preview", "inputPreview", "output_preview", "outputPreview"]
    .map((candidate) => candidate.toLowerCase())
    .includes(key.toLowerCase());
}

function sanitizeEventPayloadValue(value: unknown): unknown {
  const decoded = decodeJsonString(value);
  if (decoded !== value) return sanitizeEventPayloadValue(decoded);
  if (Array.isArray(value)) return value.map(sanitizeEventPayloadValue);
  if (value && typeof value === "object") {
    return sanitizeEventPayload(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeEventPayloadKey(key: string) {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  if (normalized === "task") return "instruction";
  if (normalized === "taskid") return "runId";
  if (normalized === "tasktype") return "runType";
  if (normalized === "taskstatus") return "runStatus";
  if (normalized === "computertaskid") return "computerRunId";
  return key.replace(/task/gi, "run");
}

function countThreadSources(
  messages: TaskThreadMessage[],
  turns: TaskThreadTurn[] = [],
) {
  const sources = new Set<string>();

  for (const message of messages) {
    addSourceValues(sources, parseArray(message.toolResults), "tool-result");

    const metadata = parseRecord(message.metadata);
    addSourceValues(sources, parseArray(metadata.sources), "source");
    addSourceValues(sources, parseArray(metadata.citations), "citation");
    addSourceValues(sources, parseArray(metadata.sourceIds), "source-id");
    addSourceValues(sources, parseArray(metadata.source_ids), "source-id");

    const artifactMetadata = parseRecord(message.durableArtifact?.metadata);
    addSourceValues(
      sources,
      parseArray(artifactMetadata.sourceStatuses),
      "artifact-source",
    );
    addSourceValues(
      sources,
      parseArray(artifactMetadata.sources),
      "artifact-source",
    );
  }

  for (const turn of turns) {
    const usage = parseRecord(turn.usageJson);
    for (const invocation of parseArray(usage.tool_invocations)) {
      const record = parseRecord(invocation);
      const name =
        stringValue(record.tool_name) ||
        stringValue(record.toolName) ||
        stringValue(record.name) ||
        "";
      if (toolKind(name) === "source") {
        addSourceValues(sources, [record], "turn-source");
      }
    }

    for (const tool of parseArray(usage.tools_called)) {
      if (typeof tool === "string" && toolKind(tool) === "source") {
        sources.add(`tool:${tool}`);
      }
    }
  }

  return sources.size;
}

function addSourceValues(
  target: Set<string>,
  values: unknown[],
  prefix: string,
) {
  for (const value of values) {
    const key = sourceKey(value);
    if (key) target.add(`${prefix}:${key}`);
  }
}

function sourceKey(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  const record = parseRecord(value);
  return (
    stringValue(record.id) ||
    stringValue(record.url) ||
    stringValue(record.href) ||
    stringValue(record.provider) ||
    stringValue(record.name) ||
    stringValue(record.title) ||
    stringValue(record.tool_name) ||
    stringValue(record.toolName) ||
    (Object.keys(record).length ? JSON.stringify(record) : null)
  );
}

function turnSummary(turn: TaskThreadTurn, usage: Record<string, unknown>) {
  const parts = [
    formatInvocationSource(turn.invocationSource),
    stringValue(turn.model),
    formatTurnStatus(turn.status),
    formatTurnDuration(turn),
    formatTokenUsage(usage),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "ThinkWork is working.";
}

function formatInvocationSource(source: unknown) {
  const raw = stringValue(source);
  if (!raw) return null;
  const labels: Record<string, string> = {
    chat: "Manual chat",
    chat_message: "Manual chat",
    desktop_managed_delegation: "Managed delegation",
    "desktop-local": "Legacy agent",
    desktop_local: "Legacy agent",
    manual: "Manual chat",
    schedule: "Schedule",
    webhook: "Webhook",
    email: "Email",
  };
  return labels[raw.toLowerCase()] ?? raw.replace(/_/g, " ");
}

function formatTurnStatus(status: unknown) {
  const raw = stringValue(status);
  return raw ? raw.toLowerCase() : null;
}

function formatTurnDuration(turn: TaskThreadTurn) {
  if (!turn.startedAt || !turn.finishedAt) return null;
  const start = Date.parse(turn.startedAt);
  const finish = Date.parse(turn.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) {
    return null;
  }
  const ms = finish - start;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatTokenUsage(usage: Record<string, unknown>) {
  const input = Number(usage.input_tokens ?? usage.inputTokens ?? 0);
  const output = Number(usage.output_tokens ?? usage.outputTokens ?? 0);
  if (!input && !output) return null;
  return `${formatCount(input)} in / ${formatCount(output)} out`;
}

function formatCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

function toolKind(name: string): "tool" | "source" | "code" {
  const normalized = name.toLowerCase();
  if (normalized.includes("code") || normalized.includes("patch")) {
    return "code";
  }
  if (
    normalized.includes("search") ||
    normalized.includes("source") ||
    normalized.includes("crm") ||
    normalized.startsWith("wiki_")
  ) {
    return "source";
  }
  return "tool";
}

function toolActionTitle(name: string) {
  const normalized = name.toLowerCase();
  if (normalized === "query_wiki_context") {
    return "Checking wiki";
  }
  if (normalized.startsWith("wiki_")) {
    return `Checking OKF wiki ${name.replace(/^wiki_/, "").replace(/_/g, " ")}`;
  }
  if (normalized.includes("web_search") || normalized.includes("search")) {
    return "Finding sources";
  }
  if (normalized.includes("recall") || normalized.includes("memory")) {
    return "Checking memory";
  }
  if (normalized.includes("file_read") || normalized.includes("read")) {
    return "Reading files";
  }
  if (normalized.includes("patch") || normalized.includes("code")) {
    return "Applying code changes";
  }
  return `Using ${name.replace(/_/g, " ")}`;
}

function toolCalledFallbackDetail(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes("recall") || normalized.includes("memory")) {
    return [
      "Memory was checked during this turn, but detailed invocation metadata was not captured.",
      "New runs include memory input, output, and status details when the runtime records the invocation trace.",
    ].join("\n");
  }
  return undefined;
}

function wikiContextKey(record: Record<string, unknown>) {
  const wiki = wikiContextFromRecord(record);
  const query = stringValue(wiki?.query);
  const id = stringValue(record.id);
  return [id, query, numberValue(wiki?.result_count) ?? 0]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(":");
}

function okfWikiContextTraceActionRow(
  record: Record<string, unknown>,
): ActionRowData | null {
  const trace = wikiContextTraceFromRecord(record);
  if (!trace) return null;
  return {
    title: wikiContextTraceTitle(trace),
    detail: formatWikiContextTraceDetail(trace),
    content: <WikiContextTraceCard trace={trace} />,
    kind: "source",
  };
}

function wikiContextActionRow(
  record: Record<string, unknown>,
): ActionRowData | null {
  const wiki = wikiContextFromRecord(record);
  if (!wiki) return null;
  const query = stringValue(wiki.query);
  const count = numberValue(wiki.result_count) ?? 0;
  const pages = parseArray(wiki.top_pages)
    .map((page) => parseRecord(page))
    .filter((page) => Object.keys(page).length > 0);
  const pageTitles = pages
    .map((page) => stringValue(page.title) || stringValue(page.slug))
    .filter(Boolean)
    .slice(0, 3);
  const provider = stringValue(wiki.retrieval_mode) || "wiki";
  const status = stringValue(wiki.status);
  const summaryParts = [
    query ? `Query: ${query}` : null,
    `Results: ${count}`,
    pageTitles.length > 0 ? `Top pages: ${pageTitles.join(", ")}` : null,
    provider ? `Mode: ${provider}` : null,
    status ? `Status: ${status.replace(/_/g, " ")}` : null,
  ].filter(Boolean);
  const detailParts = [
    summaryParts.join("\n"),
    JSON.stringify(wiki, null, 2),
  ].filter(Boolean);
  return {
    title: `Wiki returned ${count} page${count === 1 ? "" : "s"}`,
    detail: detailParts.join("\n\n"),
    kind: "source",
  };
}

function wikiContextFromRecord(
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!record) return null;
  if (
    record.result_count !== undefined ||
    record.top_pages !== undefined ||
    record.surface === "query_wiki_context"
  ) {
    return record;
  }
  const direct = parseRecord(record.wiki_context ?? record.wikiContext);
  if (Object.keys(direct).length > 0) return direct;

  const details = parseRecord(record.details);
  const detailWiki = parseRecord(details.wiki_context ?? details.wikiContext);
  if (Object.keys(detailWiki).length > 0) return detailWiki;

  const result = parseRecord(record.result);
  const resultWiki = parseRecord(
    result.wiki_context ??
      result.wikiContext ??
      parseRecord(result.details).wiki_context,
  );
  return Object.keys(resultWiki).length > 0 ? resultWiki : null;
}

function toolInvocationDetail(record: Record<string, unknown>) {
  const okfWikiRow = okfWikiContextTraceActionRow(record);
  if (okfWikiRow?.detail) return okfWikiRow.detail;

  const wikiRow = wikiContextActionRow(record);
  if (wikiRow?.detail) return wikiRow.detail;

  const inputPreview = stringValue(record.input_preview);
  const outputPreview = stringValue(record.output_preview);
  const status = stringValue(record.status);
  const parts = [
    `Model routing\n${toolModelRoutingLines(record).join("\n")}`,
    inputPreview ? `Input: ${formatToolPreview(inputPreview)}` : null,
    outputPreview ? `Output: ${formatToolPreview(outputPreview)}` : null,
    status ? `Status: ${status}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join("\n\n") : JSON.stringify(record, null, 2);
}

function toolInvocationCompletionDetail(record: Record<string, unknown>) {
  const metadata = sanitizeToolInvocationMetadata(record);
  const previewDetail = toolInvocationDetail(record);
  const parts = [
    Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : null,
    previewDetail,
  ].filter(Boolean);
  return parts.length ? parts.join("\n\n") : previewDetail;
}

function sanitizeToolInvocationMetadata(record: Record<string, unknown>) {
  const metadata: Record<string, unknown> = {};
  for (const key of [
    "createdAt",
    "created_at",
    "id",
    "tool_name",
    "toolName",
    "name",
    "status",
    "is_error",
    "isError",
    "model",
    "model_id",
    "modelId",
    "input_tokens",
    "inputTokens",
    "output_tokens",
    "outputTokens",
    "cached_read_tokens",
    "cacheReadTokens",
    "model_routing_status",
    "modelRoutingStatus",
    "model_routing_rule_source",
    "modelRoutingRuleSource",
    "model_routing_match",
    "modelRoutingMatch",
    "runtime",
    "started_at",
    "startedAt",
    "finished_at",
    "finishedAt",
  ]) {
    if (record[key] === undefined || isPreviewPayloadKey(key)) continue;
    metadata[key] = sanitizeEventPayloadValue(record[key]);
  }
  return metadata;
}

function toolModelRoutingLines(record: Record<string, unknown>) {
  const routing = parseRecord(record.model_routing ?? record.modelRouting);
  const model =
    stringValue(record.model) ||
    stringValue(record.model_id) ||
    stringValue(record.modelId) ||
    stringValue(routing.model) ||
    stringValue(routing.model_id) ||
    stringValue(routing.modelId);
  const input = numberValue(
    record.input_tokens ??
      record.inputTokens ??
      routing.input_tokens ??
      routing.inputTokens,
  );
  const output = numberValue(
    record.output_tokens ??
      record.outputTokens ??
      routing.output_tokens ??
      routing.outputTokens,
  );
  const cached = numberValue(
    record.cached_read_tokens ??
      record.cacheReadTokens ??
      routing.cached_read_tokens ??
      routing.cacheReadTokens,
  );
  const status =
    stringValue(record.model_routing_status) ||
    stringValue(record.modelRoutingStatus) ||
    stringValue(routing.status) ||
    "not routed";
  const ruleSource =
    record.model_routing_rule_source ??
    record.modelRoutingRuleSource ??
    routing.rule_source ??
    routing.ruleSource;
  const match =
    record.model_routing_match ?? record.modelRoutingMatch ?? routing.match;

  const tokenLine =
    input == null && output == null
      ? "Tokens: unavailable"
      : `Tokens: ${formatCount(input ?? 0)} in / ${formatCount(output ?? 0)} out${
          cached && cached > 0 ? ` (${formatCount(cached)} cached)` : ""
        }`;
  const lines = [
    `Model: ${model ? shortenModelName(model) : "not routed"}`,
    tokenLine,
    `Routing status: ${status.replace(/_/g, " ")}`,
  ];
  if (ruleSource != null) {
    lines.push(`Rule source: ${JSON.stringify(ruleSource, null, 2)}`);
  }
  if (match != null) {
    lines.push(`Match: ${JSON.stringify(match, null, 2)}`);
  }
  return lines;
}

function numberValue(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function shortenModelName(model: string) {
  return model
    .replace(/^us\.anthropic\./, "")
    .replace(/^anthropic\./, "")
    .replace(/-v\d+:\d+$/, "");
}

function formatToolPreview(value: string) {
  const decoded = decodeNestedJsonStrings(value);
  if (decoded !== value) return JSON.stringify(decoded, null, 2);
  return formatPartialJsonPreview(value);
}

function decodeNestedJsonStrings(value: unknown): unknown {
  const decoded = decodeJsonString(value);
  if (decoded !== value) return decodeNestedJsonStrings(decoded);
  if (Array.isArray(value)) return value.map(decodeNestedJsonStrings);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        decodeNestedJsonStrings(child),
      ]),
    );
  }
  return value;
}

function decodeJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) return value;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && (typeof parsed === "object" || Array.isArray(parsed))
      ? parsed
      : value;
  } catch {
    return value;
  }
}

function formatPartialJsonPreview(value: string) {
  const unescaped = unescapeJsonPreviewFragments(value);
  if (unescaped === value) return value;
  return unescaped
    .replace(/([{\[])/g, "$1\n  ")
    .replace(/([}\]])/g, "\n$1")
    .replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ",\n  ")
    .replace(/\n[ \t]*\n/g, "\n")
    .trim();
}

function unescapeJsonPreviewFragments(value: string) {
  if (!/[\\][\\"nrt]/.test(value)) return value;
  let unescaped = value;
  for (let i = 0; i < 4; i += 1) {
    const next = unescaped
      .replace(/\\\\/g, "\\")
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"');
    if (next === unescaped) break;
    unescaped = next;
  }
  return unescaped;
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseArray(value: unknown): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseEventTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}

function TaskThreadState({ label, tone }: { label: string; tone?: "error" }) {
  return (
    <main className="flex w-full flex-1 items-center justify-center p-6">
      {tone === "error" ? (
        <p className="text-destructive">{label}</p>
      ) : (
        <LoadingShimmer
          text={label}
          ariaLabel={label}
          className="font-mono text-sm text-muted-foreground"
        />
      )}
    </main>
  );
}

/**
 * Convert AI-Elements FileUIPart entries (blob URLs) back to File
 * objects so the upload helper can POST the bytes. PromptInput's
 * onSubmit hands us `{ type: 'file', url: blob://..., mediaType, filename }`
 * — fetch each blob, slice into a File with the original filename + MIME.
 *
 * Used by U1 of the finance pilot to surface the user's attached
 * Excel/CSV files to the route's `onSendFollowUp` upload pipeline.
 */
async function fileUiPartsToFiles(
  parts: Array<{
    url?: string;
    mediaType?: string;
    filename?: string;
    file?: File;
  }>,
): Promise<File[]> {
  if (!parts || parts.length === 0) return [];
  const files: File[] = [];
  for (const part of parts) {
    // Prefer the original File captured at selection time — reifying via
    // fetch(blob:/data:) is blocked by connect-src CSP in packaged desktop and
    // deployed web builds (only the dev server's loose CSP allowed it), which
    // silently dropped every attachment.
    if (part?.file instanceof File) {
      files.push(part.file);
      continue;
    }
    if (!part?.url) continue;
    try {
      const file = part.url.startsWith("data:")
        ? dataUrlToFile(part.url, part.filename, part.mediaType)
        : await (async () => {
            const response = await fetch(part.url!);
            const blob = await response.blob();
            return new File([blob], part.filename ?? "attachment", {
              type: part.mediaType ?? blob.type ?? "application/octet-stream",
            });
          })();
      if (file) files.push(file);
    } catch (err) {
      console.warn(
        `[FollowUpComposer] failed to reify attached file ${part.filename}:`,
        err,
      );
    }
  }
  return files;
}

/**
 * Decode a `data:` URL into a File without `fetch()` (which connect-src CSP
 * blocks in packaged/deployed builds). Fallback when the original File object
 * isn't carried on the part.
 */
function dataUrlToFile(
  url: string,
  filename?: string,
  mediaType?: string,
): File | null {
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  const header = url.slice(5, comma); // strip leading "data:"
  const isBase64 = /;base64/i.test(header);
  const mime = mediaType ?? header.split(";")[0] ?? "application/octet-stream";
  const payload = url.slice(comma + 1);
  if (!isBase64) {
    return new File([decodeURIComponent(payload)], filename ?? "attachment", {
      type: mime,
    });
  }
  const binary = atob(payload);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) view[i] = binary.charCodeAt(i);
  return new File([buffer], filename ?? "attachment", { type: mime });
}
