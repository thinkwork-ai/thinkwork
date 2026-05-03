/**
 * StepDetailPanel — right-rail panel showing input/output/duration/cost
 * for a selected node in the execution graph (Plan 2026-05-01-007 §U13).
 *
 * Renders the latest event for a node, plus prior retries collapsed
 * underneath. For `python` recipe steps with S3-offloaded stdout/stderr,
 * surfaces the inline 4KB preview and a "View full output" link to the
 * S3 URI (presigned-URL flow deferred to a Phase E follow-up — for now
 * the URI displays as plain text the operator can open in the AWS
 * console).
 */

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  parseAwsJson,
  type NormalizedRoutineStep,
} from "./routineExecutionManifest";

export interface StepEventDetail {
  id: string;
  nodeId: string;
  recipeType: string;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  inputJson?: unknown;
  outputJson?: unknown;
  errorJson?: unknown;
  llmCostUsdCents?: number | null;
  retryCount: number;
  stdoutS3Uri?: string | null;
  stderrS3Uri?: string | null;
  stdoutPreview?: string | null;
  truncated: boolean;
  createdAt: string;
}

export interface StepDetailPanelProps {
  nodeId: string;
  step?: NormalizedRoutineStep;
  /** All events for this node, in chronological order. The component
   * picks the latest as the headline and shows priors as collapsible
   * retry rows. */
  events: StepEventDetail[];
  executionOutput?: unknown;
  className?: string;
}

function formatDurationMs(start?: string | null, end?: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds - minutes * 60);
  return `${minutes}m ${remSeconds}s`;
}

