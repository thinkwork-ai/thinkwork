import {
  AlertCircle,
  Archive,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Loader2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Progress,
  Separator,
} from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { cn } from "@/lib/utils";
import {
  formatSpaceDate,
  formatSpaceLabel,
  type LinkedTaskSummary,
  type OnboardingSourceContext,
} from "./space-types";

interface OnboardingChecklistPanelProps {
  tasks: LinkedTaskSummary[];
  sourceContext?: OnboardingSourceContext | null;
  isLoading?: boolean;
  error?: string | null;
  archivedAt?: string | null;
  isArchiving?: boolean;
  onArchive?: () => Promise<void> | void;
}

export function OnboardingChecklistPanel({
  tasks,
  sourceContext,
  isLoading = false,
  error,
  archivedAt,
  isArchiving = false,
  onArchive,
}: OnboardingChecklistPanelProps) {
  const requiredTasks = tasks.filter((task) => task.required !== false);
  const completedRequired = requiredTasks.filter(isTaskComplete).length;
  const requiredTotal = requiredTasks.length;
  const progress =
    requiredTotal > 0
      ? Math.round((completedRequired / requiredTotal) * 100)
      : 0;
  const allRequiredComplete =
    requiredTotal > 0 && completedRequired === requiredTotal;
  const hasSyncProblems = tasks.some(
    (task) =>
      normalize(task.syncStatus) === "error" ||
      normalize(task.status) === "blocked" ||
      task.blocked,
  );

  return (
    <aside className="flex h-full min-h-0 flex-col border-l bg-background">
      <div className="shrink-0 border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Onboarding</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {requiredTotal
                ? `${completedRequired}/${requiredTotal} required complete`
                : "No required tasks"}
            </p>
          </div>
          <Badge
            variant={allRequiredComplete ? "default" : "outline"}
            className="rounded-full"
          >
            {progress}%
          </Badge>
        </div>
        <Progress value={progress} className="mt-3 h-2" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {sourceContext ? <SourceContext context={sourceContext} /> : null}
        {sourceContext ? <Separator className="my-4" /> : null}

        {error ? (
          <PanelState label={error} tone="error" />
        ) : isLoading ? (
          <div className="flex h-28 items-center justify-center">
            <LoadingShimmer />
          </div>
        ) : tasks.length === 0 ? (
          <PanelState label="No linked tasks" />
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t p-4">
        <ArchiveRecommendation
          allRequiredComplete={allRequiredComplete}
          hasSyncProblems={hasSyncProblems}
          archivedAt={archivedAt}
          isArchiving={isArchiving}
          onArchive={onArchive}
        />
      </div>
    </aside>
  );
}

function SourceContext({ context }: { context: OnboardingSourceContext }) {
  const rows = [
    ["Customer", context.companyName ?? context.customerName],
    ["Opportunity", context.opportunityId],
    ["Sales", context.salesRep],
    ["Plan", context.productPlan],
    ["Value", context.dealValue],
    ["Close", context.closeDate],
  ].filter(([, value]) => value);

  return (
    <section>
      <h3 className="text-xs font-medium uppercase text-muted-foreground">
        Source
      </h3>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3">
            <dt className="w-20 shrink-0 text-xs text-muted-foreground">
              {label}
            </dt>
            <dd className="min-w-0 flex-1 truncate">{value}</dd>
          </div>
        ))}
      </dl>
      {context.opportunityUrl ? (
        <a
          href={context.opportunityUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary"
        >
          CRM
          <ExternalLink className="size-3" />
        </a>
      ) : null}
      {context.missingFields?.length ? (
        <div className="mt-3 rounded-md border border-yellow-300/70 bg-yellow-50 px-3 py-2 text-xs text-yellow-900 dark:border-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-100">
          Missing: {context.missingFields.join(", ")}
        </div>
      ) : null}
    </section>
  );
}

function TaskRow({ task }: { task: LinkedTaskSummary }) {
  const status = normalize(task.status);
  const syncStatus = normalize(task.syncStatus);
  const isComplete = isTaskComplete(task);
  const isBlocked =
    task.blocked || status === "blocked" || syncStatus === "error";
  const Icon = isComplete
    ? CheckCircle2
    : isBlocked
      ? AlertCircle
      : CircleDashed;

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            isComplete
              ? "text-emerald-600"
              : isBlocked
                ? "text-destructive"
                : "text-muted-foreground",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{task.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {task.required === false ? null : <span>Required</span>}
                {task.assigneeDisplay ? (
                  <span>{task.assigneeDisplay}</span>
                ) : null}
                {task.roleKey ? (
                  <span>{formatSpaceLabel(task.roleKey)}</span>
                ) : null}
              </div>
            </div>
            <Badge variant="outline" className="rounded-full text-xs">
              {formatSpaceLabel(task.status) || "Unknown"}
            </Badge>
          </div>
          <div className="mt-2 flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">{syncLabel(task.syncStatus)}</span>
            <span className="shrink-0">
              {formatSpaceDate(task.lastSyncedAt ?? task.updatedAt)}
            </span>
          </div>
          {task.externalTaskUrl ? (
            <a
              href={task.externalTaskUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary"
            >
              LastMile
              <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ArchiveRecommendation({
  allRequiredComplete,
  hasSyncProblems,
  archivedAt,
  isArchiving,
  onArchive,
}: {
  allRequiredComplete: boolean;
  hasSyncProblems: boolean;
  archivedAt?: string | null;
  isArchiving: boolean;
  onArchive?: () => Promise<void> | void;
}) {
  const canArchive = allRequiredComplete && !hasSyncProblems && !archivedAt;
  const label = archivedAt
    ? `Archived ${formatSpaceDate(archivedAt)}`
    : allRequiredComplete
      ? hasSyncProblems
        ? "Review blockers before archiving"
        : "Ready for archive review"
      : "Waiting on required tasks";

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">{label}</div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={!canArchive || !onArchive || isArchiving}
          >
            {isArchiving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Archive className="size-4" />
            )}
            Archive
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this Thread?</AlertDialogTitle>
            <AlertDialogDescription>
              The checklist is complete. The Thread will leave active onboarding
              views but remain searchable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onArchive?.()}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PanelState({
  label,
  tone = "default",
}: {
  label: string;
  tone?: "default" | "error";
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-6 text-center text-sm text-muted-foreground",
        tone === "error" && "text-destructive",
      )}
    >
      {label}
    </div>
  );
}

function isTaskComplete(task: LinkedTaskSummary) {
  return normalize(task.status) === "completed";
}

function syncLabel(value?: string | null) {
  const normalized = normalize(value);
  if (!normalized) return "Not synced";
  if (normalized === "synced") return "Synced";
  if (normalized === "pending") return "Sync pending";
  if (normalized === "warning") return "Sync warning";
  if (normalized === "error") return "Sync error";
  return formatSpaceLabel(value);
}

function normalize(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}
