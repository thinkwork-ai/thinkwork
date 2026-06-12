import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ChevronRight, ExternalLink, FileText, Info } from "lucide-react";
import { IconFiles } from "@tabler/icons-react";
import { useQuery, useSubscription } from "urql";
import { Badge, Button, cn } from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { StatusBadge } from "@/components/StatusBadge";
import { SystemPromptSheet } from "@/components/SystemPromptSheet";
import { ThreadWorkspaceView } from "@/components/workbench/ThreadWorkspaceView";
import {
  InlineShortcutText,
  shortcutDisplayText,
} from "@/components/workbench/InlineShortcutText";
import {
  ExecutionTrace,
  type ExecutionTraceModelRouteTrace,
} from "@/components/settings/SettingsActivityExecutionTrace";
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
  durableArtifact?: {
    id: string;
    title: string;
    type: string;
    status: string;
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
  requestId?: string | null;
  eventType?: string | null;
  agentName?: string | null;
  runtimeType?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
  costUsd?: number | null;
  estimated?: boolean | null;
  source?: string | null;
  parentRequestId?: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  profileRunId?: string | null;
  profileId?: string | null;
  profileSlug?: string | null;
  profileName?: string | null;
  laneKey?: string | null;
  profileStatus?: string | null;
  modelRoutingStatus?: string | null;
  ruleSource?: unknown;
  match?: unknown;
  metadata?: unknown;
  createdAt?: string | null;
}

const TRIGGER_LABELS: Record<string, string> = {
  chat: "Manual chat",
  manual: "Manual chat",
  schedule: "Schedule",
  webhook: "Webhook",
  api: "Automation",
  email: "Email",
};

function looksTruncatedTitle(value: string) {
  return /(?:\.{3}|…)\s*$/.test(value.trim());
}

export function SettingsActivityThreadDetail({
  threadId,
  breadcrumbParents,
}: SettingsActivityThreadDetailProps) {
  const { tenantId } = useTenant();
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [filesModeOpen, setFilesModeOpen] = useState(false);

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

  // Reset the workspace view when switching threads so a new thread opens on
  // its execution trace rather than inheriting the previous files-mode state.
  useEffect(() => {
    setFilesModeOpen(false);
  }, [threadId]);

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
  const executionMessages = useMemo(
    () =>
      messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content ?? null,
        senderType: message.sender?.type ?? null,
        senderId: message.sender?.id ?? null,
        createdAt: message.createdAt ?? thread?.createdAt ?? "",
        durableArtifact: message.durableArtifact ?? null,
      })),
    [messages, thread?.createdAt],
  );
  const userLabel =
    messages.find((message) => message.role.toUpperCase() === "USER")?.sender
      ?.displayName ?? "User";
  const latestSystemPrompt =
    turns.find((turn) => turn.systemPrompt?.trim())?.systemPrompt ?? null;
  const storedTitle = thread?.title?.trim() ?? "";
  const firstUserMessageContent =
    messages
      .find((message) => message.role.toUpperCase() === "USER")
      ?.content?.trim() ?? "";
  const title =
    storedTitle &&
    !(looksTruncatedTitle(storedTitle) && firstUserMessageContent)
      ? storedTitle
      : firstUserMessageContent || thread?.identifier || "Thread";
  const displayTitle = shortcutDisplayText(title, {
    fallbackAgentProfiles: true,
    fallbackMentions: true,
    fallbackSkills: true,
  });
  const identifier = thread?.identifier || `THREAD-${threadId.slice(0, 8)}`;

  usePageHeaderActions({
    title: displayTitle,
    documentTitle: `Activity Thread · ${displayTitle}`,
    breadcrumbs: [...breadcrumbParents, { label: displayTitle }],
    action: (
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8",
            filesModeOpen
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-label={
            filesModeOpen ? "Close thread files" : "Open thread files"
          }
          title={filesModeOpen ? "Close thread files" : "Open thread files"}
          onClick={() => {
            const nextOpen = !filesModeOpen;
            setFilesModeOpen(nextOpen);
            if (nextOpen) setPropertiesOpen(false);
          }}
        >
          <IconFiles className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8",
            propertiesOpen
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-label={
            propertiesOpen
              ? "Close thread properties"
              : "Open thread properties"
          }
          title={
            propertiesOpen
              ? "Close thread properties"
              : "Open thread properties"
          }
          onClick={() => setPropertiesOpen((open) => !open)}
        >
          <Info className="h-4 w-4" />
        </Button>
      </div>
    ),
    actionKey: `thread-actions-${filesModeOpen ? "files" : "trace"}-${propertiesOpen ? "props-open" : "props-closed"}`,
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

  if (filesModeOpen) {
    return (
      <div className="h-full min-h-0 w-full bg-background">
        <ThreadWorkspaceView threadId={threadId} />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto bg-background">
      <div
        className={cn(
          "grid w-full max-w-none gap-6 p-6",
          propertiesOpen && "md:grid-cols-[minmax(0,1fr)_320px]",
        )}
      >
        <main className="w-full min-w-0">
          <div className="mb-8">
            <h1 className="w-full max-w-none break-words text-xl font-semibold leading-snug text-foreground [text-wrap:wrap]">
              <InlineShortcutText
                text={title}
                fallbackAgentProfiles
                fallbackMentions
                fallbackSkills
              />
            </h1>
          </div>

          <section className="mb-10">
            {tenantId ? (
              <ExecutionTrace
                threadId={threadId}
                tenantId={tenantId}
                activityLabel={identifier}
                messages={executionMessages}
                defaultAgentName="ThinkWork"
                assistantLabel="ThinkWork"
                userLabel={userLabel}
                modelRouteTraces={
                  (tracesData?.threadTraces ??
                    []) as ExecutionTraceModelRouteTrace[]
                }
              />
            ) : turnsFetching ? (
              <div className="flex justify-center py-12">
                <LoadingShimmer />
              </div>
            ) : null}
          </section>

          <ThreadTraces traces={tracesData?.threadTraces ?? []} />
        </main>

        {propertiesOpen ? (
          <aside className="md:pt-8">
            <ThreadProperties
              thread={thread}
              latestSystemPrompt={latestSystemPrompt}
              onViewSystemPrompt={() => setSystemPromptOpen(true)}
            />
          </aside>
        ) : null}
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
                      {trace.profileName || trace.agentName || "--"}
                      {trace.laneKey ? (
                        <Badge
                          variant="outline"
                          className="ml-1 px-1 text-[10px] text-muted-foreground"
                        >
                          {trace.laneKey}
                        </Badge>
                      ) : null}
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

function compareTurns(a: ThreadTurn, b: ThreadTurn) {
  const aTurn = a.turnNumber ?? 0;
  const bTurn = b.turnNumber ?? 0;
  if (aTurn !== bTurn) return aTurn - bTurn;
  return (
    dateValue(a.startedAt ?? a.createdAt) -
    dateValue(b.startedAt ?? b.createdAt)
  );
}

function dateValue(value?: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
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
