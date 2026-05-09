import { ArrowLeft, Send } from "lucide-react";
import { Badge, Button, Textarea } from "@thinkwork/ui";
import {
  GeneratedArtifactCard,
  type GeneratedArtifact,
} from "@/components/computer/GeneratedArtifactCard";
import { SourceCountButton } from "@/components/computer/SourceCountButton";
import { StreamingMessageBuffer } from "@/components/computer/StreamingMessageBuffer";
import { TaskEventRow } from "@/components/computer/TaskEventRow";
import { UsageButton } from "@/components/computer/UsageButton";
import type { ComputerThreadChunk } from "@/lib/use-computer-thread-chunks";

export interface TaskThreadMessage {
  id: string;
  role: string;
  content?: string | null;
  createdAt?: string | null;
  durableArtifact?: GeneratedArtifact | null;
}

export interface TaskThread {
  id: string;
  title?: string | null;
  status?: string | null;
  lifecycleStatus?: string | null;
  costSummary?: number | null;
  messages: TaskThreadMessage[];
}

interface TaskThreadViewProps {
  thread: TaskThread | null;
  isLoading?: boolean;
  error?: string | null;
  streamingChunks?: ComputerThreadChunk[];
}

export function TaskThreadView({
  thread,
  isLoading = false,
  error,
  streamingChunks = [],
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
    <main className="flex w-full flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
        <header className="flex flex-col gap-3 border-b border-border/70 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button asChild variant="ghost" size="sm" className="gap-2">
              <a href="/tasks">
                <ArrowLeft className="size-4" />
                Threads
              </a>
            </Button>
            <div className="flex flex-wrap items-center gap-1">
              <SourceCountButton count={artifactCount ? 4 : 0} />
              <UsageButton costSummary={thread.costSummary} />
            </div>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                {thread.title?.trim() || "Untitled thread"}
              </h1>
              <Badge variant="outline" className="rounded-md">
                {thread.lifecycleStatus ?? thread.status ?? "IDLE"}
              </Badge>
            </div>
          </div>
        </header>

        <section className="grid gap-4" aria-label="Thread transcript">
          {thread.messages.length === 0 ? (
            <TaskEventRow
              title="Thread created"
              detail="Computer is ready for follow-up instructions."
              status={thread.lifecycleStatus ?? "idle"}
            />
          ) : (
            thread.messages.map((message) => (
              <TranscriptMessage key={message.id} message={message} />
            ))
          )}
          <StreamingMessageBuffer chunks={streamingChunks} />
        </section>

        <form className="sticky bottom-4 mt-auto grid gap-2 rounded-lg border border-border/80 bg-background/95 p-3 shadow-sm">
          <Textarea
            aria-label="Follow up"
            placeholder="Ask Computer to continue, revise, or explain..."
            className="min-h-20 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
          />
          <Button type="button" size="sm" className="gap-2 justify-self-end">
            Send
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </main>
  );
}

function TranscriptMessage({ message }: { message: TaskThreadMessage }) {
  const isUser = message.role === "USER";

  return (
    <article className={isUser ? "ml-auto max-w-[85%]" : "grid gap-3"}>
      <div
        className={
          isUser
            ? "rounded-lg bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground"
            : "rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm leading-6"
        }
      >
        {message.content?.trim() || "(No message content)"}
      </div>
      {message.durableArtifact ? (
        <GeneratedArtifactCard artifact={message.durableArtifact} />
      ) : null}
    </article>
  );
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
