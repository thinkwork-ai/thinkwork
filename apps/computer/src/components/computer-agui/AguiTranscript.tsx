import { ArrowUp, Bot, CheckCircle2, CircleDashed, Wrench } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge, Button, Textarea, cn } from "@thinkwork/ui";
import type { ThinkworkAguiEvent } from "@/agui/events";

export interface AguiThreadMessage {
  id: string;
  role: string;
  content?: string | null;
  createdAt?: string | null;
}

interface AguiTranscriptProps {
  messages: AguiThreadMessage[];
  events: ThinkworkAguiEvent[];
  isSending?: boolean;
  onSendFollowUp?: (content: string) => Promise<void> | void;
}

export function AguiTranscript({
  messages,
  events,
  isSending = false,
  onSendFollowUp,
}: AguiTranscriptProps) {
  const liveText = events
    .filter((event) => event.type === "text_delta")
    .map((event) => event.text)
    .join("");
  const activityEvents = events.filter(
    (event) =>
      event.type === "run_started" ||
      event.type === "run_finished" ||
      event.type === "tool_call_started" ||
      event.type === "tool_call_finished",
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col border-r border-border bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto grid w-full max-w-3xl gap-5">
          <div className="grid gap-3" aria-label="Thread transcript">
            {messages.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                No messages yet.
              </div>
            ) : (
              messages.map((message) => (
                <TranscriptMessage key={message.id} message={message} />
              ))
            )}
            {liveText ? (
              <TranscriptMessage
                message={{
                  id: "agui-live-text",
                  role: "ASSISTANT",
                  content: liveText,
                }}
                isLive
              />
            ) : null}
          </div>

          {activityEvents.length > 0 ? (
            <div className="grid gap-2" aria-label="Run and tool events">
              {activityEvents.map((event) => (
                <ActivityRow key={event.id} event={event} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background/95 px-5 py-4">
        <div className="mx-auto w-full max-w-3xl">
          <FollowUpComposer
            disabled={!onSendFollowUp || isSending}
            isSending={isSending}
            onSubmit={onSendFollowUp}
          />
        </div>
      </div>
    </section>
  );
}

function TranscriptMessage({
  message,
  isLive = false,
}: {
  message: AguiThreadMessage;
  isLive?: boolean;
}) {
  const isUser = message.role.toUpperCase() === "USER";
  return (
    <article
      className={cn(
        "grid gap-2 rounded-md border px-4 py-3",
        isUser
          ? "border-sky-200 bg-sky-50 text-sky-950"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
        {isUser ? "You" : "Computer"}
        {isLive ? <Badge variant="secondary">Live</Badge> : null}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6">
        {message.content?.trim() || "(empty)"}
      </p>
    </article>
  );
}

function ActivityRow({ event }: { event: ThinkworkAguiEvent }) {
  if (
    event.type !== "run_started" &&
    event.type !== "run_finished" &&
    event.type !== "tool_call_started" &&
    event.type !== "tool_call_finished"
  ) {
    return null;
  }
  const isFinished =
    event.type === "run_finished" || event.type === "tool_call_finished";
  const isTool =
    event.type === "tool_call_started" || event.type === "tool_call_finished";
  const Icon = isTool ? Wrench : isFinished ? CheckCircle2 : CircleDashed;

  return (
    <div className="flex gap-3 rounded-md border border-border bg-muted/35 px-3 py-2 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{event.title}</span>
          <Badge variant={isFinished ? "secondary" : "outline"}>
            {event.type.replace(/_/g, " ")}
          </Badge>
        </div>
        {event.detail ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {event.detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function FollowUpComposer({
  disabled,
  isSending,
  onSubmit,
}: {
  disabled: boolean;
  isSending: boolean;
  onSubmit?: (content: string) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !onSubmit) return;
    await onSubmit(content);
    setDraft("");
  }

  return (
    <form
      className="flex items-end gap-2 rounded-md border border-border bg-card p-2"
      onSubmit={handleSubmit}
    >
      <Textarea
        aria-label="Follow up"
        className="min-h-11 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        disabled={disabled}
        placeholder="Follow up..."
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button
        type="submit"
        size="icon"
        disabled={disabled || !draft.trim()}
        aria-label={isSending ? "Sending" : "Send"}
      >
        {isSending ? (
          <Bot className="h-4 w-4 animate-pulse" />
        ) : (
          <ArrowUp className="h-4 w-4" />
        )}
      </Button>
    </form>
  );
}
