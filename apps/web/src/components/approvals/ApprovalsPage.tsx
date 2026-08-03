import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { ApprovalsMailApp } from "@/components/approvals/ApprovalsMailApp";
import type { ComputerApproval } from "@/components/approvals/approval-types";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  ApproveComputerApprovalMutation,
  ComputerApprovalsQuery,
  RejectComputerApprovalMutation,
} from "@/lib/graphql-queries";

interface ApprovalsResult {
  inboxItems: ComputerApproval[];
}

/**
 * Shared approvals page: mail-client layout for /approvals and
 * /approvals/$approvalId. The index auto-selects the newest item so the
 * reading pane is never pointlessly empty.
 */
export function ApprovalsPage({ approvalId }: { approvalId?: string }) {
  usePageHeaderActions({ title: "Approvals" });
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [{ data, fetching, error }] = useQuery<ApprovalsResult>({
    query: ComputerApprovalsQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const approvals = useMemo(
    () =>
      (data?.inboxItems ?? []).filter(
        (item) => item.type === "computer_approval",
      ),
    [data?.inboxItems],
  );

  const [{ fetching: approving }, approve] = useMutation(
    ApproveComputerApprovalMutation,
  );
  const [{ fetching: rejecting }, reject] = useMutation(
    RejectComputerApprovalMutation,
  );

  // Deep link to a decided/unknown id degrades to the queue; an empty
  // selection auto-picks the first pending item.
  const selectedId =
    approvalId && approvals.some((item) => item.id === approvalId)
      ? approvalId
      : (approvals[0]?.id ?? null);

  useEffect(() => {
    setSubmitError(null);
  }, [selectedId]);

  async function handleApprove(
    id: string,
    decisionValues?: Record<string, unknown>,
  ) {
    setSubmitError(null);
    const result = await approve({
      id,
      input: decisionValues ? { decisionValues } : {},
    });
    if (result.error) {
      setSubmitError(result.error.message);
      return;
    }
    toast.success("Approved — ThinkWork is sending it now.");
    void navigate({ to: "/approvals", replace: true });
  }

  async function handleDeny(id: string) {
    setSubmitError(null);
    const result = await reject({
      id,
      input: { reviewNotes: "Denied in ThinkWork" },
    });
    if (result.error) {
      setSubmitError(result.error.message);
      return;
    }
    toast.success("Denied. Nothing was sent.");
    void navigate({ to: "/approvals", replace: true });
  }

  return (
    <ApprovalsMailApp
      approvals={approvals}
      selectedId={selectedId}
      isLoading={fetching && !data}
      error={error?.message ?? null}
      isSubmitting={approving || rejecting}
      submitError={submitError}
      onSelect={(id) =>
        void navigate({
          to: "/approvals/$approvalId",
          params: { approvalId: id },
        })
      }
      onApprove={handleApprove}
      onDeny={handleDeny}
    />
  );
}
