import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  UserRound,
} from "lucide-react";
import { Badge } from "@thinkwork/ui";
import type { ThreadGenUIActionDescriptor } from "@thinkwork/genui";
import { DecisionPanel } from "./DecisionPanel";

export interface TaskReviewCardProps {
  title: string;
  summary: string;
  status: "pending" | "approved" | "rejected" | "needs_review";
  priority?: string;
  assigneeLabel?: string;
  primaryActionId?: string;
  actions?: ThreadGenUIActionDescriptor[];
  actionsDisabled?: boolean;
}

export function TaskReviewCard({
  title,
  summary,
  status,
  priority,
  assigneeLabel,
  primaryActionId,
  actions,
  actionsDisabled = true,
}: TaskReviewCardProps) {
  const StatusIcon = statusIcon(status);

  return (
    <section
      aria-label={title}
      className="grid gap-3 rounded-md border border-border bg-card p-3 text-sm shadow-sm"
      data-testid="genui-task-review"
    >
      <header className="grid gap-2">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-5 text-foreground">
              {title}
            </h3>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {summary}
            </p>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 gap-1 rounded-md text-xs"
          >
            <StatusIcon className="size-3.5" />
            {statusLabel(status)}
          </Badge>
        </div>
        {priority || assigneeLabel ? (
          <div className="flex min-w-0 flex-wrap gap-1.5 text-xs text-muted-foreground">
            {priority ? (
              <span className="rounded border border-border bg-background px-1.5 py-0.5">
                {priority}
              </span>
            ) : null}
            {assigneeLabel ? (
              <span className="inline-flex min-w-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5">
                <UserRound className="size-3" />
                <span className="truncate">{assigneeLabel}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </header>
      <DecisionPanel
        actions={actions}
        disabled={actionsDisabled}
        primaryActionId={primaryActionId}
      />
    </section>
  );
}

function statusIcon(status: TaskReviewCardProps["status"]) {
  switch (status) {
    case "approved":
      return CircleCheck;
    case "rejected":
    case "needs_review":
      return CircleAlert;
    case "pending":
    default:
      return CircleDashed;
  }
}

function statusLabel(status: TaskReviewCardProps["status"]) {
  switch (status) {
    case "needs_review":
      return "Needs review";
    default:
      return status.slice(0, 1).toUpperCase() + status.slice(1);
  }
}