function formatLlmCost(cents?: number | null): string {
  if (cents == null) return "—";
  if (cents < 100) return `${cents}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "running":
      return "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300";
    case "succeeded":
      return "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300";
    case "failed":
      return "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300";
    case "cancelled":
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    case "timed_out":
      return "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
    case "awaiting_approval":
      return "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300";
    default:
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-zinc-400">null</span>;
  }
  let pretty: string;
  try {
    pretty = JSON.stringify(value, null, 2);
  } catch {
    pretty = String(value);
  }
  return (
    <pre className="mt-1 max-h-80 overflow-auto rounded bg-zinc-50 p-2 text-xs leading-snug dark:bg-zinc-900 dark:text-zinc-200">
      {pretty}
    </pre>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function getScalar(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  if (
    value === undefined ||
    (typeof value === "object" && value !== null && !Array.isArray(value))
  ) {
    return undefined;
  }
  return formatScalar(value);
}

function outputTitle(recipeType: string): string {
  if (recipeType === "python") return "Python output";
  if (recipeType === "email_send") return "Email result";
  return "Step output";
}

function outputForNode(output: unknown, nodeId: string): unknown {
  if (!isRecord(output)) return undefined;
  return output[nodeId];
}

function fallbackEventForStep(
  nodeId: string,
  step: NormalizedRoutineStep | undefined,
): StepEventDetail {
  return {
    id: `output:${nodeId}`,
    nodeId,
    recipeType: step?.recipeId ?? step?.recipeType ?? "unknown",
    status: "succeeded",
    startedAt: null,
    finishedAt: null,
    inputJson: null,
    outputJson: null,
    errorJson: null,
    llmCostUsdCents: null,
    retryCount: 0,
    stdoutS3Uri: null,
    stderrS3Uri: null,
    stdoutPreview: null,
    truncated: false,
    createdAt: "",
  };
}

function StepOutput({
  event,
  output,
}: {
  event: StepEventDetail;
  output: unknown;
}) {
  if (event.recipeType === "python") {
    return <PythonOutput event={event} output={output} />;
  }

  if (event.recipeType === "email_send" && isRecord(output)) {
    return <EmailOutput output={output} />;
  }

  return <StructuredOutput output={output} />;
}

function PythonOutput({
  event,
  output,
}: {
  event: StepEventDetail;
  output: unknown;
}) {
  const outputRecord = isRecord(output) ? output : {};
  const stdoutPreview =
    event.stdoutPreview ?? getScalar(outputRecord, "stdoutPreview");
  const stderrPreview = getScalar(outputRecord, "stderrPreview");
  const exitCode = getScalar(outputRecord, "exitCode");
  const truncated =
    event.truncated || outputRecord.truncated === true ? "Yes" : "No";
  const stdoutS3Uri =
    event.stdoutS3Uri ?? getScalar(outputRecord, "stdoutS3Uri");
  const stderrS3Uri =
    event.stderrS3Uri ?? getScalar(outputRecord, "stderrS3Uri");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Exit code" value={exitCode ?? "—"} />
        <Stat label="Truncated" value={truncated} />
        <Stat
          label="Output"
          value={stdoutPreview || stderrPreview ? "Captured" : "—"}
        />
      </div>

      {stdoutPreview && (
        <Section title="stdout">
          <pre className="mt-1 max-h-72 overflow-auto rounded-md border border-border/70 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-100">
            {stdoutPreview}
          </pre>
        </Section>
      )}

      {stderrPreview && (
        <Section title="stderr">
          <pre className="mt-1 max-h-44 overflow-auto rounded-md border border-red-900/60 bg-red-950/40 p-3 font-mono text-xs leading-relaxed text-red-100">
            {stderrPreview}
          </pre>
        </Section>
      )}

      {(stdoutS3Uri || stderrS3Uri) && (
        <div className="space-y-1 rounded-md border border-border/70 bg-muted/20 p-3 text-xs">
          {stdoutS3Uri && <ResultRow label="stdout S3" value={stdoutS3Uri} />}
          {stderrS3Uri && <ResultRow label="stderr S3" value={stderrS3Uri} />}
        </div>
      )}
    </div>
  );
}

function EmailOutput({ output }: { output: Record<string, unknown> }) {
  const messageId = getScalar(output, "messageId");
  const hasAdditionalFields = Object.keys(output).some(
    (key) => key !== "messageId",
  );

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-green-900/40 bg-green-950/20 p-3">
        <div className="text-sm font-medium text-green-300">Message sent</div>
        {messageId && (
          <div className="mt-2 break-all font-mono text-xs text-muted-foreground">
            {messageId}
          </div>
        )}
      </div>
      {hasAdditionalFields && (
        <StructuredOutput output={output} omitKeys={["messageId"]} />
      )}
    </div>
  );
}

function StructuredOutput({
  output,
  omitKeys = [],
}: {
  output: unknown;
  omitKeys?: string[];
}) {
  if (!isRecord(output)) {
    return (
      <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
        {formatScalar(output)}
      </div>
    );
  }

  const omitted = new Set(omitKeys);
  const scalarEntries = Object.entries(output).filter(
    ([key, value]) =>
      !omitted.has(key) &&
      (value == null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"),
  );
  const nestedEntries = Object.entries(output).filter(
    ([key, value]) =>
      !omitted.has(key) &&
      value != null &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
  const arrayEntries = Object.entries(output).filter(
    ([key, value]) => !omitted.has(key) && Array.isArray(value),
  );

  if (
    scalarEntries.length === 0 &&
    nestedEntries.length === 0 &&
    arrayEntries.length === 0
  ) {
    return (
      <div className="text-sm text-muted-foreground">No output fields.</div>
    );
  }

  return (
    <div className="space-y-3">
      {scalarEntries.length > 0 && (
        <div className="divide-y divide-border/70 overflow-hidden rounded-md border border-border/70">
          {scalarEntries.map(([key, value]) => (
            <ResultRow key={key} label={humanizeKey(key)} value={value} />
          ))}
        </div>
      )}

      {nestedEntries.map(([key, value]) => (
        <details
          key={key}
          className="rounded-md border border-border/70 bg-muted/20 p-3"
        >
          <summary className="cursor-pointer text-sm font-medium">
            {humanizeKey(key)}
          </summary>
          <JsonBlock value={value} />
        </details>
      ))}

      {arrayEntries.map(([key, value]) => (
        <details
          key={key}
          className="rounded-md border border-border/70 bg-muted/20 p-3"
        >
          <summary className="cursor-pointer text-sm font-medium">
            {humanizeKey(key)} ({(value as unknown[]).length})
          </summary>
          <JsonBlock value={value} />
        </details>
      ))}
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 px-3 py-2 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words font-mono text-xs">
        {formatScalar(value)}
      </div>
    </div>
  );
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function StepDetailPanel({
  nodeId,
  step,
  events,
  executionOutput,
  className,
}: StepDetailPanelProps) {
  const fallbackOutput = outputForNode(executionOutput, nodeId);

  if (events.length === 0) {
    if (fallbackOutput !== undefined && fallbackOutput !== null) {
      const fallbackEvent = fallbackEventForStep(nodeId, step);

      return (
        <Card className={cn("min-h-0", className)}>
          <CardContent className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Step result
                </div>
                <div className="mt-1 truncate text-lg font-semibold">
                  {step?.label ?? nodeId}
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="font-mono">{nodeId}</span>
                  {" · "}
                  {step?.recipeId ?? step?.recipeType ?? "unknown"}
                </div>
              </div>
              <Badge
                variant="secondary"
                className={cn(
                  "text-xs capitalize",
                  statusBadgeClass(fallbackEvent.status),
                )}
              >
                {fallbackEvent.status}
              </Badge>
            </div>

            <Section title={outputTitle(fallbackEvent.recipeType)}>
              <StepOutput event={fallbackEvent} output={fallbackOutput} />
            </Section>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className={className}>
        <CardContent className="space-y-3 py-6 text-sm text-zinc-500 dark:text-zinc-400">
          <div>
            No event has landed for{" "}
            <span className="font-mono">{step?.label ?? nodeId}</span> yet — the
            step may still be running.
          </div>
        </CardContent>
      </Card>
    );
  }

  // The latest is the headline; we show priors as a compact "retry N"
  // collapsible row. Pick latest as the most recent finishedAt (or
  // startedAt if no finishedAt yet).
  const sorted = [...events].sort((a, b) => {
    const aKey = a.finishedAt ?? a.startedAt ?? a.createdAt;
    const bKey = b.finishedAt ?? b.startedAt ?? b.createdAt;
    return aKey.localeCompare(bKey);
  });
  const latest = sorted[sorted.length - 1];
  const priors = sorted.slice(0, -1);
  const latestOutput =
    latest.outputJson !== undefined && latest.outputJson !== null
      ? parseAwsJson(latest.outputJson)
      : outputForNode(executionOutput, nodeId);

  return (
    <Card className={cn("min-h-0", className)}>
      <CardContent className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Step result
            </div>
            <div className="mt-1 truncate text-lg font-semibold">
              {step?.label ?? nodeId}
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-mono">{nodeId}</span>
              {" · "}
              {step?.recipeId ?? latest.recipeType}
              {latest.retryCount > 0 ? ` · retries: ${latest.retryCount}` : ""}
            </div>
          </div>
          <Badge
            variant="secondary"
            className={cn(
              "text-xs capitalize",
              statusBadgeClass(latest.status),
            )}
          >
            {latest.status.replace(/_/g, " ")}
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <Stat
            label="Duration"
            value={formatDurationMs(latest.startedAt, latest.finishedAt)}
          />
          <Stat
            label="LLM cost"
            value={formatLlmCost(latest.llmCostUsdCents)}
          />
          <Stat
            label="Started"
            value={
              latest.startedAt
                ? new Date(latest.startedAt).toLocaleString()
                : "—"
            }
          />
        </div>

        {latest.errorJson !== undefined && latest.errorJson !== null && (
          <Section title="Error">
            <JsonBlock value={parseAwsJson(latest.errorJson)} />
          </Section>
        )}

        {latestOutput !== undefined && latestOutput !== null ? (
          <Section title={outputTitle(latest.recipeType)}>
            <StepOutput event={latest} output={latestOutput} />
          </Section>
        ) : (
          <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
            No captured output for this step.
          </div>
        )}

        {priors.length > 0 && (
          <Section title={`Prior attempts (${priors.length})`}>
            <ul className="mt-1 space-y-1 text-xs">
              {priors.map((p, i) => (
                <li
                  key={p.id}
                  className="rounded border border-zinc-200 dark:border-zinc-800 px-2 py-1"
                >
                  <span className="text-zinc-400">#{i + 1}</span>
                  <span className={cn("ml-2 capitalize", "font-medium")}>
                    {p.status.replace(/_/g, " ")}
                  </span>
                  <span className="ml-2 text-zinc-500">
                    {formatDurationMs(p.startedAt, p.finishedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {title}
      </div>
      {children}
    </div>
  );
}
