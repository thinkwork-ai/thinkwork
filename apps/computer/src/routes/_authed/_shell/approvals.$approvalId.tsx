import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { ApprovalDetail } from "@/components/approvals/ApprovalDetail";
import { ApprovalQueue } from "@/components/approvals/ApprovalQueue";
import type { ComputerApproval } from "@/components/approvals/approval-types";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
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
  useBreadcrumbs([
    { label: "Approvals", href: "/approvals" },
    { label: approvalLabel },
  ]);
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
      input: { reviewNotes: "Denied in ThinkWork Computer" },
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
              Pending Computer decisions.
            </p>
          </header>
          <ApprovalQueue
            approvals={approvals}
            selectedId={approvalId}
            isLoading={queueFetching && !queueData}
            error={queueError?.message ?? null}
          />
        </aside>
        <ApprovalDetail
          approval={
            data?.inboxItem?.type === "computer_approval" ? data.inboxItem : null
          }
          isLoading={fetching && !data}
          error={error?.message ?? null}
          isSubmitting={isSubmitting}
          submitError={submitError}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      </div>
    </main>
  );
}
