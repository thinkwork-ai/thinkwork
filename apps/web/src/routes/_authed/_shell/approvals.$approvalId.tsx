import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { ApprovalDetail } from "@/components/approvals/ApprovalDetail";
import { ApprovalQueue } from "@/components/approvals/ApprovalQueue";
import { RoutineProposalQueue } from "@/components/approvals/RoutineProposalQueue";
import { RoutineProposalReview } from "@/components/approvals/RoutineProposalReview";
import {
  routineProposalIdOf,
  type ComputerApproval,
} from "@/components/approvals/approval-types";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { RoutineProposalQuery } from "@/lib/capability-runtime-queries";
import {
  ApproveComputerApprovalMutation,
  ComputerApprovalQuery,
  ComputerApprovalsQuery,
  RejectComputerApprovalMutation,
} from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_shell/approvals/$approvalId")({
  component: ApprovalDetailPage,
});

interface ApprovalResult {
  inboxItem: ComputerApproval | null;
}

interface ApprovalsResult {
  inboxItems: ComputerApproval[];
}

function ApprovalDetailPage() {
  const { approvalId } = Route.useParams();
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [{ data, fetching, error }] = useQuery<ApprovalResult>({
    query: ComputerApprovalQuery,
    variables: { id: approvalId },
  });
  const approvalLabel = data?.inboxItem?.title?.trim() || "Approval";
  usePageHeaderActions({ title: approvalLabel, backHref: "/approvals" });
  const [{ data: queueData, fetching: queueFetching, error: queueError }] =
    useQuery<ApprovalsResult>({
      query: ComputerApprovalsQuery,
      variables: { tenantId: tenantId ?? "" },
      pause: !tenantId,
    });
  const [{ fetching: approving }, approve] = useMutation(
    ApproveComputerApprovalMutation,
  );
  const [{ fetching: rejecting }, reject] = useMutation(
    RejectComputerApprovalMutation,
  );

  const markedProposalId = routineProposalIdOf(data?.inboxItem);
  // Direct-id fallback (THINK-280 U6): a SUBMITTED proposal has no inbox row
  // yet, so the pending queue links straight to /approvals/<proposalId>.
  // When the id resolves to no inbox item, probe it as a Routine proposal.
  const [{ data: probeData, fetching: probeFetching }] = useQuery({
    query: RoutineProposalQuery,
    variables: { id: approvalId },
    pause: fetching || data?.inboxItem != null,
  });
  const routineProposalId =
    markedProposalId ??
    (probeData?.routineProposal != null ? approvalId : null);
  const approvals = useMemo(
    () =>
      (queueData?.inboxItems ?? []).filter(
        (item) => item.type === "computer_approval",
      ),
    [queueData?.inboxItems],
  );
  const isSubmitting = approving || rejecting;

  async function handleApprove(decisionValues?: Record<string, unknown>) {
    setSubmitError(null);
    const result = await approve({
      id: approvalId,
      input: decisionValues ? { decisionValues } : {},
    });
    if (result.error) {
      setSubmitError(result.error.message);
      return;
    }
    navigate({ to: "/approvals" });
  }

  async function handleDeny() {
    setSubmitError(null);
    const result = await reject({
      id: approvalId,
      input: { reviewNotes: "Denied in ThinkWork" },
    });
    if (result.error) {
      setSubmitError(result.error.message);
      return;
    }
    navigate({ to: "/approvals" });
  }

  return (
    <main className="flex w-full flex-1 flex-col">
      <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <aside className="grid min-w-0 content-start gap-3">
          <header className="grid gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Approvals</h1>
            <p className="text-sm text-muted-foreground">
              Pending ThinkWork decisions.
            </p>
          </header>
          <ApprovalQueue
            approvals={approvals}
            selectedId={approvalId}
            isLoading={queueFetching && !queueData}
            error={queueError?.message ?? null}
          />
          <RoutineProposalQueue tenantId={tenantId} selectedId={approvalId} />
        </aside>
        {routineProposalId ? (
          // THINK-280 U6: a Routine-promotion-linked inbox item renders the
          // proposal review panel; the computer_approval path is untouched.
          <RoutineProposalReview
            proposalId={routineProposalId}
            tenantId={data?.inboxItem?.tenantId ?? tenantId ?? ""}
          />
        ) : (
          <ApprovalDetail
            approval={
              data?.inboxItem?.type === "computer_approval"
                ? data.inboxItem
                : null
            }
            isLoading={(fetching && !data) || probeFetching}
            error={error?.message ?? null}
            isSubmitting={isSubmitting}
            submitError={submitError}
            onApprove={handleApprove}
            onDeny={handleDeny}
          />
        )}
      </div>
    </main>
  );
}
