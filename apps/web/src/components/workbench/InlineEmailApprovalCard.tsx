import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { MailCheck, MailWarning, X } from "lucide-react";
import { useMutation, useQuery } from "urql";
import { Badge, Button, Card, CardContent } from "@thinkwork/ui";
import {
  summarizeApproval,
  type ComputerApproval,
} from "@/components/approvals/approval-types";
import {
  ApproveComputerApprovalMutation,
  ComputerApprovalQuery,
  RejectComputerApprovalMutation,
} from "@/lib/graphql-queries";

interface ApprovalQueryResult {
  inboxItem: ComputerApproval | null;
}

interface ApproveResult {
  approveInboxItem: ComputerApproval;
}

interface RejectResult {
  rejectInboxItem: ComputerApproval;
}

export function InlineEmailApprovalCard({
  approvalId,
}: {
  approvalId: string;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [{ data, fetching, error }] = useQuery<ApprovalQueryResult>({
    query: ComputerApprovalQuery,
    variables: { id: approvalId },
    requestPolicy: "cache-and-network",
  });
  const [{ data: approved, fetching: approving }, approve] =
    useMutation<ApproveResult>(ApproveComputerApprovalMutation);
  const [{ data: rejected, fetching: rejecting }, reject] =
    useMutation<RejectResult>(RejectComputerApprovalMutation);
  const approval =
    approved?.approveInboxItem ??
    rejected?.rejectInboxItem ??
    data?.inboxItem ??
    null;
  const status = approval?.status?.toUpperCase() ?? "";
  const pending = status === "PENDING";
  const summary = approval ? summarizeApproval(approval) : null;
  const draft = summary?.emailDraft;
  const submitting = approving || rejecting;

  async function handleApprove() {
    setSubmitError(null);
    const result = await approve({ id: approvalId, input: {} });
    if (result.error) setSubmitError(result.error.message);
  }

  async function handleCancel() {
    setSubmitError(null);
    const result = await reject({
      id: approvalId,
      input: { reviewNotes: "Cancelled from the originating thread" },
    });
    if (result.error) setSubmitError(result.error.message);
  }

  if (fetching && !approval) {
    return (
      <Card data-testid={`email-approval-${approvalId}`}>
        <CardContent className="py-4 text-sm text-muted-foreground">
          Loading email approval…
        </CardContent>
      </Card>
    );
  }

  if (error || !approval || !summary) {
    return (
      <Card data-testid={`email-approval-${approvalId}`}>
        <CardContent className="grid gap-2 py-4 text-sm">
          <p className="text-destructive">
            The email approval could not be loaded.
          </p>
          <Link
            to="/approvals/$approvalId"
            params={{ approvalId }}
            className="text-primary underline underline-offset-4"
          >
            Open the approval directly
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="border-amber-500/30 bg-amber-500/5"
      data-testid={`email-approval-${approvalId}`}
    >
      <CardContent className="grid gap-3 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
            {status === "APPROVED" ? (
              <MailCheck className="size-4" />
            ) : (
              <MailWarning className="size-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">
                {status === "APPROVED"
                  ? "Email sent"
                  : status === "REJECTED" || status === "CANCELLED"
                    ? "Email cancelled"
                    : "Email awaiting approval"}
              </p>
              <Badge variant="outline" className="rounded-md">
                {status.toLowerCase()}
              </Badge>
            </div>
            {draft ? (
              <div className="mt-2 grid gap-1 text-sm text-muted-foreground">
                <p className="truncate">
                  <span className="font-medium text-foreground">To:</span>{" "}
                  {draft.to || "Unknown recipient"}
                </p>
                <p className="truncate">
                  <span className="font-medium text-foreground">Subject:</span>{" "}
                  {draft.subject || "No subject"}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {submitError ? (
          <p className="text-sm text-destructive">{submitError}</p>
        ) : null}

        {pending ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={submitting}
              onClick={() => void handleApprove()}
            >
              Approve &amp; send
            </Button>
            <Button asChild type="button" variant="outline" size="sm">
              <Link to="/approvals/$approvalId" params={{ approvalId }}>
                Review or edit
              </Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              disabled={submitting}
              onClick={() => void handleCancel()}
            >
              <X className="size-3.5" />
              Cancel
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
