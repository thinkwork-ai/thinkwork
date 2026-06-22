import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
} from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import { cn } from "@/lib/utils";

export interface SkillDraftStatusData {
  id?: string | null;
  slug?: string | null;
  displayName?: string | null;
  title?: string | null;
  summary?: string | null;
  status?: string | null;
  trustStatus?: string | null;
  failureMessage?: string | null;
  fileCount?: number | null;
  currentContentHash?: string | null;
  publishedCatalogSlug?: string | null;
  severityCounts?: {
    critical?: number | null;
    high?: number | null;
    medium?: number | null;
    low?: number | null;
    info?: number | null;
  } | null;
}

interface SkillDraftStatusCardProps {
  draft: SkillDraftStatusData;
  viewerIsOperator?: boolean;
}

const READY_STATUSES = new Set(["submitted", "ready", "approved"]);
const RUNNING_STATUSES = new Set([
  "draft",
  "pending",
  "running",
  "trust_running",
  "scanning",
]);
const BLOCKED_STATUSES = new Set([
  "failed",
  "blocked",
  "changes_requested",
  "rejected",
]);

export function SkillDraftStatusCard({
  draft,
  viewerIsOperator = false,
}: SkillDraftStatusCardProps) {
  const normalizedStatus = normalizeStatus(draft.status);
  const tone = statusTone(normalizedStatus);
  const Icon = tone.icon;
  const name =
    draft.displayName?.trim() ||
    draft.title?.trim() ||
    draft.slug?.trim() ||
    "Skill draft";
  const slug = draft.slug?.trim() || null;
  const publishedSlug =
    draft.publishedCatalogSlug?.trim() ||
    (normalizedStatus === "published" ? slug : null);
  const trustLabel = trustSummary(draft);
  const counts = severityCountEntries(draft.severityCounts);

  return (
    <section
      aria-label={`Skill draft status for ${name}`}
      className={cn(
        "mt-2 grid gap-3 rounded-xl border bg-muted/20 p-3 text-sm",
        tone.border,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex size-5 items-center justify-center rounded-full",
                tone.iconBg,
              )}
            >
              <Icon
                className={cn("size-3.5", tone.iconText)}
                aria-hidden="true"
              />
            </span>
            <h3 className="truncate font-semibold text-foreground">
              Skill draft
            </h3>
            <Badge
              variant="outline"
              className={cn("border-current bg-background/60", tone.text)}
            >
              {formatStatus(normalizedStatus)}
            </Badge>
          </div>
          <p className="mt-2 break-words text-foreground">{name}</p>
          {slug ? (
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {slug}
            </p>
          ) : null}
        </div>
        <SkillDraftAction
          status={normalizedStatus}
          publishedSlug={publishedSlug}
          viewerIsOperator={viewerIsOperator}
        />
      </div>

      <dl className="grid gap-2 sm:grid-cols-2">
        <StatusRow
          label="Next step"
          value={nextStep(normalizedStatus, viewerIsOperator)}
          tone={tone}
        />
        <StatusRow
          label="Trust"
          value={trustLabel}
          tone={toneForTrust(draft.trustStatus)}
        />
        {typeof draft.fileCount === "number" ? (
          <StatusRow
            label="Files"
            value={String(draft.fileCount)}
            tone={toneForNeutral()}
          />
        ) : null}
        {counts.length > 0 ? (
          <StatusRow
            label="Findings"
            value={counts.join(" / ")}
            tone={toneForTrust(draft.trustStatus)}
          />
        ) : null}
      </dl>

      {draft.failureMessage ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {draft.failureMessage}
        </p>
      ) : null}
      {draft.summary ? (
        <p className="text-sm leading-5 text-muted-foreground">
          {draft.summary}
        </p>
      ) : null}
    </section>
  );
}

function SkillDraftAction({
  status,
  publishedSlug,
  viewerIsOperator,
}: {
  status: string;
  publishedSlug: string | null;
  viewerIsOperator: boolean;
}) {
  if (publishedSlug) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link
          to="/settings/skills/$skillSlug"
          params={{ skillSlug: publishedSlug }}
        >
          Open skill
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      </Button>
    );
  }
  if (!viewerIsOperator || status === "rejected") return null;
  return (
    <Button asChild size="sm" variant="outline">
      <Link to="/settings/skills">
        Review draft
        <ExternalLink className="size-3.5" aria-hidden="true" />
      </Link>
    </Button>
  );
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: ReturnType<typeof toneForNeutral>;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-background/40 px-3 py-2",
        tone.border,
      )}
    >
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className={cn("mt-1 font-medium", tone.text)}>{value}</dd>
    </div>
  );
}

function nextStep(status: string, viewerIsOperator: boolean) {
  if (status === "published") return "Published to the Skill Library.";
  if (status === "rejected") return "The draft was rejected.";
  if (status === "failed") return "Fix validation issues, then submit again.";
  if (status === "changes_requested" || status === "blocked") {
    return "Changes are needed before publication.";
  }
  if (READY_STATUSES.has(status)) {
    return viewerIsOperator
      ? "Ready for operator review."
      : "Submitted for operator review.";
  }
  if (RUNNING_STATUSES.has(status)) {
    return "Trust and validation checks are in progress.";
  }
  return "Draft status is available in the skill review queue.";
}

function trustSummary(draft: SkillDraftStatusData) {
  const trustStatus = normalizeStatus(draft.trustStatus);
  if (trustStatus) return formatStatus(trustStatus);
  if (draft.currentContentHash) return "Ready for trust review";
  if (normalizeStatus(draft.status) === "failed") return "Validation failed";
  return "Not run yet";
}

function severityCountEntries(counts: SkillDraftStatusData["severityCounts"]) {
  if (!counts) return [];
  return (["critical", "high", "medium", "low", "info"] as const)
    .map((key) => [key, counts[key] ?? 0] as const)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${value} ${key}`);
}

function normalizeStatus(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function formatStatus(value: string) {
  return (
    value
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Unknown"
  );
}

function statusTone(status: string) {
  if (status === "published" || READY_STATUSES.has(status)) {
    return toneForSuccess();
  }
  if (RUNNING_STATUSES.has(status)) return toneForRunning();
  if (BLOCKED_STATUSES.has(status)) return toneForDanger();
  return toneForNeutral();
}

function toneForTrust(status?: string | null) {
  const normalized = normalizeStatus(status);
  if (!normalized) return toneForNeutral();
  if (["passed", "complete", "completed", "trusted"].includes(normalized)) {
    return toneForSuccess();
  }
  if (["running", "pending", "scanning"].includes(normalized)) {
    return toneForRunning();
  }
  if (["failed", "blocked", "missing", "untrusted"].includes(normalized)) {
    return toneForDanger();
  }
  return toneForNeutral();
}

function toneForSuccess() {
  return {
    border: "border-emerald-500/45",
    text: "text-emerald-300",
    iconBg: "bg-emerald-500/15",
    iconText: "text-emerald-300",
    icon: CheckCircle2,
  };
}

function toneForRunning() {
  return {
    border: "border-sky-500/45",
    text: "text-sky-300",
    iconBg: "bg-sky-500/15",
    iconText: "text-sky-300",
    icon: CircleDashed,
  };
}

function toneForDanger() {
  return {
    border: "border-destructive/45",
    text: "text-destructive",
    iconBg: "bg-destructive/15",
    iconText: "text-destructive",
    icon: AlertCircle,
  };
}

function toneForNeutral() {
  return {
    border: "border-border",
    text: "text-foreground",
    iconBg: "bg-muted",
    iconText: "text-muted-foreground",
    icon: CircleDashed,
  };
}
