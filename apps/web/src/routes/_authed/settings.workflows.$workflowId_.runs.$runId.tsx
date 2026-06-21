import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { WorkflowRunDetail } from "@/components/workflows/WorkflowRunDetail";

export const Route = createFileRoute(
  "/_authed/settings/workflows/$workflowId_/runs/$runId",
)({
  component: WorkflowRunDetailRoute,
});

function WorkflowRunDetailRoute() {
  const { workflowId, runId } = Route.useParams();
  return (
    <OperatorGuard>
      <WorkflowRunDetail workflowId={workflowId} runId={runId} />
    </OperatorGuard>
  );
}
