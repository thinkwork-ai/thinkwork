import { createFileRoute } from "@tanstack/react-router";
import { ApprovalsPage } from "@/components/approvals/ApprovalsPage";

export const Route = createFileRoute("/_authed/_shell/approvals/$approvalId")({
  component: ApprovalDetailRoute,
});

function ApprovalDetailRoute() {
  const { approvalId } = Route.useParams();
  return <ApprovalsPage approvalId={approvalId} />;
}
