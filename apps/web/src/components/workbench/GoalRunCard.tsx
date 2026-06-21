import {
  AlertCircle,
  CheckCircle2,
  ListChecks,
  PauseCircle,
} from "lucide-react";
import { Badge, Button, cn } from "@thinkwork/ui";

export interface GoalRunEvidence {
  source: "pi_goal";
  status: string;
  action?: string | null;
  goalId?: string | null;
  objective?: string | null;
  summary?: string | null;
  completionSummary?: string | null;
  completionNotes?: string | null;
  verificationNotes: string[];
  tokenBudget?: number | null;
  tokensUsed?: number | null;
  iteration?: number | null;
  timeUsedSeconds?: number | null;
  budgetLimitedReason?: string | null;
  continuationPolicy?: string | null;
  resumeEligible: boolean;
  updatedAt?: string | null;
  debug?: { error?: string | null; preview?: string | null } | null;
}

interface GoalRunCardProps {
  goalRun: GoalRunEvidence;
  compact?: boolean;
  operator?: boolean;
  onResume?: (goalRun: GoalRunEvidence) => void;
}

export function GoalRunCard({
  goalRun,
  compact = false,
  operator = false,
  onResume,
}: GoalRunCardProps) {
  const label = goalStatusLabel(goalRun.status);
  const tone = goalStatusTone(goalRun.status);
  const Icon = goalStatusIcon(goalRun.status);
  const summary =
    goalRun.completionSummary || goalRun.summary || goalRun.completionNotes;
  const tokenLabel = formatGoalTokens(goalRun);
  const detailLines = [
    goalRun.objective,
    summary,
    goalRun.budgetLimitedReason
      ? `Budget: ${goalRun.budgetLimitedReason}`
      : null,
    tokenLabel,
  ].filter((line): line is string => Boolean(line));

  return (
    <div
      className={cn(
        "my-1 rounded-md border px-3 py-2 text-sm",
        tone === "success" && "border-emerald-500/30 bg-emerald-500/5",
        tone === "warning" && "border-amber-500/35 bg-amber-500/5",
        tone === "muted" && "border-border bg-muted/30",
      )}
      data-goal-run-status={goalRun.status}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">Goal</span>
        <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
          {label}
        </Badge>
        {goalRun.resumeEligible && onResume ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2"
            onClick={() => onResume(goalRun)}
          >
            Resume
          </Button>
        ) : null}
      </div>
      {detailLines.length > 0 ? (
        <div
          className={cn(
            "mt-1 grid gap-1 text-muted-foreground",
            compact && "text-xs",
          )}
        >
          {detailLines.map((line, index) => (
            <p key={`${index}-${line}`} className="min-w-0 break-words">
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {goalRun.verificationNotes.length > 0 ? (
        <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
          {goalRun.verificationNotes.map((note, index) => (
            <li key={`${index}-${note}`} className="break-words">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
      {operator && goalRun.debug ? (
        <pre className="mt-2 max-h-32 overflow-auto rounded border border-border/60 bg-background/70 p-2 text-[11px] text-muted-foreground">
          {JSON.stringify(goalRun.debug, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export function goalRunFromTurnEvidence(
  resultJson: unknown,
  usageJson: unknown,
): GoalRunEvidence | null {
  const result = parseRecord(resultJson);
  const usage = parseRecord(usageJson);
  return normalizeGoalRunEvidence(result.goal_run ?? usage.goal_run);
}

export function normalizeGoalRunEvidence(
  value: unknown,
): GoalRunEvidence | null {
  if (value == null) return null;
  const record = parseRecord(value);
  if (Object.keys(record).length === 0) {
    return {
      source: "pi_goal",
      status: "unknown",
      verificationNotes: [],
      resumeEligible: false,
      summary: "Malformed goal-run evidence",
      debug: {
        error: "malformed_goal_run",
        preview: preview(value),
      },
    };
  }
  const status = stringValue(record.status)?.toLowerCase() ?? "unknown";
  const completion = parseRecord(record.completion);
  const debug = parseRecord(record.debug);
  return {
    source: "pi_goal",
    status,
    action: stringValue(record.action),
    goalId: stringValue(record.goal_id ?? record.goalId),
    objective: stringValue(record.objective),
    summary: stringValue(record.summary),
    completionSummary: stringValue(
      record.completion_summary ??
        record.completionSummary ??
        completion.summary,
    ),
    completionNotes: stringValue(
      record.completion_notes ?? record.completionNotes ?? completion.notes,
    ),
    verificationNotes: stringArray(
      record.verification_notes ?? record.verificationNotes,
    ),
    tokenBudget: numberValue(record.token_budget ?? record.tokenBudget),
    tokensUsed: numberValue(record.tokens_used ?? record.tokensUsed),
    iteration: numberValue(record.iteration),
    timeUsedSeconds: numberValue(
      record.time_used_seconds ?? record.timeUsedSeconds,
    ),
    budgetLimitedReason: stringValue(
      record.budget_limited_reason ?? record.budgetLimitedReason,
    ),
    continuationPolicy: stringValue(
      record.continuation_policy ?? record.continuationPolicy,
    ),
    resumeEligible:
      record.resume_eligible === true ||
      record.resumeEligible === true ||
      status === "budget_limited" ||
      status === "paused",
    updatedAt: stringValue(record.updated_at ?? record.updatedAt),
    debug:
      Object.keys(debug).length > 0
        ? {
            error: stringValue(debug.error),
            preview: stringValue(debug.preview),
          }
        : null,
  };
}

function goalStatusLabel(status: string) {
  switch (status) {
    case "complete":
    case "completed":
      return "Completed";
    case "budget_limited":
      return "Budget limited";
    case "paused":
      return "Paused";
    case "active":
      return "Active";
    case "cancelled":
      return "Cancelled";
    case "cleared":
      return "Cleared";
    default:
      return "Status unavailable";
  }
}

function goalStatusTone(status: string): "success" | "warning" | "muted" {
  if (status === "complete" || status === "completed") return "success";
  if (status === "budget_limited" || status === "paused") return "warning";
  return "muted";
}

function goalStatusIcon(status: string) {
  if (status === "complete" || status === "completed") return CheckCircle2;
  if (status === "budget_limited" || status === "paused") return PauseCircle;
  if (status === "unknown") return AlertCircle;
  return ListChecks;
}

function formatGoalTokens(goalRun: GoalRunEvidence) {
  const used = goalRun.tokensUsed;
  const budget = goalRun.tokenBudget;
  if (used == null && budget == null) return null;
  if (used != null && budget != null) {
    return `Tokens: ${formatCount(used)} / ${formatCount(budget)}`;
  }
  if (used != null) return `Tokens used: ${formatCount(used)}`;
  return `Token budget: ${formatCount(budget ?? 0)}`;
}

function formatCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(Math.round(value));
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const text = stringValue(entry);
        return text ? [text] : [];
      })
    : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function preview(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, 1000);
  } catch {
    return String(value).slice(0, 1000);
  }
}
