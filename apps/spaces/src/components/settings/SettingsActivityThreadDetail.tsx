import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity,
  Bot,
  Brain,
  ChevronRight,
  Cpu,
  DollarSign,
  ExternalLink,
  FileText,
  User,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useQuery, useSubscription } from "urql";
import { Badge, Button, Separator, cn } from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { StatusBadge } from "@/components/StatusBadge";
import { SystemPromptSheet } from "@/components/SystemPromptSheet";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  ComputerThreadQuery,
  NewMessageSubscription,
  SettingsActivityThreadTracesQuery,
  SettingsActivityThreadTurnsQuery,
  ThreadTurnUpdatedSubscription,
  ThreadUpdatedSubscription,
} from "@/lib/graphql-queries";
import { formatDateTime, relativeTime } from "@/lib/utils";

const DETAIL_MESSAGE_LIMIT = 100;
const DETAIL_TURN_LIMIT = 50;
const CW_CONSOLE_BASE =
  "https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1";

export interface SettingsActivityBreadcrumb {
  label: string;
  href?: string;
  search?: Record<string, unknown>;
}

interface SettingsActivityThreadDetailProps {
  threadId: string;
  breadcrumbParents: SettingsActivityBreadcrumb[];
}

interface ThreadDetailResult {
  thread?: ActivityThread | null;
}

interface ActivityThread {
  id: string;
  agentId?: string | null;
  userId?: string | null;
  number?: number | null;
  identifier?: string | null;
  title?: string | null;
  status?: string | null;
  spaceId?: string | null;
  space?: { id: string; name?: string | null; slug?: string | null } | null;
  channel?: string | null;
  costSummary?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  messages?: {
    edges?: Array<{ node?: ActivityMessage | null } | null> | null;
  } | null;
}

interface ActivityMessage {
  id: string;
  role: string;
  content?: string | null;
  tokenCount?: number | null;
  createdAt?: string | null;
  sender?: {
    type?: string | null;
    id?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null;
}

interface ThreadTurnsResult {
  threadTurns?: ThreadTurn[] | null;
}

interface ThreadTurn {
  id: string;
  invocationSource?: string | null;
  triggerDetail?: string | null;
  triggerName?: string | null;
  turnNumber?: number | null;
  runtimeType?: string | null;
  status?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  errorCode?: string | null;
  resultJson?: unknown;
  usageJson?: unknown;
  totalCost?: number | null;
  retryAttempt?: number | null;
  originTurnId?: string | null;
  systemPrompt?: string | null;
  createdAt?: string | null;
}

interface ThreadTracesResult {
  threadTraces?: ThreadTrace[] | null;
}

interface ThreadTrace {
  traceId?: string | null;
  agentName?: string | null;
  runtimeType?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
  costUsd?: number | null;
  estimated?: boolean | null;
  createdAt?: string | null;
}

type TimelineEvent =
  | { kind: "message"; id: string; at: string; message: ActivityMessage }
  | { kind: "turn"; id: string; at: string; turn: ThreadTurn };

const TRIGGER_LABELS: Record<string, string> = {
  chat: "Manual chat",
  manual: "Manual chat",
  schedule: "Schedule",
  webhook: "Webhook",
  api: "Automation",
  email: "Email",
};

export function SettingsActivityThreadDetail({
  threadId,
  breadcrumbParents,
}: SettingsActivityThreadDetailProps) {
  const { tenantId } = useTenant();
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);

  const [
    { data: threadData, fetching: threadFetching, error: threadError },
    refetchThread,
  ] = useQuery<ThreadDetailResult>({
    query: ComputerThreadQuery,
    variables: { id: threadId, messageLimit: DETAIL_MESSAGE_LIMIT },
    pause: !threadId,
    requestPolicy: "cache-and-network",
  });

  const [{ data: turnsData, fetching: turnsFetching }, refetchTurns] =
    useQuery<ThreadTurnsResult>({
      query: SettingsActivityThreadTurnsQuery,
      variables: {
        tenantId: tenantId ?? "",
        threadId,
        limit: DETAIL_TURN_LIMIT,
      },
      pause: !tenantId || !threadId,
      requestPolicy: "cache-and-network",
    });

