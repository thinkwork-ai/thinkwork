import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "urql";
import { ApprovalQueue } from "@/components/approvals/ApprovalQueue";
import type { ComputerApproval } from "@/components/approvals/approval-types";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { ComputerApprovalsQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_shell/approvals/")({
  component: ApprovalsPage,
});

interface ApprovalsResult {
  inboxItems: ComputerApproval[];
}

function ApprovalsPage() {
  usePageHeaderActions({ title: "Approvals" });
  const { tenantId } = useTenant();
  const [{ data, fetching, error }] = useQuery<ApprovalsResult>({
    query: ComputerApprovalsQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const approvals = useMemo(
    () =>
      (data?.inboxItems ?? []).filter(
        (item) => item.type === "computer_approval",
      ),
    [data?.inboxItems],
  );

  return (
    <main className="flex w-full flex-1 flex-col">
      <div className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-5 sm:px-6">
        <ApprovalQueue
          approvals={approvals}
          isLoading={fetching && !data}
          error={error?.message ?? null}
        />
      </div>
    </main>
  );
}
