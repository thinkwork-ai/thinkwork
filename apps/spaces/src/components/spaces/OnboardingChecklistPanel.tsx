import {
  AlertCircle,
  CheckCheck,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  completedAt?: string | null;
  isCompleting?: boolean;
  updatingTaskId?: string | null;
  onUpdateTask?: (taskId: string, status: string) => Promise<void> | void;
  onCompleteThread?: () => Promise<void> | void;
}

export function OnboardingChecklistPanel({
  tasks,
  sourceContext,
  isLoading = false,
  error,
  completedAt,
  isCompleting = false,
  updatingTaskId,
  onUpdateTask,
  onCompleteThread,
}: OnboardingChecklistPanelProps) {
  const requiredTasks = tasks.filter(isRequiredAndApplicable);
  const completedRequired = requiredTasks.filter(isTaskComplete).length;
  const requiredTotal = requiredTasks.length;
  const progress =
    requiredTotal > 0
      ? Math.round((completedRequired / requiredTotal) * 100)
      : 0;
  const allRequiredComplete =
    requiredTotal > 0 && completedRequired === requiredTotal;
  const hasBlockers = requiredTasks.some(
    (task) => normalize(task.status) === "blocked" || task.blocked,
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
              <TaskRow
                key={task.id}
                task={task}
                isUpdating={updatingTaskId === task.id}
                onUpdateTask={onUpdateTask}
              />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t p-4">
        <CompletionAction
          allRequiredComplete={allRequiredComplete}
          hasBlockers={hasBlockers}
          completedAt={completedAt}
          isCompleting={isCompleting}
          onCompleteThread={onCompleteThread}
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
    ["Primary", formatPerson(context.primaryContact)],
    ["AP", formatPerson(context.accountsPayableContact)],
    ["Billing", context.billingAddress],
    [
      "Shipping",
      context.billingSameAsShipping
        ? "Same as billing"
        : context.shippingAddress,
    ],
    ["Plan", context.productPlan],
    ["Value", context.dealValue],
    ["Close", context.closeDate],
    ["Tax", booleanLabel(context.taxExempt, context.taxExemptionType)],
    [
      "Credit",
      booleanLabel(context.creditTermsRequested, context.requestedTerms),
    ],
    ["DocuSign", formatPerson(context.docusignRecipient)],
    ["D&B", context.dunAndBradstreetId],
    ["P21", context.p21CustomerId],
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
      {context.accountSetupBlockers ? (
        <div className="mt-3 rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive">
          {context.accountSetupBlockers}
        </div>
      ) : null}
    </section>
  );
}

function TaskRow({
  task,
  isUpdating,
  onUpdateTask,
}: {
  task: LinkedTaskSummary;
  isUpdating: boolean;
  onUpdateTask?: (taskId: string, status: string) => Promise<void> | void;
}) {
  const status = normalize(task.status);
  const syncStatus = normalize(task.syncStatus);
  const isComplete = isTaskComplete(task);
  const isNative = isNativeTask(task);
  const isBlocked =
    task.blocked ||
    status === "blocked" ||
    (!isNative && syncStatus === "error");
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
            <span className="truncate">
              {isNative ? "ThinkWork checklist" : syncLabel(task.syncStatus)}
            </span>
            <span className="shrink-0">
              {formatSpaceDate(task.lastSyncedAt ?? task.updatedAt)}
            </span>
          </div>
          {isNative ? (
            <StatusSelect
              value={task.status}
              disabled={!onUpdateTask || isUpdating}
              isUpdating={isUpdating}
              onChange={(nextStatus) =>
                void onUpdateTask?.(task.id, nextStatus)
              }
            />
          ) : task.externalTaskUrl ? (
            <a
              href={task.externalTaskUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary"
            >
              External task
              <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatusSelect({
  value,
  disabled,
  isUpdating,
  onChange,
}: {
  value?: string | null;
  disabled: boolean;
  isUpdating: boolean;
  onChange: (status: string) => void;
}) {
  return (
    <div className="mt-3">
      <Select
        value={statusValue(value)}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectTrigger className="h-8 text-xs" aria-label="Checklist status">
          {isUpdating ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" />
              Updating
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="TODO">Todo</SelectItem>
          <SelectItem value="IN_PROGRESS">In progress</SelectItem>
          <SelectItem value="BLOCKED">Blocked</SelectItem>
          <SelectItem value="COMPLETED">Completed</SelectItem>
          <SelectItem value="NOT_APPLICABLE">Not applicable</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function CompletionAction({
  allRequiredComplete,
  hasBlockers,
  completedAt,
  isCompleting,
  onCompleteThread,
}: {
  allRequiredComplete: boolean;
  hasBlockers: boolean;
  completedAt?: string | null;
  isCompleting: boolean;
  onCompleteThread?: () => Promise<void> | void;
}) {
  const canComplete = allRequiredComplete && !hasBlockers && !completedAt;
  const label = completedAt
    ? `Completed ${formatSpaceDate(completedAt)}`
    : allRequiredComplete
      ? hasBlockers
        ? "Review blockers before completing"
        : "Ready to complete"
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
            disabled={!canComplete || !onCompleteThread || isCompleting}
          >
            {isCompleting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCheck className="size-4" />
            )}
            Complete Thread
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete this Thread?</AlertDialogTitle>
            <AlertDialogDescription>
              The required onboarding checklist is complete. The Thread status
              will move to Done.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onCompleteThread?.()}>
              Complete Thread
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

function isRequiredAndApplicable(task: LinkedTaskSummary) {
  return task.required !== false && normalize(task.status) !== "not_applicable";
}

function isNativeTask(task: LinkedTaskSummary) {
  const provider = normalize(task.provider);
  if (provider) return provider === "thinkwork";
  return !task.externalTaskId && !task.externalTaskUrl;
}

function statusValue(value?: string | null) {
  const normalized = normalize(value);
  if (!normalized) return "TODO";
  return normalized.toUpperCase();
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

function formatPerson(
  person?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null,
) {
  if (!person) return null;
  return [person.name, person.email, person.phone].filter(Boolean).join(" · ");
}

function booleanLabel(value?: boolean | null, detail?: string | null) {
  if (value === null || value === undefined) return null;
  return detail ? `${value ? "Yes" : "No"} · ${detail}` : value ? "Yes" : "No";
}
