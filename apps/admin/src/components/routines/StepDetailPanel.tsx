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

export function StepDetailPanel({
  nodeId,
  step,
  events,
}: StepDetailPanelProps) {
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6 text-sm text-zinc-500 dark:text-zinc-400">
          <div>
            No event has landed for{" "}
            <span className="font-mono">{step?.label ?? nodeId}</span> yet — the
            step may still be running.
          </div>
          {step?.args !== undefined && (
            <Section title="Saved config">
              <JsonBlock value={step.args} />
            </Section>
          )}
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

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
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

        {step?.args !== undefined && (
          <Section title="Saved config">
            <JsonBlock value={step.args} />
          </Section>
        )}

        {latest.recipeType === "python" && latest.stdoutPreview && (
          <Section
            title={
              <>
                stdout preview
                {latest.truncated && (
                  <span className="ml-2 text-xs text-amber-600">
                    (truncated · view full at {latest.stdoutS3Uri ?? "S3"})
                  </span>
                )}
              </>
            }
          >
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-zinc-50 p-2 font-mono text-xs leading-snug dark:bg-zinc-900 dark:text-zinc-200">
              {latest.stdoutPreview}
            </pre>
          </Section>
        )}

        {latest.inputJson !== undefined && latest.inputJson !== null && (
          <Section title="Input">
            <JsonBlock value={parseAwsJson(latest.inputJson)} />
          </Section>
        )}

        {latest.outputJson !== undefined && latest.outputJson !== null && (
          <Section title="Output">
            <JsonBlock value={parseAwsJson(latest.outputJson)} />
          </Section>
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
  title: React.ReactNode;
  children: React.ReactNode;
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
