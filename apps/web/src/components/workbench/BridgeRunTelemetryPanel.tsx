import { AlertCircle, CheckCircle2, Clock, ExternalLink } from "lucide-react";
import { Badge, cn } from "@thinkwork/ui";
import { relativeTime } from "@/lib/utils";

export interface BridgeRunTelemetry {
  id: string;
  status?: string | null;
  resumeStatus?: string | null;
  workflowId?: string | null;
  workflowName?: string | null;
  executionId?: string | null;
  correlationId?: string | null;
  instructionsPreview?: string | null;
  inputPreview?: string | null;
  outputPreview?: string | null;
  errorMessage?: string | null;
  summary?: string | null;
  links?: unknown;
  resumeAttemptCount?: number | null;
  lastResumeHttpStatus?: number | null;
  lastResumeError?: string | null;
  expiresAt?: string | null;
  updatedAt?: string | null;
}

interface BridgeRunTelemetryPanelProps {
  runs?: BridgeRunTelemetry[] | null;
  title?: string;
  compact?: boolean;
  className?: string;
}

const TERMINAL_SUCCESS = new Set(["resumed"]);
const ATTENTION_STATUSES = new Set([
  "resume_failed",
  "failed",
  "expired",
  "awaiting_human",
]);

export function BridgeRunTelemetryPanel({
  runs,
  title = "n8n agent steps",
  compact = false,
  className,
}: BridgeRunTelemetryPanelProps) {
  const visibleRuns = (runs ?? []).filter(Boolean);
  if (visibleRuns.length === 0) return null;

  return (
    <section
      className={cn(
        "rounded-md border border-border bg-card p-4",
        compact && "p-3",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Badge variant="outline">{visibleRuns.length}</Badge>
      </div>
      <div className="space-y-3">
        {visibleRuns.map((run) => (
          <BridgeRunRow key={run.id} run={run} compact={compact} />
        ))}
      </div>
    </section>
  );
}

function BridgeRunRow({
  run,
  compact,
}: {
  run: BridgeRunTelemetry;
  compact: boolean;
}) {
  const status = (run.status ?? "unknown").toLowerCase();
  const label = run.workflowName || run.workflowId || run.executionId || run.id;
  const detail =
    run.errorMessage ||
    run.lastResumeError ||
    run.summary ||
    run.outputPreview ||
    run.instructionsPreview ||
    run.inputPreview ||
    null;
  const links = extractLinks(run.links);

  return (
    <article
      className={cn(
        "rounded-md border border-border bg-muted/20 p-3",
        compact && "p-2.5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {label}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusPill status={status} />
            {run.resumeStatus ? (
              <Badge variant="outline" className="text-[11px]">
                resume {run.resumeStatus.replace(/_/g, " ")}
              </Badge>
            ) : null}
            {run.lastResumeHttpStatus ? (
              <Badge variant="outline" className="text-[11px]">
                HTTP {run.lastResumeHttpStatus}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right text-[11px] text-muted-foreground">
          {run.updatedAt ? relativeTime(run.updatedAt) : null}
        </div>
      </div>

      {detail ? (
        <p className="mt-2 line-clamp-3 break-words text-xs leading-5 text-muted-foreground">
          {detail}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {run.correlationId ? (
          <span className="min-w-0 break-all font-mono">
            corr {run.correlationId}
          </span>
        ) : null}
        {run.executionId ? (
          <span className="min-w-0 break-all font-mono">
            exec {run.executionId}
          </span>
        ) : null}
        {run.resumeAttemptCount ? (
          <span>{run.resumeAttemptCount} resume attempts</span>
        ) : null}
        {run.expiresAt && !TERMINAL_SUCCESS.has(status) ? (
          <span>expires {relativeTime(run.expiresAt)}</span>
        ) : null}
      </div>

      {links.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {links.map((link) => (
            <a
              key={`${link.label}:${link.href}`}
              href={link.href}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {link.label}
              <ExternalLink className="size-3" />
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function StatusPill({ status }: { status: string }) {
  const attention = ATTENTION_STATUSES.has(status);
  const success = TERMINAL_SUCCESS.has(status);
  const Icon = attention ? AlertCircle : success ? CheckCircle2 : Clock;
  return (
    <Badge
      variant={attention ? "destructive" : success ? "default" : "outline"}
      className="text-[11px]"
    >
      <Icon className="size-3" />
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function extractLinks(value: unknown): Array<{ label: string; href: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return Object.entries(record)
    .flatMap(([key, rawValue]) => {
      if (typeof rawValue !== "string" || !rawValue.trim()) return [];
      if (!rawValue.startsWith("/") && !rawValue.startsWith("http")) return [];
      return [{ label: linkLabel(key), href: rawValue }];
    })
    .slice(0, 4);
}

function linkLabel(key: string): string {
  return key
    .replace(/Url$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}
