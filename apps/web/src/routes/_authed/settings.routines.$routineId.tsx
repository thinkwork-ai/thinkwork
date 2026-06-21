import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { parseStatusFilter } from "@/components/routines/ExecutionList";
import { RoutineWorkflowDetailRedirect } from "@/components/workflows/RoutineWorkflowRedirects";

export const Route = createFileRoute("/_authed/settings/routines/$routineId")({
  validateSearch: (search: Record<string, unknown>) => {
    const status = parseStatusFilter(search.status);
    return status === "all" ? {} : { status };
  },
  component: RoutineDetailCompatibilityRoute,
});

function RoutineDetailCompatibilityRoute() {
  const { routineId } = Route.useParams();
  return (
    <OperatorGuard>
      <RoutineWorkflowDetailRedirect routineId={routineId} />
    </OperatorGuard>
  );
}
