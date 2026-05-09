import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "urql";
import { ApprovalQueue } from "@/components/approvals/ApprovalQueue";
import type { ComputerApproval } from "@/components/approvals/approval-types";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { ComputerApprovalsQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_shell/approvals/")({
  component: ApprovalsPage,
});

interface ApprovalsResult {
  inboxItems: ComputerApproval[];
}

function ApprovalsPage() {
  useBreadcrumbs([{ label: "Approvals" }]);
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
        <header className="grid gap-1 border-b border-border/70 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Decisions waiting before the Computer continues.
          </p>
        </header>
        <ApprovalQueue
          approvals={approvals}
          isLoading={fetching && !data}
          error={error?.message ?? null}
        />
      </div>
    </main>
  );
}
