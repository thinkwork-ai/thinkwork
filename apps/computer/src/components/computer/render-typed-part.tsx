/**
 * Typed-part renderer (plan-012 U14).
 *
 * Converts an `AccumulatedPart` from `ui-message-merge.ts` into a JSX
 * element using AI Elements primitives:
 *
 *   - text       → <Response>{text}</Response>
 *   - reasoning  → <Reasoning><ReasoningContent>{text}</ReasoningContent></Reasoning>
 *   - tool-*     → <Tool><ToolHeader/><ToolInput/><ToolOutput/></Tool>
 *   - data-*     → forward-compat warning (no rendering surface yet)
 *   - source-*   → minimal anchor / list item
 *   - file       → minimal link / preview
 *
 * Once the thread surface (TaskThreadView) consumes the typed
 * `streamState.parts` from `useComputerThreadChunks` (the field added
 * in U6), this helper is the single switch point. The existing
 * `actionRowsForMessage` derivation stays for legacy messages with
 * no typed parts; the cleanup follow-up after Phase 2 stability
 * retires it.
 */

import type { ReactNode } from "react";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { RunbookConfirmation } from "@/components/runbooks/RunbookConfirmation";
import type { AccumulatedPart } from "@/lib/ui-message-merge";
import type { RunbookConfirmationData } from "@/lib/ui-message-types";

export interface RenderTypedPartOptions {
  /** Stable React key prefix (usually the message id). */
  keyPrefix: string;
  /** Index of the part within the message — appended to `keyPrefix`
   * to form a stable React key. */
  index: number;
}