  const [{ data: tracesData }] = useQuery<ThreadTracesResult>({
    query: SettingsActivityThreadTracesQuery,
    variables: { tenantId: tenantId ?? "", threadId },
    pause: !tenantId || !threadId,
    requestPolicy: "cache-and-network",
  });

  const refetchAll = useCallback(() => {
    refetchThread({ requestPolicy: "network-only" });
    refetchTurns({ requestPolicy: "network-only" });
  }, [refetchThread, refetchTurns]);

  const [messageSub] = useSubscription({
    query: NewMessageSubscription,
    variables: { threadId },
    pause: !threadId,
  });
  useEffect(() => {
    if (messageSub.data?.onNewMessage?.threadId === threadId) refetchAll();
  }, [messageSub.data, refetchAll, threadId]);

  const [threadSub] = useSubscription({
    query: ThreadUpdatedSubscription,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  useEffect(() => {
    if (threadSub.data?.onThreadUpdated?.threadId === threadId) refetchAll();
  }, [refetchAll, threadId, threadSub.data]);

  const [turnSub] = useSubscription({
    query: ThreadTurnUpdatedSubscription,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  useEffect(() => {
    if (turnSub.data?.onThreadTurnUpdated?.threadId === threadId) refetchAll();
  }, [refetchAll, threadId, turnSub.data]);

  const thread = threadData?.thread ?? null;
  const turns = useMemo(
    () => [...(turnsData?.threadTurns ?? [])].sort(compareTurns),
    [turnsData?.threadTurns],
  );
  const messages = useMemo(
    () =>
      (thread?.messages?.edges ?? [])
        .map((edge) => edge?.node)
        .filter((node): node is ActivityMessage => Boolean(node)),
    [thread?.messages?.edges],
  );
  const timeline = useMemo(
    () => buildTimeline(messages, turns),
    [messages, turns],
  );
  const totalTokens = useMemo(
    () =>
      turns.reduce((sum, turn) => {
        const usage = parseUsage(turn.usageJson);
        return sum + usage.inputTokens + usage.outputTokens;
      }, 0),
    [turns],
  );
  const succeededTurns = turns.filter((turn) =>
    ["succeeded", "success", "completed", "done"].includes(
      (turn.status ?? "").toLowerCase(),
    ),
  ).length;
  const latestSystemPrompt =
    turns.find((turn) => turn.systemPrompt?.trim())?.systemPrompt ?? null;
  const title = thread?.title?.trim() || thread?.identifier || "Thread";
  const identifier = thread?.identifier || `THREAD-${threadId.slice(0, 8)}`;

  usePageHeaderActions({
    title,
    documentTitle: `Activity Thread · ${title}`,
    breadcrumbs: [...breadcrumbParents, { label: title }],
  });

  if (threadFetching && !thread) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }

  if (threadError) {
    return (
      <div className="p-6 text-sm text-destructive">{threadError.message}</div>
    );
  }

  if (!thread) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Thread not found.</div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="grid gap-8 p-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0">
          <div className="mb-8">
            <p className="mb-3 font-mono text-sm uppercase tracking-wide text-muted-foreground">
              {identifier}
            </p>
            <h1 className="max-w-4xl text-3xl font-semibold leading-tight text-foreground">
              {title}
            </h1>
          </div>

          <Separator className="mb-8" />

          <section className="mb-10">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Activity className="h-4 w-4" />
                Activity
              </h2>
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <Metric
                  icon={Cpu}
                  label={formatTurnCount(turns.length, succeededTurns)}
                />
                {totalTokens > 0 ? (
                  <Metric
                    icon={Zap}
                    label={`${formatTokens(totalTokens)} tokens`}
                  />
                ) : null}
                {thread.costSummary ? (
                  <Metric
                    icon={DollarSign}
                    label={formatUsd(thread.costSummary)}
                    strong
                  />
                ) : null}
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {timeline.length > 0 ? (
                timeline.map((event) =>
                  event.kind === "message" ? (
                    <MessageTimelineRow
                      key={event.id}
                      message={event.message}
                    />
                  ) : (
                    <TurnTimelineRow key={event.id} turn={event.turn} />
                  ),
                )
              ) : turnsFetching ? (
                <div className="flex justify-center py-12">
                  <LoadingShimmer />
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No activity recorded for this thread yet.
                </p>
              )}
            </div>
          </section>

          <ThreadTraces traces={tracesData?.threadTraces ?? []} />
        </main>

        <aside className="xl:pt-8">
          <ThreadProperties
            thread={thread}
            latestSystemPrompt={latestSystemPrompt}
            onViewSystemPrompt={() => setSystemPromptOpen(true)}
          />
        </aside>
      </div>

      <SystemPromptSheet
        titleSuffix={identifier}
        capturedSystemPrompt={latestSystemPrompt}
        open={systemPromptOpen}
        onOpenChange={setSystemPromptOpen}
        emptyDescription="No system prompt captured for this thread."
        emptyMessage="No system prompt available for this thread."
      />
    </div>
  );
}

function MessageTimelineRow({ message }: { message: ActivityMessage }) {
  const [expanded, setExpanded] = useState(false);
  const role = message.role.toUpperCase();
  const isUser = role === "USER";
  const label =
    message.sender?.displayName?.trim() || (isUser ? "User" : "ThinkWork");
  const content = message.content?.trim() || "(empty message)";

  return (
    <TimelineRow
      icon={isUser ? User : Bot}
      iconClassName={
        isUser ? "bg-blue-950/60 text-blue-400" : "bg-cyan-950/60 text-cyan-300"
      }
      title={label}
      subtitle={expanded ? null : content}
      time={message.createdAt}
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
      meta={
        message.tokenCount ? (
          <span>{formatTokens(message.tokenCount)} tokens</span>
        ) : null
      }
    >
      <MarkdownBlock content={content} />
    </TimelineRow>
  );
}

function TurnTimelineRow({ turn }: { turn: ThreadTurn }) {
  const [expanded, setExpanded] = useState(false);
  const usage = parseUsage(turn.usageJson);
  const duration = turnDurationMs(turn);

  return (
    <TimelineRow
      icon={Brain}
      iconClassName="bg-emerald-950/60 text-emerald-300"
      title="Thinking"
      subtitle={triggerLabel(turn.invocationSource, turn.triggerName)}
      time={turn.finishedAt ?? turn.startedAt ?? turn.createdAt}
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
      badge={runtimeLabel(turn.runtimeType)}
      meta={
        <>
          {usage.inputTokens || usage.outputTokens ? (
            <span>
              {formatTokens(usage.inputTokens)} -&gt;{" "}
              {formatTokens(usage.outputTokens)}
            </span>
          ) : null}
          {duration ? <span>{formatDuration(duration)}</span> : null}
          {turn.totalCost ? <span>{formatUsd(turn.totalCost)}</span> : null}
        </>
      }
    >
      <div className="space-y-3 text-sm text-muted-foreground">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="capitalize">
            {turn.status || "unknown"}
          </Badge>
          {turn.errorCode ? (
            <Badge
              variant="outline"
              className="border-destructive/50 text-destructive"
            >
              {turn.errorCode}
            </Badge>
          ) : null}
          {turn.retryAttempt ? (
            <Badge variant="outline">retry {turn.retryAttempt}</Badge>
          ) : null}
        </div>
        {turn.error ? <p className="text-destructive">{turn.error}</p> : null}
        {turn.triggerDetail ? <p>{turn.triggerDetail}</p> : null}
      </div>
    </TimelineRow>
  );
}

function TimelineRow({
  icon: Icon,
  iconClassName,
  title,
  subtitle,
  time,
  badge,
  meta,
  expanded,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  iconClassName: string;
  title: string;
  subtitle?: string | null;
  time?: string | null;
  badge?: string | null;
  meta?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/35"
      >
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 items-center justify-center rounded-full",
            iconClassName,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {title}
            </span>
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
            />
            {badge ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                {badge}
              </Badge>
            ) : null}
          </span>
          {subtitle ? (
            <span className="mt-1 block truncate text-sm text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
          {expanded ? <span className="mt-4 block">{children}</span> : null}
        </span>
        <span className="flex min-w-[8rem] flex-col items-end gap-1 text-xs text-muted-foreground">
          <span className="flex flex-wrap justify-end gap-3 tabular-nums">
            {meta}
          </span>
          {time ? <span>{relativeTime(time)}</span> : null}
        </span>
      </button>
    </div>
  );
}

function ThreadProperties({
  thread,
  latestSystemPrompt,
  onViewSystemPrompt,
}: {
  thread: ActivityThread;
  latestSystemPrompt: string | null;
  onViewSystemPrompt: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Properties
      </h2>
      <div className="space-y-4">
        <PropertyRow label="Status">
          <StatusBadge status={normalizeStatus(thread.status)} size="sm" />
        </PropertyRow>
        <PropertyRow label="Trigger">
          {triggerLabel(thread.channel)}
        </PropertyRow>
        <PropertyRow label="Space">
          <Badge variant="outline" className="max-w-36 truncate">
            {spaceDisplayName(thread)}
          </Badge>
        </PropertyRow>
        <PropertyRow label="System prompt">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2"
            onClick={onViewSystemPrompt}
            disabled={!latestSystemPrompt}
          >
            <FileText className="h-3.5 w-3.5" />
            View
          </Button>
        </PropertyRow>
        <PropertyRow label="Created">
          {thread.createdAt ? formatDateTime(thread.createdAt) : "--"}
        </PropertyRow>
        <PropertyRow label="Updated">
          {thread.updatedAt ? relativeTime(thread.updatedAt) : "--"}
        </PropertyRow>
      </div>
    </div>
  );
}

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 justify-self-end text-right text-foreground">
        {children}
      </div>
    </div>
  );
}

function ThreadTraces({ traces }: { traces: ThreadTrace[] }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="border-t border-border pt-6">
      <button
        type="button"
        className="mb-4 flex items-center gap-2 text-base font-semibold text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight
          className={cn("h-4 w-4 transition-transform", open && "rotate-90")}
        />
        Traces
      </button>
      {open ? (
        traces.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full table-fixed text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="w-24 px-3 py-2 text-left font-medium">Time</th>
                  <th className="w-32 px-3 py-2 text-left font-medium">
                    Agent
                  </th>
                  <th className="w-24 px-3 py-2 text-left font-medium">
                    Runtime
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Model</th>
                  <th className="w-20 px-3 py-2 text-right font-medium">In</th>
                  <th className="w-20 px-3 py-2 text-right font-medium">Out</th>
                  <th className="w-24 px-3 py-2 text-right font-medium">
                    Latency
                  </th>
                  <th className="w-24 px-3 py-2 text-right font-medium">
                    Cost
                  </th>
                  <th className="w-16 px-3 py-2 text-right font-medium">
                    Trace
                  </th>
                </tr>
              </thead>
              <tbody>
                {traces.map((trace, index) => (
                  <tr
                    key={`${trace.traceId ?? "trace"}-${index}`}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                      {trace.createdAt ? relativeTime(trace.createdAt) : "--"}
                    </td>
                    <td className="truncate px-3 py-2 text-xs font-medium">
                      {trace.agentName || "--"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px]"
                      >
                        {runtimeLabel(trace.runtimeType)}
                      </Badge>
                    </td>
                    <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                      {shortenModel(trace.model)}
                      {trace.estimated ? (
                        <Badge
                          variant="outline"
                          className="ml-1 px-1 text-[10px]"
                        >
                          est
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      {formatTokens(trace.inputTokens)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      {formatTokens(trace.outputTokens)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      {formatDuration(trace.durationMs)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      {formatUsd(trace.costUsd)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {trace.traceId ? (
                        <a
                          href={xrayTraceUrl(trace.traceId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Open trace"
                        >
                          <ExternalLink className="inline h-3.5 w-3.5" />
                        </a>
                      ) : (
                        "--"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-border py-6 text-center text-sm text-muted-foreground">
            No trace data for this thread yet.
          </p>
        )
      ) : null}
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  strong,
}: {
  icon: LucideIcon;
  label: string;
  strong?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        strong && "font-medium text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </span>
  );
}

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function buildTimeline(
  messages: ActivityMessage[],
  turns: ThreadTurn[],
): TimelineEvent[] {
  return [
    ...messages.map((message) => ({
      kind: "message" as const,
      id: `message-${message.id}`,
      at: message.createdAt ?? "",
      message,
    })),
    ...turns.map((turn) => ({
      kind: "turn" as const,
      id: `turn-${turn.id}`,
      at: turn.startedAt ?? turn.createdAt ?? turn.finishedAt ?? "",
      turn,
    })),
  ].sort((a, b) => dateValue(a.at) - dateValue(b.at));
}

function compareTurns(a: ThreadTurn, b: ThreadTurn) {
  const aTurn = a.turnNumber ?? 0;
  const bTurn = b.turnNumber ?? 0;
  if (aTurn !== bTurn) return aTurn - bTurn;
  return (
    dateValue(a.startedAt ?? a.createdAt) -
    dateValue(b.startedAt ?? b.createdAt)
  );
}

function parseUsage(value: unknown): {
  inputTokens: number;
  outputTokens: number;
} {
  const json = parseJsonObject(value);
  const inputTokens =
    numberFrom(json, "input_tokens") ??
    numberFrom(json, "inputTokens") ??
    numberFrom(json, "prompt_tokens") ??
    0;
  const outputTokens =
    numberFrom(json, "output_tokens") ??
    numberFrom(json, "outputTokens") ??
    numberFrom(json, "completion_tokens") ??
    0;
  return { inputTokens, outputTokens };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
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

function numberFrom(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const raw = value[key];
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function dateValue(value?: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function turnDurationMs(turn: ThreadTurn): number | null {
  const started = dateValue(turn.startedAt);
  const finished = dateValue(turn.finishedAt);
  if (started && finished && finished >= started) return finished - started;
  return null;
}

function triggerLabel(
  channel?: string | null,
  triggerName?: string | null,
): string {
  const trimmed = channel?.trim();
  if (!trimmed) return triggerName || "--";
  return TRIGGER_LABELS[trimmed.toLowerCase()] ?? trimmed;
}

function spaceDisplayName(thread: ActivityThread): string {
  return (
    thread.space?.name ||
    thread.space?.slug ||
    (thread.spaceId ? "Unknown Space" : "--")
  );
}

function normalizeStatus(status?: string | null): string {
  const normalized = (status || "unknown").toLowerCase();
  if (normalized === "completed") return "done";
  return normalized;
}

function runtimeLabel(runtimeType?: string | null): string {
  const trimmed = runtimeType?.trim();
  return trimmed ? trimmed.toUpperCase() : "--";
}

function formatTurnCount(turnCount: number, succeededTurns: number): string {
  return `${turnCount} turn${turnCount === 1 ? "" : "s"} (${succeededTurns} succeeded)`;
}

function formatTokens(value?: number | null): string {
  const n = value ?? 0;
  if (!n) return "--";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDuration(ms?: number | null): string {
  if (!ms) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatUsd(value?: number | null): string {
  const amount = value ?? 0;
  return `$${amount.toFixed(4)}`;
}

function shortenModel(model?: string | null): string {
  if (!model) return "--";
  return model
    .replace(/^us\.anthropic\./, "")
    .replace(/-\d{8,}-v\d+:\d+$/, "")
    .replace(/-v\d+:\d+$/, "");
}

function xrayTraceUrl(traceId: string): string {
  return `${CW_CONSOLE_BASE}#xray:traces/${traceId}`;
}
