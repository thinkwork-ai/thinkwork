import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { WorkflowDetail } from "@/components/workflows/WorkflowDetail";

export const Route = createFileRoute("/_authed/settings/workflows/$workflowId")(
  {
    component: WorkflowDetailRoute,
  },
);

function WorkflowDetailRoute() {
  const { workflowId } = Route.useParams();
  return (
    <OperatorGuard>
      <WorkflowDetail workflowId={workflowId} />
    </OperatorGuard>
  );
}
