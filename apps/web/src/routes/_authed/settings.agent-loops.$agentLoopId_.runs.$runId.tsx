import { createFileRoute } from "@tanstack/react-router";
import { AgentLoopRunDetail } from "@/components/agent-loops/AgentLoopRunDetail";
import { OperatorGuard } from "@/components/settings/OperatorGuard";

export const Route = createFileRoute(
  "/_authed/settings/agent-loops/$agentLoopId_/runs/$runId",
)({
  component: AgentLoopRunDetailRoute,
});

function AgentLoopRunDetailRoute() {
  const { agentLoopId, runId } = Route.useParams();
  return (
    <OperatorGuard>
      <AgentLoopRunDetail agentLoopId={agentLoopId} runId={runId} />
    </OperatorGuard>
  );
}