export function renderTypedPart(
  part: AccumulatedPart,
  { keyPrefix, index }: RenderTypedPartOptions,
): ReactNode {
  const key = `${keyPrefix}::${index}`;

  switch (part.type) {
    case "text":
      return (
        <Response
          key={key}
          className="prose-invert text-sm leading-5 text-foreground prose-p:my-1.5 prose-p:leading-5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-li:leading-5 prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold prose-strong:font-semibold prose-hr:my-3"
        >
          {part.text}
        </Response>
      );
    case "reasoning":
      return (
        <Reasoning
          key={key}
          isStreaming={part.state === "streaming"}
          defaultOpen={false}
        >
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "source-url":
      return (
        <a
          key={key}
          href={part.url}
          target="_blank"
          rel="noreferrer"
          className="block text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {part.title || part.url}
        </a>
      );
    case "source-document":
      return (
        <div key={key} className="text-sm text-muted-foreground">
          {part.title}
          {part.filename ? ` — ${part.filename}` : null}
        </div>
      );
    case "file":
      return (
        <a
          key={key}
          href={part.url}
          target="_blank"
          rel="noreferrer"
          className="block text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Attached file ({part.mediaType})
        </a>
      );
    default:
      break;
  }

  if (part.type.startsWith("tool-")) {
    const toolPart = part as Extract<
      AccumulatedPart,
      { type: `tool-${string}` }
    >;
    return (
      <Tool key={key}>
        <ToolHeader type={toolPart.type} state={toolPart.state} />
        <ToolContent>
          <ToolInput input={toolPart.input} />
          <ToolOutput
            errorText={toolPart.errorText}
            output={
              toolPart.output !== undefined ? (
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
                  {typeof toolPart.output === "string"
                    ? toolPart.output
                    : JSON.stringify(toolPart.output, null, 2)}
                </pre>
              ) : null
            }
          />
        </ToolContent>
      </Tool>
    );
  }

  if (part.type.startsWith("data-")) {
    if (part.type === "data-runbook-confirmation") {
      return (
        <RunbookConfirmation
          key={key}
          data={recordData(part.data) as RunbookConfirmationData}
        />
      );
    }
    if (part.type === "data-runbook-queue") {
      // Queue data is projected into the prompt composer by TaskThreadView.
      // Rendering it here duplicates the same task list in the transcript.
      return null;
    }
    // Forward-compat: render as a small debug strip so unknown
    // data-${name} parts surface in the UI without crashing.
    return (
      <div
        key={key}
        className="rounded border border-border/50 bg-muted/30 px-2 py-1 text-xs text-muted-foreground"
      >
        {part.type}
      </div>
    );
  }

  return null;
}

function recordData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Render the full sequence of accumulated parts for one assistant
 * message. Returns an array; the caller wraps it in <Message>.
 */
export function renderTypedParts(
  parts: AccumulatedPart[],
  options: { keyPrefix: string },
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let toolBuffer: Array<
    Extract<AccumulatedPart, { type: `tool-${string}` }>
  > = [];

  function flushTools(index: number) {
    if (toolBuffer.length === 0) return;
    nodes.push(
      <ToolActivityGroup
        key={`${options.keyPrefix}::tools::${index}`}
        tools={toolBuffer}
      />,
    );
    toolBuffer = [];
  }

  parts.forEach((part, index) => {
    if (part.type.startsWith("tool-")) {
      toolBuffer.push(
        part as Extract<AccumulatedPart, { type: `tool-${string}` }>,
      );
      return;
    }
    flushTools(index);
    nodes.push(
      renderTypedPart(part, {
        keyPrefix: options.keyPrefix,
        index,
      }),
    );
  });

  flushTools(parts.length);
  return nodes;
}

function ToolActivityGroup({
  tools,
}: {
  tools: Array<Extract<AccumulatedPart, { type: `tool-${string}` }>>;
}) {
  const running = tools.filter((tool) =>
    ["input-streaming", "input-available"].includes(tool.state),
  ).length;
  const failed = tools.filter((tool) => tool.state === "output-error").length;
  const completed = tools.filter(
    (tool) => tool.state === "output-available",
  ).length;
  const summary = [
    `${tools.length} tool ${tools.length === 1 ? "call" : "calls"}`,
    running > 0 ? `${running} running` : null,
    completed > 0 ? `${completed} completed` : null,
    failed > 0 ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Reasoning
      defaultOpen={false}
      className="mb-0 w-full text-muted-foreground"
      aria-label="Tool activity"
    >
      <ReasoningTrigger
        className="gap-3 text-base"
        getThinkingMessage={() => (
          <span>
            Tool activity
            <span className="ml-2 text-sm text-muted-foreground/80">
              {summary}
            </span>
          </span>
        )}
      />
      <ReasoningContent className="ml-7 mt-3 max-w-none">
        <div className="grid gap-2">
          {tools.map((tool) => (
            <ToolActivityRow key={tool.toolCallId} tool={tool} />
          ))}
        </div>
      </ReasoningContent>
    </Reasoning>
  );
}

function ToolActivityRow({
  tool,
}: {
  tool: Extract<AccumulatedPart, { type: `tool-${string}` }>;
}) {
  const detail = toolDetail(tool);
  return (
    <details className="group/tool rounded-lg border border-border/60 bg-background/40 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-sm text-foreground">
        <span className="min-w-0 flex-1 truncate">{toolLabel(tool)}</span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
          {toolStatus(tool.state)}
        </span>
      </summary>
      {detail ? (
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2 text-xs leading-5 text-muted-foreground">
          {detail}
        </pre>
      ) : null}
    </details>
  );
}

function toolLabel(
  tool: Extract<AccumulatedPart, { type: `tool-${string}` }>,
) {
  return tool.toolName.replace(/[_-]/g, " ");
}

function toolStatus(status: string) {
  if (status === "output-available") return "completed";
  if (status === "output-error") return "error";
  return "running";
}

function toolDetail(
  tool: Extract<AccumulatedPart, { type: `tool-${string}` }>,
) {
  const detail = {
    input: tool.input,
    output: tool.output,
    error: tool.errorText,
  };
  return JSON.stringify(detail, null, 2);
}
