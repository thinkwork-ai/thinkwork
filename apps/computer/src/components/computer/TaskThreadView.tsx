import {
  ArrowUp,
  Bot,
  ChevronRight,
  Code2,
  Database,
  ListChecks,
  Mic,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import {
  Children,
  useEffect,
  useRef,
  useState,
  type FormEvent,
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
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { IconPaperclip } from "@tabler/icons-react";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import { renderTypedParts } from "@/components/computer/render-typed-part";
import {
  TaskQueue,
  taskQueueFromRunbookQueue,
} from "@/components/runbooks/RunbookQueue";
import type {
  AccumulatedPart,
  UIMessageStreamState,
} from "@/lib/ui-message-merge";
import type {
  RunbookQueueData,
  TaskQueueData,
  TaskQueueGroup,
  TaskQueueItem,
} from "@/lib/ui-message-types";
import { useComposerState } from "@/lib/use-composer-state";
import { cn } from "@/lib/utils";
import { Button } from "@thinkwork/ui";
import {
  GeneratedArtifactCard,
  type GeneratedArtifact,
} from "@/components/computer/GeneratedArtifactCard";
import { StreamingMessageBuffer } from "@/components/computer/StreamingMessageBuffer";
import type { ComputerThreadChunk } from "@/lib/use-computer-thread-chunks";

const SHIMMER_TEXT = "Processing...";
const SHIMMER_CHAR_DURATION_MS = 120;

export interface TaskThreadMessage {
  id: string;
  role: string;
  content?: string | null;
  createdAt?: string | null;
  metadata?: unknown;
  toolCalls?: unknown;
  toolResults?: unknown;
  parts?: AccumulatedPart[];
  durableArtifact?: GeneratedArtifact | null;
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
  onSendFollowUp?: (content: string, files?: File[]) => Promise<void> | void;
}

export function TaskThreadView({
  thread,
  isLoading = false,
  error,
  streamingChunks = [],
  streamState,
  runbookQueues = [],
  isSending = false,
  onSendFollowUp,
}: TaskThreadViewProps) {
  if (isLoading) {
    return <TaskThreadState label="Loading thread" />;
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

  return (
    <main className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      <Conversation
        className="h-full flex-1 overflow-y-auto overscroll-contain"
        aria-label="Thread transcript"
      >
        <ConversationContent className="mx-auto grid w-full max-w-[750px] gap-3 px-4 pt-10 pb-32 sm:px-6">
          {transcriptMessages.length === 0 ? (
            <ThinkingRow
              title="Thinking"
              detail="Computer is preparing this thread."
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
                showProcessingShimmer={
                  index === latestUserIndex && showProcessingShimmer
                }
              />
            ))
          )}
          {showTaskQueueProcessingShimmer ? <ProcessingShimmer /> : null}
        </ConversationContent>
      </Conversation>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 sm:px-6">
        <div className="pointer-events-auto mx-auto w-full max-w-[750px] bg-background pb-4">
          <FollowUpComposer
            taskQueue={promptTaskQueue}
            disabled={!onSendFollowUp || isSending}
            isSending={isSending}
            onSubmit={onSendFollowUp}
          />
        </div>
      </div>
    </main>
  );
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
  showProcessingShimmer,
}: {
  message: TaskThreadMessage;
  turn?: TaskThreadTurn;
  isLatestUser: boolean;
  streamingChunks: ComputerThreadChunk[];
  streamState?: UIMessageStreamState;
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
      <TranscriptMessage message={message} />
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
                  aria-label="Computer is typing"
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

function TranscriptMessage({ message }: { message: TaskThreadMessage }) {
  const role = message.role.toUpperCase();
  const isUser = role === "USER";
  const actions = actionRowsForMessage(message);
  const body = message.content?.trim() ?? "";
  const typedParts = !isUser ? (message.parts ?? []) : [];
  const renderedTypedParts =
    typedParts.length > 0
      ? renderTypedParts(typedParts, { keyPrefix: message.id }).filter(Boolean)
      : [];

  return (
    <Message
      from={toAiMessageRole(message.role)}
      className={isUser ? "max-w-[78%]" : "max-w-full"}
      data-message-role={isUser ? "user" : "assistant"}
    >
      <MessageContent
        className={
          isUser
            ? "rounded-2xl bg-muted/70 px-5 py-3 text-base leading-7 text-foreground"
            : "grid w-full gap-3 overflow-visible"
        }
      >
        {isUser ? (
          body || "(No message content)"
        ) : (
          <>
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
            {message.durableArtifact ? (
              <GeneratedArtifactCard artifact={message.durableArtifact} />
            ) : null}
          </>
        )}
      </MessageContent>
    </Message>
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

function toAiMessageRole(role: string): "user" | "assistant" | "system" {
  const normalized = role.toLowerCase();
  if (normalized === "user" || normalized === "system") return normalized;
  return "assistant";
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
  taskQueue,
  disabled,
  isSending,
  onSubmit,
}: {
  taskQueue?: ActiveTaskQueue | null;
  disabled?: boolean;
  isSending?: boolean;
  onSubmit?: (content: string, files?: File[]) => Promise<void> | void;
}) {
  const composer = useComposerState(null);
  const canSubmit =
    (composer.text.trim().length > 0 || composer.files.length > 0) &&
    !disabled &&
    !isSending;

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
      await onSubmit(composer.text.trim(), files);
      composer.clear();
    } catch (err) {
      composer.setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      composer.setSubmitting(false);
    }
  }

  const hasTaskQueue = Boolean(taskQueue);

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
            aria-label="Follow up"
            className="min-h-12 max-h-24 py-3 text-base text-white placeholder:text-white/75"
            value={composer.text}
            onChange={(event) => composer.setText(event.target.value)}
            placeholder="Type a command, attach an .xlsx / .csv..."
            disabled={disabled}
          />
        </PromptInputBody>
        <PromptInputFooter className="px-2 pb-2">
          <PromptInputTools>
            <PromptInputAttachButton />
          </PromptInputTools>
          <PromptInputSubmit
            className="shrink-0 rounded-full bg-zinc-100 text-zinc-950 hover:bg-white disabled:bg-zinc-500 disabled:text-zinc-200"
            disabled={!canSubmit}
            status={isSending ? "submitted" : undefined}
            aria-label={isSending ? "Sending" : "Send"}
          />
        </PromptInputFooter>
      </PromptInput>
      {composer.error ? (
        <p className="text-sm text-destructive">{composer.error}</p>
      ) : null}
    </div>
  );
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
        .replace(/^computer_task_/, "Computer run ")
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
  return parts.length > 0 ? parts.join(" · ") : "Computer is working.";
}

function formatInvocationSource(source: unknown) {
  const raw = stringValue(source);
  if (!raw) return null;
  const labels: Record<string, string> = {
    chat: "Manual chat",
    chat_message: "Manual chat",
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
      <p
        className={
          tone === "error" ? "text-destructive" : "text-muted-foreground"
        }
      >
        {label}
      </p>
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
