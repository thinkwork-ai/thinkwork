import { memo, useEffect, useRef, useState, lazy, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuth } from "@/context/AuthContext";
import { useQuery, useMutation, useSubscription } from "urql";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { graphql } from "@/gql";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Form, FormField, FormItem, FormControl } from "@/components/ui/form";
import { formatCost } from "@/lib/activity-utils";
import { ThreadTurnsForThreadQuery, ThreadTurnEventsQuery, OnThreadTurnUpdatedSubscription } from "@/lib/graphql-queries";
import { formatDateTime, relativeTime } from "@/lib/utils";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Cpu,
  DollarSign,
  FileText,
  Loader2,
  MessageSquare,
  SkipForward,
  User,
  Bot,
  Zap,
  Maximize2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  succeeded: { icon: CheckCircle2, color: "text-green-500", label: "Succeeded" },
  failed: { icon: AlertCircle, color: "text-red-500", label: "Failed" },
  running: { icon: Loader2, color: "text-blue-500", label: "Running" },
  skipped: { icon: SkipForward, color: "text-muted-foreground", label: "Skipped" },
  cancelled: { icon: AlertCircle, color: "text-muted-foreground", label: "Cancelled" },
};

function parseJsonField(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return null; } }
  return raw as Record<string, unknown>;
}

