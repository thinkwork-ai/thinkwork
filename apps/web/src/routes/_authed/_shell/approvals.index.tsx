import { createFileRoute } from "@tanstack/react-router";
import { ApprovalsPage } from "@/components/approvals/ApprovalsPage";

export const Route = createFileRoute("/_authed/_shell/approvals/")({
  component: ApprovalsIndexRoute,
});

function ApprovalsIndexRoute() {
  return <ApprovalsPage />;
}
