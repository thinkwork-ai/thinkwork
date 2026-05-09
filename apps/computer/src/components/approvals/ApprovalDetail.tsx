import { AlertTriangle, Check, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@thinkwork/ui";
import { EditAndApproveForm } from "@/components/approvals/EditAndApproveForm";
import {
  formatApprovalDate,
  isEmailSendApproval,
  summarizeApproval,
  type ComputerApproval,
  type EmailDraft,
} from "@/components/approvals/approval-types";

interface ApprovalDetailProps {
  approval: ComputerApproval | null;
  isLoading?: boolean;
  error?: string | null;
  isSubmitting?: boolean;
  submitError?: string | null;
  onApprove: (decisionValues?: Record<string, unknown>) => void;
  onDeny: () => void;
}

export function ApprovalDetail({
  approval,
  isLoading = false,
  error,
  isSubmitting = false,
  submitError,
  onApprove,
  onDeny,
}: ApprovalDetailProps) {
  if (isLoading) return <DetailState label="Loading approval" />;
  if (error || !approval) {
    return <DetailState label={error ?? "Approval not found"} tone="error" />;
  }

  const summary = summarizeApproval(approval);
  const emailApproval = isEmailSendApproval(summary) && summary.emailDraft;

  return (
    <article className="grid min-w-0 gap-4">
      <header className="grid gap-3 border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-md">
            {summary.actionType}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Requested {formatApprovalDate(approval.createdAt)}
          </span>
          {approval.expiresAt ? (
            <span className="text-xs text-muted-foreground">
              Expires {formatApprovalDate(approval.expiresAt)}
            </span>
          ) : null}
        </div>
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {summary.question}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {summary.actionDescription}
          </p>
        </div>
      </header>

      {submitError ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4" />
          {submitError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="gap-2"
          disabled={isSubmitting}
          onClick={() => onApprove()}
        >
          <Check className="size-4" />
          Approve
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={isSubmitting}
          onClick={onDeny}
        >
          <X className="size-4" />
          Deny
        </Button>
      </div>

      {emailApproval ? (
        <Card>
          <CardHeader>
            <CardTitle>Email draft</CardTitle>
          </CardHeader>
          <CardContent>
            <EditAndApproveForm
              draft={summary.emailDraft as EmailDraft}
              isSubmitting={isSubmitting}
              onApprove={(draft) => onApprove({ editedDraft: draft })}
            />
          </CardContent>
        </Card>
      ) : null}

      {summary.evidence.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Evidence</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm text-muted-foreground">
              {summary.evidence.map((item) => (
                <li key={item} className="rounded-md bg-muted/40 px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Payload preview</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-72 overflow-auto rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
            {JSON.stringify(summary.rawConfig, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </article>
  );
}

function DetailState({
  label,
  tone,
}: {
  label: string;
  tone?: "error";
}) {
  return (
    <main className="flex min-h-[320px] items-center justify-center">
      <p
        className={
          tone === "error" ? "text-destructive" : "text-muted-foreground"
        }
      >
        {label}
      </p>
    </main>
  );
}
