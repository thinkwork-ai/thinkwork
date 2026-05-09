import {
  ArrowLeft,
  ArrowUp,
  Bot,
  ChevronRight,
  Code2,
  Database,
  Mic,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Textarea } from "@thinkwork/ui";
import {
  GeneratedArtifactCard,
  type GeneratedArtifact,
} from "@/components/computer/GeneratedArtifactCard";
import { SourceCountButton } from "@/components/computer/SourceCountButton";
import { StreamingMessageBuffer } from "@/components/computer/StreamingMessageBuffer";
import { UsageButton } from "@/components/computer/UsageButton";
import type { ComputerThreadChunk } from "@/lib/use-computer-thread-chunks";

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
  usageJson?: unknown;
  resultJson?: unknown;
  error?: string | null;
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

  const artifactCount = thread.messages.filter(
    (message) => message.durableArtifact,
  ).length;

  return (
    <main className="flex w-full flex-1 flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border/70 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="shrink-0">
              <Link to="/computer">
                <ArrowLeft className="size-4" />
                <span className="sr-only">Computer</span>
              </Link>
            </Button>
            <h1 className="truncate text-base font-medium text-muted-foreground">
              {thread.title?.trim() || "Untitled thread"}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="icon" disabled>
              <span className="text-lg leading-none">...</span>
              <span className="sr-only">More</span>
            </Button>
            <SourceCountButton count={artifactCount ? 4 : 0} />
            <UsageButton costSummary={thread.costSummary} />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-8 px-4 pb-6 pt-10 sm:px-6">
        <section className="grid gap-8" aria-label="Thread transcript">
          {thread.messages.length === 0 ? (
            <ThinkingRow
              title="Thinking"
              detail="Computer is preparing this thread."
              isActive={isThreadRunning(thread)}
            />
          ) : (
            thread.messages.map((message) => (
              <TranscriptMessage key={message.id} message={message} />
            ))
          )}
          <ThreadTurnActivity turns={thread.turns ?? []} />
          <StreamingMessageBuffer chunks={streamingChunks} />
        </section>

        <FollowUpComposer
          disabled={!onSendFollowUp || isSending}
          isSending={isSending}
          onSubmit={onSendFollowUp}
        />
      </div>
    </main>
  );
}

function ThreadTurnActivity({ turns }: { turns: TaskThreadTurn[] }) {
  const latest = turns[0];
  if (!latest) return null;

  const status = String(latest.status ?? "").toLowerCase();
  const usage = parseRecord(latest.usageJson);
  const rows = actionRowsForTurn(usage);

  return (
    <article className="grid gap-3" aria-label="Thread activity">
      <ThinkingRow
        title="Thinking"
        detail={turnSummary(latest, usage)}
        isActive={status === "running"}
      />
      {rows.map((row) => (
        <ActionRow
          key={`${latest.id}-${row.title}`}
          title={row.title}
          detail={row.detail}
          kind={row.kind}
        />
      ))}
      {latest.error ? (
        <ActionRow
          title="Run failed"
          detail={latest.error}
          kind="tool"
        />
      ) : null}
    </article>
  );
}

function TranscriptMessage({ message }: { message: TaskThreadMessage }) {
  const role = message.role.toUpperCase();
  const isUser = role === "USER";
  const actions = actionRowsForMessage(message);

  return (
    <article className={isUser ? "ml-auto max-w-[78%]" : "grid gap-5"}>
      {isUser ? (
        <div className="rounded-2xl bg-muted/70 px-5 py-3 text-base leading-7 text-foreground">
          {message.content?.trim() || "(No message content)"}
        </div>
      ) : (
        <>
          <div className="grid gap-2">
            {actions.length > 0 ? (
              actions.map((action) => (
                <ActionRow key={`${message.id}-${action.title}`} {...action} />
              ))
            ) : (
              <ThinkingRow title="Thinking" detail="Reasoning complete." />
            )}
          </div>
          <div className="prose prose-invert max-w-none text-[1.05rem] leading-8 text-foreground prose-p:my-0">
            {message.content?.trim() || "(No message content)"}
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

  return (
    <form
      className="sticky bottom-4 mt-auto grid gap-3 rounded-2xl border border-border/80 bg-background/40 p-3 shadow-sm dark:bg-input/30"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canSubmit || !onSubmit) return;
        setError(null);
        try {
          await onSubmit(value.trim());
          setValue("");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to send");
        }
      }}
    >
      <Textarea
        ref={textareaRef}
        aria-label="Follow up"
        value={value}
        onChange={(event) => setValue(event.target.value)}
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
}: {
  title: string;
  detail?: string;
  isActive?: boolean;
}) {
  return (
    <details className="group w-fit text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-base">
        <span
          className={
            isActive
              ? "size-4 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin"
              : "flex size-4 items-center justify-center rounded-full border border-muted-foreground/80"
          }
        />
        {title}
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
      </summary>
      {detail ? (
        <p className="ml-7 mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          {detail}
        </p>
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
    <details className="group w-fit text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-base">
        <Icon className="size-4" />
        {title}
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
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
  const metadata = parseRecord(message.metadata);
  const thinking =
    stringValue(metadata.reasoning) ||
    stringValue(metadata.thinking) ||
    stringValue(metadata.summary);
  rows.push({
    title: "Thinking",
    detail: thinking || "Computer planned the response.",
    kind: "thinking",
  });

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

function actionRowsForTurn(usage: Record<string, unknown>) {
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

  for (const name of toolsCalled) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      title: `Using ${name}`,
      kind: toolKind(name),
    });
  }

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
      title: `Using ${name}`,
      detail: JSON.stringify(record, null, 2),
      kind: toolKind(name),
    });
  }

  return rows;
}

function turnSummary(turn: TaskThreadTurn, usage: Record<string, unknown>) {
  const parts = [
    formatInvocationSource(turn.invocationSource),
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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function TaskThreadState({
  label,
  tone,
}: {
  label: string;
  tone?: "error";
}) {
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
