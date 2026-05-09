import { CheckCircle2, Clock3 } from "lucide-react";
import { Badge, Card } from "@thinkwork/ui";
import {
  formatApprovalDate,
  summarizeApproval,
  type ComputerApproval,
} from "@/components/approvals/approval-types";

interface ApprovalQueueProps {
  approvals: ComputerApproval[];
  selectedId?: string | null;
  isLoading?: boolean;
  error?: string | null;
}

export function ApprovalQueue({
  approvals,
  selectedId,
  isLoading = false,
  error,
}: ApprovalQueueProps) {
  if (isLoading) return <QueueState label="Loading approvals" />;
  if (error) return <QueueState label={error} tone="error" />;
  if (approvals.length === 0) {
    return (
      <QueueState
        label="No pending approvals"
        detail="The Computer will pause here when it needs your decision."
      />
    );
  }

  return (
    <section className="grid gap-3" aria-label="Pending approvals">
      {approvals.map((approval) => {
        const summary = summarizeApproval(approval);
        const isSelected = approval.id === selectedId;
        return (
          <a
            key={approval.id}
            href={`/approvals/${approval.id}`}
            className={[
              "grid w-full min-w-0 gap-2 rounded-lg border border-border/70 bg-background/40 p-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected ? "border-primary/70 bg-primary/10" : "",
            ].join(" ")}
          >
            <span className="flex min-w-0 items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {summary.question}
                </span>
                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                  {summary.actionDescription}
                </span>
              </span>
              <Badge variant="outline" className="rounded-md">
                {summary.actionType}
              </Badge>
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="size-3.5" />
              {formatApprovalDate(approval.createdAt)}
            </span>
          </a>
        );
      })}
    </section>
  );
}

function QueueState({
  label,
  detail,
  tone,
}: {
  label: string;
  detail?: string;
  tone?: "error";
}) {
  return (
    <Card className="items-center gap-2 p-6 text-center">
      <CheckCircle2
        className={
          tone === "error"
            ? "size-5 text-destructive"
            : "size-5 text-muted-foreground"
        }
      />
      <p
        className={
          tone === "error" ? "text-sm text-destructive" : "text-sm font-medium"
        }
      >
        {label}
      </p>
      {detail ? (
        <p className="text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </Card>
  );
}
