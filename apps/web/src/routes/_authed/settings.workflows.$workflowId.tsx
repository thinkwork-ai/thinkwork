import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import {
  WorkflowDetail,
  type WorkflowDetailTab,
} from "@/components/workflows/WorkflowDetail";

export const Route = createFileRoute("/_authed/settings/workflows/$workflowId")(
  {
    validateSearch: (
      search: Record<string, unknown>,
    ): { tab?: "executions" } =>
      search.tab === "executions" ? { tab: "executions" } : {},
    component: WorkflowDetailRoute,
  },
);

function WorkflowDetailRoute() {
  const { workflowId } = Route.useParams();
  const { tab } = Route.useSearch();
  return (
    <OperatorGuard>
      <WorkflowDetail
        workflowId={workflowId}
        tab={(tab ?? "definition") as WorkflowDetailTab}
      />
    </OperatorGuard>
  );
}