function formatDuration(ms: number | undefined | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatTokens(n: unknown): string {
  const num = Number(n);
  if (!num) return "0";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

// ─── Turn Events ────────────────────────────────────────────────────────────

function TurnEvents({ runId }: { runId: string }) {
  const [result] = useQuery({
    query: ThreadTurnEventsQuery,
    variables: { runId, limit: 50 },
  });

  const events = (result.data as any)?.threadTurnEvents ?? [];
  if (events.length === 0) return <p className="text-xs text-muted-foreground pl-6">No events recorded.</p>;

  return (
    <div className="pl-6 space-y-1">
      {events.map((evt: any) => {
        const payload = parseJsonField(evt.payload);
        return (
          <div key={evt.id} className="flex items-start gap-2 text-xs">
            <span className="shrink-0 font-mono text-muted-foreground w-5 text-right">{evt.seq}</span>
            <EventBadge type={evt.eventType} level={evt.level} />
            <span className="text-foreground">{evt.message || evt.eventType}</span>
            {payload && Object.keys(payload).length > 0 && (
              <span className="text-muted-foreground truncate max-w-[300px]">
                {evt.eventType === "signal" && payload.signal
                  ? `signal: ${payload.signal}`
                  : evt.eventType === "completed" && payload.duration_ms
                    ? `${formatDuration(payload.duration_ms as number)}, ${payload.response_length ?? 0} chars`
                    : evt.eventType === "error"
                      ? String(payload.error || "").slice(0, 80)
                      : ""}
              </span>
            )}
            <span className="ml-auto text-muted-foreground shrink-0 pr-4">{relativeTime(evt.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}

function EventBadge({ type, level }: { type: string; level?: string }) {
  const colors: Record<string, string> = {
    started: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    completed: "bg-green-500/15 text-green-600 dark:text-green-400",
    signal: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    error: "bg-red-500/15 text-red-600 dark:text-red-400",
    turn_loop: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${colors[type] || "bg-muted text-muted-foreground"}`}>
      {type}
    </span>
  );
}

// ─── Single Turn Row ────────────────────────────────────────────────────────

function TurnRow({ turn }: { turn: any }) {
  const [open, setOpen] = useState(false);
  const [detailDialog, setDetailDialog] = useState<{ title: string; content: string } | null>(null);
  const usage = parseJsonField(turn.usageJson);
  const result = parseJsonField(turn.resultJson);
  const cfg = statusConfig[turn.status] || statusConfig.failed;
  const StatusIcon = cfg.icon;

  const durationMs = usage?.duration_ms as number | undefined;
  const inputTokens = usage?.input_tokens;
  const outputTokens = usage?.output_tokens;
  const cachedTokens = usage?.cached_read_tokens;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors rounded-md text-sm group">
          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-muted">
            <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${cfg.color} ${turn.status === "running" ? "animate-spin" : ""}`} />
          </div>

          {/* Source label */}
          <span className="font-medium truncate">
            {turn.triggerName || turn.invocationSource?.replace(/_/g, " ") || "invocation"}
          </span>
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}

          {turn.turnNumber && (
            <span className="text-xs text-muted-foreground">Turn #{turn.turnNumber}</span>
          )}

          {turn.retryAttempt > 0 && (
            <Badge variant="secondary" className="text-[10px]">retry #{turn.retryAttempt}</Badge>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Metrics row */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
            {inputTokens != null && (
              <span className="flex items-center gap-0.5" title="Input / Output tokens">
                <Zap className="h-3 w-3" />
                {formatTokens(inputTokens)} → {formatTokens(outputTokens)}
                {cachedTokens ? ` (${formatTokens(cachedTokens)} cached)` : ""}
              </span>
            )}
            {durationMs != null && (
              <span className="flex items-center gap-0.5" title="Duration">
                <Clock className="h-3 w-3" />
                {formatDuration(durationMs)}
              </span>
            )}
            {turn.totalCost != null && turn.totalCost > 0 && (
              <span className="flex items-center gap-0.5 font-medium" title="Cost">
                <DollarSign className="h-3 w-3" />
                {formatCost(turn.totalCost)}
              </span>
            )}
            <span className="w-16 text-right">{relativeTime(turn.startedAt || turn.createdAt)}</span>
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="ml-7 pl-2 py-2 space-y-3">
          {/* Summary info at top */}
          <div className="px-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground font-mono">
            <span>ID: {turn.id.slice(0, 8)}</span>
            {turn.startedAt && <span>Started: {formatDateTime(turn.startedAt)}</span>}
            {turn.finishedAt && <span>Finished: {formatDateTime(turn.finishedAt)}</span>}
            {turn.invocationSource && <span>Source: {turn.invocationSource}</span>}
          </div>

          {/* Error */}
          {turn.error && (
            <div className="px-3 py-2 rounded bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-mono">
              {turn.error}
            </div>
          )}

        </div>
      </CollapsibleContent>

      {/* Detail viewer dialog */}
      <Dialog open={!!detailDialog} onOpenChange={(open) => { if (!open) setDetailDialog(null); }}>
        <DialogContent className="h-[85vh] flex flex-col" style={{ width: "90vw", maxWidth: 900 }}>
          <DialogHeader>
            <div className="flex items-center justify-between pr-8">
              <DialogTitle className="text-sm font-medium font-mono">{detailDialog?.title}</DialogTitle>
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
                onClick={() => {
                  if (!detailDialog) return;
                  const content = detailDialog.content;
                  // Try to find and prettify JSON blocks in the content
                  const prettified = content.replace(
                    /(\{[\s\S]*\}|\[[\s\S]*\])/g,
                    (match) => {
                      try {
                        return JSON.stringify(JSON.parse(match), null, 2);
                      } catch {
                        return match;
                      }
                    },
                  );
                  setDetailDialog({ ...detailDialog, content: prettified });
                }}
              >
                Prettify JSON
              </button>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <pre className="text-xs font-mono whitespace-pre-wrap p-4 bg-muted rounded-md">
              {detailDialog?.content}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}

// ─── Comment Row (inline in timeline) ────────────────────────────────────────

interface ThreadComment {
  id: string;
  authorType?: string | null;
  authorId?: string | null;
  content: string;
  createdAt: string;
}

interface AgentRef {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

const CommentRow = memo(function CommentRow({
  comment,
  agentMap,
  userName,
  highlighted,
}: {
  comment: ThreadComment;
  agentMap?: Map<string, AgentRef>;
  userName?: string;
  highlighted?: boolean;
}) {
  const isAgent = comment.authorType === "agent";
  const isSystem = comment.authorType === "system";
  const agent = isAgent && comment.authorId ? agentMap?.get(comment.authorId) : null;

  let authorName = userName || "You";
  if (isSystem) authorName = "System";
  else if (isAgent) authorName = agent?.name ?? comment.authorId?.slice(0, 8) ?? "Agent";

  return (
    <div
      id={`comment-${comment.id}`}
      className={`flex gap-3 px-4 py-3 transition-colors duration-1000 ${
        highlighted ? "bg-primary/5" : ""
      }`}
    >
      <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-muted">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium">{authorName}</span>
          <span className="ml-auto text-xs text-muted-foreground shrink-0">{relativeTime(comment.createdAt)}</span>
        </div>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{comment.content}</p>
      </div>
    </div>
  );
});

// ─── Comment Form ────────────────────────────────────────────────────────────

const AddThreadCommentMutation = graphql(`
  mutation AddThreadCommentActivity($input: AddThreadCommentInput!) {
    addThreadComment(input: $input) {
      id
      authorType
      authorId
      content
      createdAt
    }
  }
`);

const CLOSED_STATUSES = new Set(["done", "cancelled"]);
const DRAFT_DEBOUNCE_MS = 800;

function loadDraft(draftKey: string): string {
  try { return localStorage.getItem(draftKey) ?? ""; } catch { return ""; }
}
function saveDraft(draftKey: string, value: string) {
  try {
    if (value.trim()) localStorage.setItem(draftKey, value);
    else localStorage.removeItem(draftKey);
  } catch { /* ignore */ }
}
function clearDraft(draftKey: string) {
  try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
}

const commentSchema = z.object({ body: z.string().min(1), reopen: z.boolean() });
type CommentFormValues = z.infer<typeof commentSchema>;

function CommentForm({
  threadId,
  threadStatus,
  draftKey,
  onCommentAdded,
}: {
  threadId: string;
  threadStatus?: string;
  draftKey?: string;
  onCommentAdded?: () => void;
}) {
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [{ fetching }, addComment] = useMutation(AddThreadCommentMutation);
  const isClosed = threadStatus ? CLOSED_STATUSES.has(threadStatus.toLowerCase().replace(/ /g, "_")) : false;

  const form = useForm<CommentFormValues>({
    resolver: zodResolver(commentSchema),
    defaultValues: { body: "", reopen: true },
  });

  const bodyValue = form.watch("body");

  useEffect(() => {
    if (!draftKey) return;
    const draft = loadDraft(draftKey);
    if (draft) form.setValue("body", draft);
  }, [draftKey, form]);

  useEffect(() => {
    if (!draftKey) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => saveDraft(draftKey, bodyValue), DRAFT_DEBOUNCE_MS);
  }, [bodyValue, draftKey]);

  useEffect(() => () => { if (draftTimer.current) clearTimeout(draftTimer.current); }, []);

  async function handleSubmit(values: CommentFormValues) {
    const trimmed = values.body.trim();
    if (!trimmed) return;
    const result = await addComment({ input: { threadId: threadId, content: trimmed } });
    if (!result.error) {
      form.reset({ body: "", reopen: false });
      if (draftKey) clearDraft(draftKey);
      onCommentAdded?.();
    }
  }

  const canSubmit = !fetching && !!bodyValue.trim();

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-2">
        <FormField
          control={form.control}
          name="body"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Textarea
                  placeholder="Leave a comment..."
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void form.handleSubmit(handleSubmit)();
                    }
                  }}
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <div className="flex items-center justify-end gap-3">
          {isClosed && (
            <FormField
              control={form.control}
              name="reopen"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    Re-open
                  </label>
                </FormItem>
              )}
            />
          )}
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {fetching ? "Posting..." : "Comment"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ─── Message Row (chat messages in timeline) ────────────────────────────────

const MessageRow = memo(function MessageRow({
  message,
  agentMap,
  onOpenArtifact,
}: {
  message: ChatMessage;
  agentMap?: Map<string, AgentRef>;
  onOpenArtifact?: (artifact: { id: string; title: string; type: string; status: string }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isUser = message.role.toLowerCase() === "user";
  const Icon = isUser ? User : Bot;
  const label = isUser ? "User" : (message.senderId && agentMap?.get(message.senderId)?.name) || "Agent";
  const content = (message.content || "").trim();
  const firstLine = content.split("\n")[0].slice(0, 120);
  const isLong = content.length > firstLine.length + 5;
  const artifact = message.durableArtifact;

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex gap-3 px-4 py-3">
      <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${isUser ? "bg-blue-500/10 text-blue-500" : "bg-primary/10 text-primary"}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        <div
          className={`flex items-center gap-2 mb-0.5 ${isLong ? "cursor-pointer" : ""}`}
          onClick={isLong ? () => setExpanded((v) => !v) : undefined}
        >
          <span className="text-sm font-medium">{label}</span>
          {isLong && (
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "" : "-rotate-90"}`} />
          )}
          <span className="ml-auto text-xs text-muted-foreground shrink-0">{relativeTime(message.createdAt)}</span>
        </div>
        {expanded ? (
          <>
            <div className="text-sm text-muted-foreground prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-2 max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
            {!isUser && (
              <div className="flex justify-end mt-1">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="p-1 rounded hover:bg-accent transition-colors"
                  title="Copy message"
                >
                  {copied
                    ? <Check className="h-3.5 w-3.5 text-green-500" />
                    : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground line-clamp-1 break-all">
            {firstLine}
          </p>
        )}
        {artifact && onOpenArtifact && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenArtifact(artifact); }}
            className="flex items-center gap-2 mt-2 px-3 py-2 rounded-md border border-border hover:bg-accent/40 transition-colors text-left w-full"
          >
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm font-medium text-primary truncate">{artifact.title}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground ml-auto" />
          </button>
        )}
      </div>
    </div>
  );
});

// ─── Timeline item type ──────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: string;
  content: string | null;
  senderType?: string | null;
  senderId?: string | null;
  createdAt: string;
  durableArtifact?: {
    id: string;
    title: string;
    type: string;
    status: string;
  } | null;
}

type TimelineItem =
  | { kind: "turn"; turn: any; sortDate: number }
  | { kind: "comment"; comment: ThreadComment; sortDate: number }
  | { kind: "message"; message: ChatMessage; sortDate: number };

// ─── Main Component ─────────────────────────────────────────────────────────

interface ExecutionTraceProps {
  threadId: string;
  tenantId: string;
  comments?: ThreadComment[];
  messages?: ChatMessage[];
  agentMap?: Map<string, AgentRef>;
  threadStatus?: string;
  draftKey?: string;
  onCommentAdded?: () => void;
  onOpenArtifact?: (artifact: { id: string; title: string; type: string; status: string }) => void;
}

export function ExecutionTrace({
  threadId,
  tenantId,
  comments = [],
  messages = [],
  agentMap,
  threadStatus,
  draftKey,
  onCommentAdded,
  onOpenArtifact,
}: ExecutionTraceProps) {
  const { user } = useAuth();
  const [highlightCommentId, setHighlightCommentId] = useState<string | null>(null);
  const hasScrolledRef = useRef(false);

  const [result, reexecuteTurns] = useQuery({
    query: ThreadTurnsForThreadQuery,
    variables: { tenantId, threadId: threadId, limit: 50 },
  });

  // Refetch turns when subscription notifies of a change for this thread
  const [turnSub] = useSubscription({
    query: OnThreadTurnUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });
  useEffect(() => {
    if ((turnSub.data as any)?.onThreadTurnUpdated?.threadId === threadId) {
      reexecuteTurns({ requestPolicy: "network-only" });
    }
  }, [turnSub.data, threadId, reexecuteTurns]);

  // Scroll to comment when URL hash matches #comment-{id}
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#comment-") || comments.length === 0) return;
    const commentId = hash.slice("#comment-".length);
    if (hasScrolledRef.current) return;
    const el = document.getElementById(`comment-${commentId}`);
    if (el) {
      hasScrolledRef.current = true;
      setHighlightCommentId(commentId);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const timer = setTimeout(() => setHighlightCommentId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [comments]);

  const turns = (result.data as any)?.threadTurns ?? [];

  // Build merged timeline (turns + comments + messages sorted by date)
  const timeline: TimelineItem[] = [
    ...turns.map((t: any) => ({
      kind: "turn" as const,
      turn: t,
      sortDate: new Date(t.startedAt || t.createdAt).getTime(),
    })),
    ...comments.map((c) => ({
      kind: "comment" as const,
      comment: c,
      sortDate: new Date(c.createdAt).getTime(),
    })),
    ...messages.map((m) => ({
      kind: "message" as const,
      message: m,
      sortDate: new Date(m.createdAt).getTime(),
    })),
  ].sort((a, b) => a.sortDate - b.sortDate);

  // Aggregate turn stats
  const totalCost = turns.reduce((sum: number, t: any) => sum + (t.totalCost || 0), 0);
  const totalTurns = turns.length;
  const succeededTurns = turns.filter((t: any) => t.status === "succeeded").length;
  const totalTokens = turns.reduce((sum: number, t: any) => {
    const u = parseJsonField(t.usageJson);
    return sum + (Number(u?.input_tokens) || 0) + (Number(u?.output_tokens) || 0);
  }, 0);

  const activityHeader = (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-medium flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5" />
        Activity
      </h3>
      {totalTurns > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Cpu className="h-3.5 w-3.5" />
            {totalTurns} turn{totalTurns !== 1 ? "s" : ""} ({succeededTurns} succeeded)
          </span>
          {totalTokens > 0 && (
            <span className="flex items-center gap-1">
              <Zap className="h-3.5 w-3.5" />
              {formatTokens(totalTokens)} tokens
            </span>
          )}
          {totalCost > 0 && (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <DollarSign className="h-3.5 w-3.5" />
              {formatCost(totalCost)}
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (result.fetching) {
    return (
      <div className="space-y-3">
        {activityHeader}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activityHeader}

      {timeline.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No activity yet.</p>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {timeline.map((item) =>
            item.kind === "turn" ? (
              <TurnRow key={item.turn.id} turn={item.turn} />
            ) : item.kind === "message" ? (
              <MessageRow key={item.message.id} message={item.message} agentMap={agentMap} onOpenArtifact={onOpenArtifact} />
            ) : (
              <CommentRow
                key={item.comment.id}
                comment={item.comment}
                agentMap={agentMap}
                userName={user?.name}
                highlighted={highlightCommentId === item.comment.id}
              />
            ),
          )}
        </div>
      )}

      {/* Comment input */}
      <CommentForm
        threadId={threadId}
        threadStatus={threadStatus}
        draftKey={draftKey}
        onCommentAdded={onCommentAdded}
      />
    </div>
  );
}
