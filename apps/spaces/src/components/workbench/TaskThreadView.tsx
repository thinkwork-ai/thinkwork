import {
  AtSign,
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
  Database,
  Download,
  FileText,
  ListChecks,
  RotateCcw,
  Search,
  Sparkles,
  SquareTerminal,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from "@thinkwork/ui";
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
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { IconCircleCheckFilled, IconPaperclip } from "@tabler/icons-react";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import { renderTypedParts } from "@/components/workbench/render-typed-part";
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
import {
  GeneratedArtifactCard,
  GeneratedArtifactPreview,
  type GeneratedArtifact,
} from "@/components/workbench/GeneratedArtifactCard";
import { StreamingMessageBuffer } from "@/components/workbench/StreamingMessageBuffer";
import {
  filterMentionTargets,
  MentionMenu,
  type MentionTarget,
} from "@/components/spaces/MentionMenu";
import {
  AgentRuntimeIndicator,
  type AgentRuntimePreference,
} from "@/components/workbench/AgentRuntimeIndicator";
import {
  useDesktopLocalPiConsole,
  type DesktopLocalPiConsoleEntry,
} from "@/lib/use-desktop-local-pi-console";
import type { ComputerThreadChunk } from "@/lib/use-computer-thread-chunks";

const SHIMMER_TEXT = "Processing...";
const SHIMMER_CHAR_DURATION_MS = 120;
const DEFAULT_COMPOSER_BOTTOM_INSET_PX = 220;
const COMPOSER_TRANSCRIPT_GAP_PX = 32;

export interface TaskThreadMessage {
  id: string;
  role: string;
  content?: string | null;
  sender?: TaskThreadMessageSender | null;
  createdAt?: string | null;
  metadata?: unknown;
  toolCalls?: unknown;
  toolResults?: unknown;
  parts?: AccumulatedPart[];
  durableArtifact?: GeneratedArtifact | null;
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
  startedAt?: string | null;
  finishedAt?: string | null;
  model?: string | null;
  usageJson?: unknown;
  resultJson?: unknown;
  error?: string | null;
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
  currentUser?: CurrentUserIdentity | null;
  onSendFollowUp?: (
    content: string,
    files?: File[],
    mentions?: ComposerMention[],
    agentRequested?: boolean,
    runtimePreference?: AgentRuntimePreference,
  ) => Promise<void> | void;
  artifactPanelState?: TaskThreadArtifactPanelState;
  infoPanelState?: TaskThreadInfoPanelState;
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
  startedAt?: string | null;
  startedBy?: string | null;
  agents: string[];
  attachments: ThreadInfoAttachment[];
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
  onCompleteThread?: () => Promise<void> | void;
}

export interface ThreadInfoChecklistTask {
  id: string;
  title: string;
  status?: string | null;
  required?: boolean | null;
  roleKey?: string | null;
  assigneeDisplay?: string | null;
  blocked?: boolean | null;
  notes?: string | null;
  updatedAt?: string | null;
}

export interface ComposerMention {
  targetType: "USER" | "AGENT";
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
  currentUser,
  onSendFollowUp,
  artifactPanelState,
  infoPanelState,
}: TaskThreadViewProps) {
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

  const localPiConsoleEntries = useDesktopLocalPiConsole(thread?.id ?? null);

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
  const showStreamingBuffer =
    streamingChunks.length > 0 && !hasAssistantAfterLatestUser(visibleMessages);
  const showProcessingShimmer =
    !showStreamingBuffer &&
    isAwaitingAssistantResponse(thread, visibleMessages);
  const showTaskQueueProcessingShimmer = Boolean(
    promptTaskQueue &&
    isActiveTaskQueueStatus(promptTaskQueue.data.status) &&
    !showStreamingBuffer &&
    !showProcessingShimmer,
  );
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
                  title="Thinking"
                  detail="ThinkWork is preparing this thread."
                />
              ) : (
                transcriptMessages.map((message, index) => (
                  <TranscriptSegment
                    key={message.id}
                    message={message}
                    turn={turnByUserMessageId.get(message.id)}
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
                    onDownloadAttachment={infoPanelState?.onDownloadAttachment}
                    currentUser={currentUser}
                    showProcessingShimmer={
                      index === latestUserIndex && showProcessingShimmer
                    }
                  />
                ))
              )}
              {showTaskQueueProcessingShimmer ? <ProcessingShimmer /> : null}
              <LocalPiConsole entries={localPiConsoleEntries} />
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
            "pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 sm:px-6",
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

  const startedAt = formatInfoDate(state.startedAt);
  const startedBy = state.startedBy?.trim() || "Unknown";
  const hasGoal = Boolean(state.goal);

  return (
    <aside
      className="absolute bottom-4 right-5 top-2.5 z-20 hidden w-[300px] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#2b2b2b]/95 text-[#ececec] shadow-2xl md:grid"
      aria-label={hasGoal ? "Thread Goal info" : "Thread info"}
      data-testid="thread-info-panel"
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        <div className="space-y-5 p-5">
          {state.goal ? <ThreadInfoGoal goal={state.goal} /> : null}

          {state.checklist ? (
            <ThreadInfoChecklist
              checklist={state.checklist}
              onTaskPrompt={onTaskPrompt}
            />
          ) : null}

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

          <section className="border-t border-white/10 pt-4">
            <h2 className="mb-3 text-sm font-medium text-white/55">Thread</h2>
            <div className="space-y-3">
              <InfoPanelInlineRow
                icon={<CalendarDays className="size-4" />}
                value={startedAt || "Unknown"}
              />
              <InfoPanelInlineRow
                icon={<Zap className="size-4" />}
                value={`Triggered by ${startedBy}`}
              />
            </div>
          </section>
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
        <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-white/75">
          {progress}%
        </span>
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
  onTaskPrompt,
}: {
  task: ThreadInfoChecklistTask;
  onTaskPrompt: (task: ThreadInfoChecklistTask) => void;
}) {
  const status = normalizeInfoStatus(task.status);
  const isComplete = status === "completed";
  const isBlocked = task.blocked || status === "blocked";
  const assignee = task.assigneeDisplay?.trim() ?? "";
  const statusLabel =
    task.status && task.status.trim() ? formatInfoStatus(task.status) : "";
  const hasSublabel = Boolean(assignee) || Boolean(statusLabel);
  const sublabel =
    assignee && statusLabel
      ? `${assignee} · ${statusLabel}`
      : assignee || statusLabel;

  return (
    <button
      type="button"
      className="block w-full rounded-md text-left text-sm transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
      onClick={() => onTaskPrompt(task)}
      aria-label={`Update ${task.title}`}
    >
      <div className="flex items-start gap-2">
        {isComplete ? (
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
          <p className="line-clamp-2 text-white/80">{task.title}</p>
          {hasSublabel ? (
            <p className="mt-0.5 truncate text-[10px] text-white/55">
              {sublabel}
            </p>
          ) : null}
        </div>
      </div>
    </button>
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

function TranscriptSegment({
  message,
  turn,
  isLatestUser,
  streamingChunks,
  streamState,
  onOpenArtifact,
  onSendFollowUp,
  isSending,
  threadAttachments,
  onDownloadAttachment,
  currentUser,
  showProcessingShimmer,
}: {
  message: TaskThreadMessage;
  turn?: TaskThreadTurn;
  isLatestUser: boolean;
  streamingChunks: ComputerThreadChunk[];
  streamState?: UIMessageStreamState;
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
  showProcessingShimmer: boolean;
}) {
  // Plan-012 U14: when typed UIMessage parts are flowing for this turn,
  // render via renderTypedParts (Reasoning + Tool + Response per part).
  // Falls back to the legacy chunk-based StreamingMessageBuffer when the
  // wire still produces {text} envelopes (non-Computer agents and
  // pre-U6 historical messages).
  const hasTypedParts = streamState != null && streamState.parts.length > 0;
  return (
    <>
      <TranscriptMessage
        message={message}
        onOpenArtifact={onOpenArtifact}
        onSendFollowUp={onSendFollowUp}
        isSending={isSending}
        threadAttachments={threadAttachments}
        onDownloadAttachment={onDownloadAttachment}
        currentUser={currentUser}
      />
      {turn ? <ThreadTurnActivity turn={turn} /> : null}
      {isLatestUser ? (
        <>
          {hasTypedParts ? (
            <article aria-label="Streaming assistant response">
              {renderTypedParts(streamState!.parts, {
                keyPrefix: `${message.id}::stream`,
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
          {showProcessingShimmer ? <ProcessingShimmer /> : null}
        </>
      ) : null}
    </>
  );
}

const RENDERED_TURN_STATUSES = new Set([
  "running",
  "pending",
  "queued",
  "claimed",
  "completed",
  "succeeded",
  "failed",
]);

function normalizeStatus(status: unknown) {
  return String(status ?? "")
    .toLowerCase()
    .trim();
}

function ThreadTurnActivity({ turn }: { turn?: TaskThreadTurn }) {
  if (!turn) return null;

  const status = normalizeStatus(turn.status);
  const usage = parseRecord(turn.usageJson);
  const rows = actionRowsForTurn(turn, usage);
  const shouldRender =
    RENDERED_TURN_STATUSES.has(status) ||
    rows.length > 0 ||
    Boolean(turn.error);
  if (!shouldRender) return null;

  // Thinking always defaults closed — opening it on running turns caused
  // visible content shift as action rows streamed in (the user is reading
  // the previous answer or composing a follow-up; the page jumping is
  // disruptive). Failed turns also default closed; the Run failed row is
  // available on click. Manual user toggle persists across re-renders
  // because we no longer key the disclosure on status.
  return (
    <ThinkingRow
      title="Thinking"
      detail={turnSummary(turn, usage)}
      ariaLabel="Thinking and tool activity"
    >
      {rows.map((row) => (
        <ActionRow
          key={`${turn.id}-${row.title}`}
          title={row.title}
          detail={row.detail}
          kind={row.kind}
        />
      ))}
      {turn.error ? (
        <ActionRow title="Run failed" detail={turn.error} kind="tool" />
      ) : null}
    </ThinkingRow>
  );
}

// Match each USER message to its corresponding turn so multi-turn threads
// render one Thinking row per turn (parity with the admin thread view).
// Sort turns ASC by startedAt (the GraphQL resolver emits DESC), then assign
// turns to user messages in document order. Extra turns (e.g. scheduled-job
// triggers with no preceding user message) attach to the latest user message
// so the activity remains discoverable.
function mapTurnsToUserMessages(
  messages: TaskThreadMessage[],
  turns: TaskThreadTurn[],
): Map<string, TaskThreadTurn> {
  const map = new Map<string, TaskThreadTurn>();
  if (turns.length === 0) return map;

  const sortedTurns = [...turns].sort((a, b) => {
    const ta = parseEventTimestamp(a.startedAt ?? null);
    const tb = parseEventTimestamp(b.startedAt ?? null);
    if (ta !== tb) return ta - tb;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });

  const userMessages = messages.filter(
    (message) => message.role.toUpperCase() === "USER",
  );
  if (userMessages.length === 0) return map;

  const pairCount = Math.min(userMessages.length, sortedTurns.length);
  for (let i = 0; i < pairCount; i += 1) {
    map.set(userMessages[i].id, sortedTurns[i]);
  }

  // If there are more turns than user messages, anchor the trailing turns to
  // the latest user message so they remain visible.
  if (sortedTurns.length > userMessages.length) {
    map.set(
      userMessages[userMessages.length - 1].id,
      sortedTurns[sortedTurns.length - 1],
    );
  }

  return map;
}

function withTurnResponseFallback(thread: TaskThread): TaskThreadMessage[] {
  if (hasAssistantAfterLatestUser(thread.messages)) return thread.messages;

  // The fallback exists for the brief window between a turn finishing and the
  // assistant message being persisted/refetched. Only synthesize when the
  // latest completed turn actually corresponds to the latest user message —
  // i.e. it finished AT OR AFTER the latest user message was sent. Otherwise
  // a previous question's response gets re-rendered below the new question's
  // running Thinking row, producing a phantom duplicate.
  const latestUserMessage = findLastIndex(
    thread.messages,
    (message) => message.role.toUpperCase() === "USER",
  );
  if (latestUserMessage < 0) return thread.messages;
  const latestUserTime = parseEventTimestamp(
    thread.messages[latestUserMessage].createdAt ?? null,
  );

  const latestCompletedTurn = (thread.turns ?? []).find((turn) => {
    if (
      !["completed", "succeeded"].includes(
        String(turn.status ?? "").toLowerCase(),
      )
    ) {
      return false;
    }
    const finishedTime = parseEventTimestamp(turn.finishedAt ?? null);
    // Allow when timestamps are unavailable (treat as 0) so older threads
    // without timestamps still render their fallback once.
    return finishedTime === 0 || finishedTime >= latestUserTime;
  });
  const response = stringValue(
    parseRecord(latestCompletedTurn?.resultJson).response,
  );
  if (!latestCompletedTurn || !response) return thread.messages;

  return [
    ...thread.messages,
    {
      id: `turn-${latestCompletedTurn.id}-response`,
      role: "ASSISTANT",
      content: response,
      createdAt: latestCompletedTurn.finishedAt,
      metadata: {
        source: "thread_turn_result",
        turnId: latestCompletedTurn.id,
      },
    },
  ];
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

function isAwaitingAssistantResponse(
  thread: TaskThread,
  visibleMessages: TaskThreadMessage[],
) {
  const latestUserIndex = findLastIndex(
    visibleMessages,
    (message) => message.role.toUpperCase() === "USER",
  );
  if (latestUserIndex < 0) return false;
  if (hasAssistantAfterLatestUser(visibleMessages)) return false;
  return (thread.turns ?? []).some((turn) =>
    ["pending", "running"].includes(String(turn.status ?? "").toLowerCase()),
  );
}

function isActiveTaskQueueStatus(status: unknown) {
  const normalized = normalizeTaskQueueStatus(status);
  return !["completed", "failed", "cancelled", "rejected"].includes(normalized);
}

function ProcessingShimmer() {
  return (
    <article
      className="text-sm leading-6"
      aria-label="Processing request"
      role="status"
    >
      <span aria-hidden="true">
        {SHIMMER_TEXT.split("").map((char, index) => (
          <span
            className="tw-shimmer-char"
            key={`${char}-${index}`}
            style={{
              animationDelay: `${index * SHIMMER_CHAR_DURATION_MS}ms`,
            }}
          >
            {char}
          </span>
        ))}
      </span>
      <span className="sr-only">Processing request</span>
    </article>
  );
}

// 10 lines x leading-5 (20px) of the user bubble's text rhythm.
const COLLAPSE_MAX_HEIGHT_PX = 200;

function CollapsibleUserMessageBody({ body }: { body: string }) {
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
        {body}
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
  onOpenArtifact,
  onSendFollowUp,
  isSending,
  threadAttachments,
  onDownloadAttachment,
  currentUser,
}: {
  message: TaskThreadMessage;
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
}) {
  const role = message.role.toUpperCase();
  const isUser = role === "USER";
  const isOwnMessage = isCurrentUserMessage(message, currentUser);
  const avatarKind = messageAvatarKind(message, isOwnMessage);
  const actions = actionRowsForMessage(message);
  const questionCards = !isUser ? questionCardsForMessage(message) : [];
  const body = message.content?.trim() ?? "";
  const attachments = isUser
    ? resolveMessageAttachments({
        metadata: message.metadata,
        threadAttachments,
      })
    : [];
  const typedParts = !isUser ? (message.parts ?? []) : [];
  const renderedTypedParts =
    typedParts.length > 0
      ? renderTypedParts(typedParts, { keyPrefix: message.id }).filter(Boolean)
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
              {body ? <CollapsibleUserMessageBody body={body} /> : null}
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
                renderedTypedParts
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

export function normalizePersistedParts(value: unknown): AccumulatedPart[] {
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
      parts.push({
        type: type as `data-${string}`,
        id: stringValue(record.id) ?? undefined,
        data: record.data,
      });
    }
  }
  return parts;
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
  prefill,
  onSubmit,
}: {
  threadId: string;
  taskQueue?: ActiveTaskQueue | null;
  disabled?: boolean;
  isSending?: boolean;
  mentionTargets: MentionTarget[];
  prefill?: { text: string; token: number } | null;
  onSubmit?: (
    content: string,
    files?: File[],
    mentions?: ComposerMention[],
    agentRequested?: boolean,
    runtimePreference?: AgentRuntimePreference,
  ) => Promise<void> | void;
}) {
  const composer = useComposerState(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mentions, setMentions] = useState<ComposerMention[]>([]);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [runtimePreference, setRuntimePreference] =
    useState<AgentRuntimePreference>("local");
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
        : filterMentionTargets(mentionTargets, mentionQuery, {
            includeDefaultAgentShortcut: true,
          }),
    [mentionQuery, mentionTargets],
  );
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
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
  const effectiveAgentEnabled = agentForcedOn || agentEnabled;
  const canSubmit =
    (composer.text.trim().length > 0 || composer.files.length > 0) &&
    !disabled &&
    !isSending;

  useEffect(() => {
    if (agentForcedOn) setAgentEnabled(true);
  }, [agentForcedOn]);

  useEffect(() => {
    setAgentEnabled(true);
  }, [threadId]);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionQuery, mentionOptions.length]);

  useEffect(() => {
    if (!prefillText) return;
    composer.setText(prefillText);
    const focusPrefilledComposer = () => {
      const textarea =
        textareaRef.current ??
        document.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="Follow up"]',
        );
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(prefillText.length, prefillText.length);
      return document.activeElement === textarea;
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
      // PromptInput emits FileUIPart entries with blob URLs. Fetch the
      // blob and rebuild File objects so the route's upload helper can
      // POST the bytes through presign + PUT + finalize.
      const files = await fileUiPartsToFiles(message.files);
      const content = composer.text.trim();
      const submittedMentions = mentions.filter((mention) =>
        content.includes(mention.rawText),
      );
      await onSubmit(
        content,
        files,
        submittedMentions,
        effectiveAgentEnabled,
        runtimePreference,
      );
      composer.clear();
      setMentions([]);
    } catch (err) {
      composer.setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      composer.setSubmitting(false);
    }
  }

  const hasTaskQueue = Boolean(taskQueue);
  const agentToggleTitle = agentForcedOn
    ? "Agent handling is required by @agent or @think"
    : effectiveAgentEnabled
      ? "Agent will respond"
      : "Send without waking the agent";

  function selectMention(target: MentionTarget) {
    const replacement = `@${target.displayName} `;
    const query = mentionQuery ?? "";
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery === null || mentionOptions.length === 0) return;

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
    if (event.key === "Enter") {
      event.preventDefault();
      const target =
        mentionOptions[
          Math.min(activeMentionIndex, Math.max(mentionOptions.length - 1, 0))
        ];
      if (target) selectMention(target);
    }
  }

  return (
    <div
      className={cn(
        "grid gap-2",
        hasTaskQueue &&
          "overflow-hidden rounded-[28px] border border-white/10 bg-[#262626] text-white shadow-lg",
      )}
    >
      {taskQueue ? (
        <PromptTaskQueue key={taskQueue.id} queue={taskQueue.data} />
      ) : null}
      <div className="relative">
        {mentionQuery !== null ? (
          <MentionMenu
            targets={mentionTargets}
            query={mentionQuery}
            activeIndex={activeMentionIndex}
            includeDefaultAgentShortcut
            onSelect={selectMention}
          />
        ) : null}
        <PromptInput
          className={cn(
            "text-white transition-transform duration-300 ease-out focus-within:scale-[1.005] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:zoom-in-95 [&_[data-slot=input-group]]:min-h-14 [&_[data-slot=input-group]]:border-white/10 [&_[data-slot=input-group]]:!bg-[#262626] [&_[data-slot=input-group]]:px-2 dark:[&_[data-slot=input-group]]:!bg-[#262626]",
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
            <PromptInputTextarea
              ref={textareaRef}
              aria-label="Follow up"
              className="min-h-12 max-h-24 py-3 text-base text-white placeholder:text-white/75"
              value={composer.text}
              onChange={(event) => composer.setText(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Type a command, attach an .xlsx / .csv..."
              disabled={disabled}
            />
          </PromptInputBody>
          <PromptInputFooter className="px-2 pb-2">
            <PromptInputTools>
              <button
                type="button"
                onClick={() => {
                  if (!agentForcedOn) setAgentEnabled((value) => !value);
                }}
                aria-label="Send to agent"
                aria-pressed={effectiveAgentEnabled}
                title={agentToggleTitle}
                disabled={disabled || isSending || agentForcedOn}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-80",
                  effectiveAgentEnabled && "text-[#54a9ff]",
                )}
              >
                <Bot className="size-5" />
              </button>
              <AgentRuntimeIndicator
                agentEnabled={effectiveAgentEnabled}
                disabled={disabled || isSending}
                preference={runtimePreference}
                onPreferenceChange={setRuntimePreference}
                tone="dark"
              />
              <PromptInputButton
                type="button"
                variant="ghost"
                onClick={() => composer.setText(`${composer.text}@`)}
                aria-label="Mention"
                title="Mention"
                className="text-white hover:bg-white/10"
              >
                <AtSign className="h-4 w-4" />
              </PromptInputButton>
              <PromptInputAttachButton />
            </PromptInputTools>
            <div className="flex items-center gap-1">
              <PromptInputSpeechButton
                textareaRef={textareaRef}
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
    </div>
  );
}

function currentMentionQuery(content: string): string | null {
  const match = content.match(/(?:^|\s)@([\w.'-]*)$/u);
  return match ? match[1] : null;
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

function ThinkingRow({
  title,
  detail,
  ariaLabel,
  children,
}: {
  title: string;
  detail?: string;
  ariaLabel?: string;
  children?: ReactNode;
}) {
  // React.Children.toArray + filter Boolean handles arrays containing empty
  // arrays (truthy in plain JS) and falsy nodes correctly; a bare children.some
  // would render an empty container when rows=[] because Boolean([]) is true.
  const hasChildren = Children.toArray(children).some(Boolean);
  // Always defaults closed — preventing the content-shift the user
  // explicitly called out (action rows streaming in pushed the rest of the
  // page mid-read). Use the AI Elements Reasoning primitive so the turn-level
  // activity panel follows the same substrate as typed reasoning parts.
  return (
    <Reasoning
      defaultOpen={false}
      className="mb-0 w-fit text-muted-foreground"
      aria-label={ariaLabel}
    >
      <ReasoningTrigger
        className="gap-3 text-base [&>svg:first-child]:text-sky-400"
        getThinkingMessage={() => title}
      />
      {detail || hasChildren ? (
        <ReasoningContent className="ml-7 mt-2 max-w-none text-sm leading-6 text-muted-foreground">
          {detail ? <p className="max-w-xl">{detail}</p> : null}
          {hasChildren ? (
            <div className="mt-3 grid gap-2">{children}</div>
          ) : null}
        </ReasoningContent>
      ) : null}
    </Reasoning>
  );
}

function LocalPiConsole({
  entries,
}: {
  entries: DesktopLocalPiConsoleEntry[];
}) {
  const [open, setOpen] = useState(true);
  const outputRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const output = outputRef.current;
    if (!output) return;
    output.scrollTop = output.scrollHeight;
  }, [entries, open]);

  if (entries.length === 0) return null;

  const latest = entries.at(-1);
  const summary = `${entries.length} event${entries.length === 1 ? "" : "s"}`;

  return (
    <section
      className="w-full max-w-2xl rounded-lg border border-white/10 bg-muted/20 px-4 py-3 text-muted-foreground"
      aria-label="Local Pi console"
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 text-left text-sm transition-colors hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <SquareTerminal className="size-4 shrink-0" />
        <span className="font-medium">Local Pi console</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
          {latest ? `${summary} · ${latest.message}` : summary}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open ? (
        <pre
          ref={outputRef}
          role="log"
          aria-label="Local Pi console output"
          aria-live="polite"
          className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted-foreground/80"
        >
          {entries.map((entry) => formatLocalPiConsoleEntry(entry)).join("\n")}
        </pre>
      ) : null}
    </section>
  );
}

function formatLocalPiConsoleEntry(entry: DesktopLocalPiConsoleEntry): string {
  const timestamp = shortTime(entry.emittedAt);
  const prefix = [timestamp, entry.level, entry.source]
    .filter(Boolean)
    .join(" ");
  return `${prefix} ${entry.message}`;
}

function shortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ActionRow({
  title,
  detail,
  kind,
}: {
  title: string;
  detail?: string;
  kind: "thinking" | "tool" | "source" | "code";
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
    <details className="group/action w-fit text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-base transition-colors hover:text-foreground">
        <Icon className="size-4" />
        {title}
        <ChevronRight className="size-4 transition-transform group-open/action:rotate-90" />
      </summary>
      {detail ? (
        <pre className="ml-7 mt-2 max-w-2xl whitespace-pre-wrap rounded-lg bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
          {detail}
        </pre>
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

function actionRowsForTurn(
  turn: TaskThreadTurn,
  usage: Record<string, unknown>,
) {
  const rows: Array<{
    title: string;
    detail?: string;
    kind: "thinking" | "tool" | "source" | "code";
  }> = [];

  const toolsCalled = parseArray(usage.tools_called)
    .map((tool) => (typeof tool === "string" ? tool : null))
    .filter(Boolean) as string[];
  const toolInvocations = parseArray(usage.tool_invocations);
  const seen = new Set<string>();

  for (const invocation of toolInvocations) {
    const record = parseRecord(invocation);
    const name =
      stringValue(record.tool_name) ||
      stringValue(record.toolName) ||
      stringValue(record.name) ||
      "tool";
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      title: toolActionTitle(name),
      detail: toolInvocationDetail(record),
      kind: toolKind(name),
    });
  }

  for (const name of toolsCalled) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      title: toolActionTitle(name),
      kind: toolKind(name),
    });
  }

  const sortedEvents = [...(turn.events ?? [])].sort((a, b) => {
    const ta = parseEventTimestamp(a.createdAt);
    const tb = parseEventTimestamp(b.createdAt);
    if (ta !== tb) return ta - tb;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
  for (const event of sortedEvents) {
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
        const toolKey = toolName.toLowerCase();
        if (seen.has(toolKey)) continue;
        seen.add(toolKey);
      }
    }
    const key = `${event.eventType ?? row.title}:${row.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  return rows;
}

function actionRowForEvent(event: TaskThreadEvent) {
  const eventType = stringValue(event.eventType);
  if (!eventType) return null;
  const payload = parseRecord(event.payload);
  const detail = eventDetail(event, payload);

  if (eventType === "tool_invocation_started") {
    const toolName =
      stringValue(payload.tool_name) ||
      stringValue(payload.toolName) ||
      stringValue(payload.name) ||
      "tool";
    return {
      title: toolActionTitle(toolName),
      detail,
      kind: toolKind(toolName),
    };
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

function eventDetail(event: TaskThreadEvent, payload: Record<string, unknown>) {
  const detail = {
    ...(event.createdAt ? { createdAt: event.createdAt } : {}),
    ...(event.level ? { level: event.level } : {}),
    ...sanitizeEventPayload(payload),
  };
  return Object.keys(detail).length
    ? JSON.stringify(detail, null, 2)
    : undefined;
}

function sanitizeEventPayload(payload: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    sanitized[sanitizeEventPayloadKey(key)] = sanitizeEventPayloadValue(value);
  }
  return sanitized;
}

function sanitizeEventPayloadValue(value: unknown): unknown {
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
    "desktop-local": "Local Pi",
    desktop_local: "Local Pi",
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
    normalized.includes("crm")
  ) {
    return "source";
  }
  return "tool";
}

function toolActionTitle(name: string) {
  const normalized = name.toLowerCase();
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

function toolInvocationDetail(record: Record<string, unknown>) {
  const inputPreview = stringValue(record.input_preview);
  const outputPreview = stringValue(record.output_preview);
  const status = stringValue(record.status);
  const parts = [
    inputPreview ? `Input: ${inputPreview}` : null,
    outputPreview ? `Output: ${outputPreview}` : null,
    status ? `Status: ${status}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join("\n\n") : JSON.stringify(record, null, 2);
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
  parts: Array<{ url?: string; mediaType?: string; filename?: string }>,
): Promise<File[]> {
  if (!parts || parts.length === 0) return [];
  const files: File[] = [];
  for (const part of parts) {
    if (!part?.url) continue;
    try {
      const response = await fetch(part.url);
      const blob = await response.blob();
      files.push(
        new File([blob], part.filename ?? "attachment", {
          type: part.mediaType ?? blob.type ?? "application/octet-stream",
        }),
      );
    } catch (err) {
      console.warn(
        `[FollowUpComposer] failed to reify attached file ${part.filename}:`,
        err,
      );
    }
  }
  return files;
}
