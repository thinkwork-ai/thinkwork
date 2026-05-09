import {
  ArrowUp,
  Bot,
  Brain,
  ChevronRight,
  Code2,
  Database,
  Mic,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import {
  Children,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Streamdown } from "streamdown";
import { Button, Textarea } from "@thinkwork/ui";
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
  isSending?: boolean;
  onSendFollowUp?: (content: string) => Promise<void> | void;
}

export function TaskThreadView({
  thread,
  isLoading = false,
  error,
  streamingChunks = [],
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
  const showStreamingBuffer =
    streamingChunks.length > 0 && !hasAssistantAfterLatestUser(visibleMessages);
  const showProcessingShimmer =
    !showStreamingBuffer &&
    isAwaitingAssistantResponse(thread, visibleMessages);
  const latestUserIndex = findLastIndex(
    visibleMessages,
    (message) => message.role.toUpperCase() === "USER",
  );
  const turnByUserMessageId = mapTurnsToUserMessages(
    visibleMessages,
    thread.turns ?? [],
  );

  return (
    <main className="flex h-full w-full flex-col overflow-hidden bg-background">
      <section
        className="flex-1 overflow-y-auto overscroll-contain"
        aria-label="Thread transcript"
      >
        <div className="mx-auto grid w-full max-w-[750px] gap-5 px-4 pt-10 pb-6 sm:px-6">
          {visibleMessages.length === 0 ? (
            <ThinkingRow
              title="Thinking"
              detail="Computer is preparing this thread."
              isActive={isThreadRunning(thread)}
            />
          ) : (
            visibleMessages.map((message, index) => (
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
                showProcessingShimmer={
                  index === latestUserIndex && showProcessingShimmer
                }
              />
            ))
          )}
        </div>
      </section>

      <div className="shrink-0 px-4 pb-4 sm:px-6">
        <div className="mx-auto w-full max-w-[750px]">
          <FollowUpComposer
            disabled={!onSendFollowUp || isSending}
            isSending={isSending}
            onSubmit={onSendFollowUp}
          />
        </div>
      </div>
    </main>
  );
}

function TranscriptSegment({
  message,
  turn,
  isLatestUser,
  streamingChunks,
  showProcessingShimmer,
}: {
  message: TaskThreadMessage;
  turn?: TaskThreadTurn;
  isLatestUser: boolean;
  streamingChunks: ComputerThreadChunk[];
  showProcessingShimmer: boolean;
}) {
  return (
    <>
      <TranscriptMessage message={message} />
      {turn ? <ThreadTurnActivity turn={turn} /> : null}
      {isLatestUser ? (
        <>
          {streamingChunks.length > 0 ? (
            <StreamingMessageBuffer chunks={streamingChunks} />
          ) : null}
          {showProcessingShimmer ? <ProcessingShimmer /> : null}
        </>
      ) : null}
    </>
  );
}

const EXPANDED_TURN_STATUSES = new Set([
  "running",
  "pending",
  "queued",
  "claimed",
]);
const RENDERED_TURN_STATUSES = new Set([
  ...EXPANDED_TURN_STATUSES,
  "completed",
  "succeeded",
  "failed",
]);

function normalizeStatus(status: unknown) {
  return String(status ?? "")
    .toLowerCase()
    .trim();
}

function isExpandedStatus(status: string) {
  return EXPANDED_TURN_STATUSES.has(status);
}

function shouldDefaultOpen(turn: TaskThreadTurn) {
  return isExpandedStatus(normalizeStatus(turn.status)) || Boolean(turn.error);
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

  const expanded = isExpandedStatus(status);
  const defaultOpen = shouldDefaultOpen(turn);

  return (
    <ThinkingRow
      key={defaultOpen ? "open" : "closed"}
      title="Thinking"
      detail={turnSummary(turn, usage)}
      isActive={expanded}
      defaultOpen={defaultOpen}
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

  const latestCompletedTurn = (thread.turns ?? []).find((turn) =>
    ["completed", "succeeded"].includes(
      String(turn.status ?? "").toLowerCase(),
    ),
  );
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

  return (
    <article className={isUser ? "ml-auto max-w-[78%]" : "grid gap-5"}>
      {isUser ? (
        <div className="rounded-2xl bg-muted/70 px-5 py-3 text-base leading-7 text-foreground">
          {body || "(No message content)"}
        </div>
      ) : (
        <>
          {actions.length > 0 ? (
            <div className="grid gap-2">
              {actions.map((action) => (
                <ActionRow key={`${message.id}-${action.title}`} {...action} />
              ))}
            </div>
          ) : null}
          <div className="prose prose-invert max-w-none text-[1.05rem] text-foreground prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold prose-strong:font-semibold prose-hr:my-4">
            {body ? (
              <Streamdown>{body}</Streamdown>
            ) : (
              <p>(No message content)</p>
            )}
          </div>
          {message.durableArtifact ? (
            <GeneratedArtifactCard artifact={message.durableArtifact} />
          ) : null}
        </>
      )}
    </article>
  );
}

function FollowUpComposer({
  disabled,
  isSending,
  onSubmit,
}: {
  disabled?: boolean;
  isSending?: boolean;
  onSubmit?: (content: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSubmit = value.trim().length > 0 && !disabled && !isSending;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "32px";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 32), 160)}px`;
  }, [value]);

  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSubmit || !onSubmit) return;
    setError(null);
    try {
      await onSubmit(value.trim());
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    }
  }

  return (
    <form
      className="grid gap-3 rounded-2xl border border-border/80 bg-background p-3 shadow-lg transition-transform duration-300 ease-out focus-within:scale-[1.005] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:zoom-in-95 dark:bg-input/95"
      onSubmit={handleSubmit}
    >
      <Textarea
        ref={textareaRef}
        aria-label="Follow up"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            void handleSubmit();
          }
        }}
        placeholder="Type a command..."
        rows={1}
        className="field-sizing-fixed h-8 max-h-40 min-h-8 resize-none overflow-hidden border-0 bg-transparent px-1 py-1 text-lg leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
        disabled={disabled || isSending}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" disabled>
            <Plus className="size-5" />
            <span className="sr-only">Add source</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-2 rounded-full"
            disabled
          >
            <Search className="size-4" />
            Search
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" disabled>
            <Mic className="size-4" />
            <span className="sr-only">Voice input</span>
          </Button>
          <Button
            type="submit"
            size="icon"
            className="rounded-full"
            disabled={!canSubmit}
            aria-label={isSending ? "Sending" : "Send"}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}

function ThinkingRow({
  title,
  detail,
  isActive = false,
  defaultOpen = false,
  ariaLabel,
  children,
}: {
  title: string;
  detail?: string;
  isActive?: boolean;
  defaultOpen?: boolean;
  ariaLabel?: string;
  children?: ReactNode;
}) {
  // React.Children.toArray + filter Boolean handles arrays containing empty
  // arrays (truthy in plain JS) and falsy nodes correctly; a bare children.some
  // would render an empty container when rows=[] because Boolean([]) is true.
  const hasChildren = Children.toArray(children).some(Boolean);
  return (
    <details
      className="group/thinking w-fit text-muted-foreground"
      open={defaultOpen}
      aria-label={ariaLabel}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 text-base">
        <Brain
          aria-hidden="true"
          className={
            isActive
              ? "size-4 text-sky-400 animate-pulse"
              : "size-4 text-sky-400"
          }
        />
        {title}
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform group-open/thinking:rotate-90"
        />
      </summary>
      {detail ? (
        <p className="ml-7 mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          {detail}
        </p>
      ) : null}
      {hasChildren ? (
        <div className="ml-7 mt-3 grid gap-2">{children}</div>
      ) : null}
    </details>
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
      <summary className="flex cursor-pointer list-none items-center gap-3 text-base">
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

function isThreadRunning(thread: TaskThread) {
  return String(thread.lifecycleStatus ?? thread.status ?? "")
    .toLowerCase()
    .includes("running");
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
