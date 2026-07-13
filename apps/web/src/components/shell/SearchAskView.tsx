import type { ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Response } from "@/components/ai-elements/response";
import { cn } from "@/lib/utils";

/**
 * THINK-263 U7 — the "ask" rung of the search palette. When the user escalates a
 * query (⌘Enter or the "Ask …" row), ChatSidebar dispatches the `searchAsk`
 * mutation (hidden thread + agent turn) and streams the result back into this
 * view. All state is shell-owned (KTD-6): closing the palette leaves the turn
 * running, reopening resumes the stream — so this component is purely
 * presentational and renders whatever view-model the shell hands it.
 */
export interface SearchAskViewModel {
  /** The escalated query, echoed in the header. */
  query: string;
  /** Turn lifecycle. `idle` never reaches this component (askView is null). */
  status: "dispatching" | "running" | "answered" | "error";
  /** Humanized live-activity lines derived from the turn's steps. */
  activity: string[];
  /** The assistant answer markdown, once it arrives (may stream in). */
  answer: string | null;
  /** Error text (budget rejection, mid-turn error, or empty-answer). */
  error: string | null;
  /** The hidden thread id — the answer's permalink target. */
  threadId: string | null;
}

/**
 * Maps a live turn step to a human activity line. Both `..._started` and
 * `..._completed` map to the same label so a missed `started` (e.g. only the
 * completion survived catch-up) still surfaces the activity; the caller dedupes
 * consecutive duplicates so the pair collapses to one line.
 */
export function humanizeAskStep(
  eventType: string | null,
  payload: unknown,
): string | null {
  if (
    eventType !== "tool_invocation_started" &&
    eventType !== "tool_invocation_completed"
  ) {
    return null;
  }
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const toolName = typeof record.tool_name === "string" ? record.tool_name : "";
  return toolActivityLabel(toolName);
}

function toolActivityLabel(name: string): string {
  const normalized = name.toLowerCase();
  if (!normalized) return "Working…";
  if (normalized.includes("web_search") || normalized.includes("search")) {
    return "Searching the web";
  }
  if (normalized.includes("recall") || normalized.includes("memory")) {
    return "Reading memory";
  }
  if (normalized.includes("wiki")) return "Checking the wiki";
  if (normalized.includes("read") || normalized.includes("file")) {
    return "Reading files";
  }
  return `Using ${name.replace(/_/g, " ")}`;
}

// Proven dark-readable markdown styling: `prose-invert` + an explicit
// `text-foreground` and per-element overrides. Raw <Response>/Streamdown on a
// bare dark surface renders near-black prose (the bug that bit WikiPageView), so
// we reuse the exact class recipe the chat StreamingMessageBuffer ships with.
const ANSWER_PROSE_CLASS =
  "prose-invert max-w-none text-sm leading-5 text-foreground prose-p:my-1.5 prose-p:leading-5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-li:leading-5 prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold prose-strong:font-semibold prose-a:text-primary prose-hr:my-3";

export function SearchAskView({
  view,
  onBack,
  onOpenPermalink,
  sourcesSlot,
}: {
  view: SearchAskViewModel;
  /** "Back to search" — returns the palette to rails/find mode. */
  onBack: () => void;
  /** "Open full answer →" — navigates to the hidden thread's permalink. */
  onOpenPermalink: () => void;
  /** Seam for a future citations section (THINK-263 follow-up). */
  sourcesSlot?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-3 px-2 py-2"
      role="region"
      aria-label="Ask"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" />
          Back to search
        </button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          “{view.query}”
        </span>
      </div>

      {view.status === "dispatching" ? <AskStatusLine label="Asking…" /> : null}

      {view.status === "running" ? (
        <div className="flex flex-col gap-2">
          <AskActivity lines={view.activity} />
          {view.answer ? <AskAnswer answer={view.answer} /> : null}
        </div>
      ) : null}

      {view.status === "answered" ? (
        <div className="flex flex-col gap-3">
          <AskAnswer answer={view.answer ?? ""} />
          {sourcesSlot}
          {view.threadId ? (
            <button
              type="button"
              onClick={onOpenPermalink}
              className="w-fit rounded-md text-sm font-medium text-primary outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open full answer →
            </button>
          ) : null}
        </div>
      ) : null}

      {view.status === "error" ? (
        <p className="text-sm leading-relaxed text-destructive" role="alert">
          {view.error ?? "Something went wrong — please try again."}
        </p>
      ) : null}
    </div>
  );
}

function AskStatusLine({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

function AskActivity({ lines }: { lines: string[] }) {
  return (
    <div
      className="flex flex-col gap-1 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      {lines.length === 0 ? (
        <AskStatusLine label="Thinking…" />
      ) : (
        lines.map((line, index) => {
          const isLast = index === lines.length - 1;
          return (
            <div
              key={`${index}-${line}`}
              className={cn("flex items-center gap-2", !isLast && "opacity-60")}
            >
              {isLast ? (
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              ) : (
                <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
              )}
              <span className="min-w-0 truncate">{line}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

function AskAnswer({ answer }: { answer: string }) {
  return <Response className={ANSWER_PROSE_CLASS}>{answer}</Response>;
}
