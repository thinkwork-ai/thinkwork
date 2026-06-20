import {
  CheckCircle2,
  CircleDashed,
  CircleDot,
  CircleSlash,
  XCircle,
} from "lucide-react";
import { Badge } from "@thinkwork/ui";

export interface WorkflowStep {
  id: string;
  title: string;
  status: "queued" | "running" | "blocked" | "completed" | "failed";
  summary?: string;
}

export interface TaskStatusSummaryProps {
  title: string;
  status: WorkflowStep["status"];
  steps?: WorkflowStep[];
}

export function TaskStatusSummary({
  title,
  status,
  steps = [],
}: TaskStatusSummaryProps) {
  const StatusIcon = iconForStatus(status);

  return (
    <section
      aria-label={title}
      className="grid gap-3 rounded-md border border-border bg-card p-3 text-sm shadow-sm"
      data-testid="genui-workflow-status"
    >
      <header className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
          {title}
        </h3>
        <Badge variant="outline" className="shrink-0 gap-1 rounded-md text-xs">
          <StatusIcon className="size-3.5" />
          {statusLabel(status)}
        </Badge>
      </header>
      {steps.length ? (
        <ol className="grid gap-2" aria-label="Workflow steps">
          {steps.map((step) => {
            const StepIcon = iconForStatus(step.status);
            return (
              <li
                className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 rounded-md bg-muted/35 p-2"
                key={step.id}
              >
                <StepIcon className="mt-0.5 size-4 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <p className="truncate font-medium text-foreground">
                      {step.title}
                    </p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {statusLabel(step.status)}
                    </span>
                  </div>
                  {step.summary ? (
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {step.summary}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-md bg-muted/35 p-2 text-sm text-muted-foreground">
          No workflow steps.
        </p>
      )}
    </section>
  );
}

function iconForStatus(status: WorkflowStep["status"]) {
  switch (status) {
    case "completed":
      return CheckCircle2;
    case "failed":
      return XCircle;
    case "blocked":
      return CircleSlash;
    case "running":
      return CircleDot;
    case "queued":
    default:
      return CircleDashed;
  }
}

function statusLabel(status: WorkflowStep["status"]) {
  return status.slice(0, 1).toUpperCase() + status.slice(1);
}
