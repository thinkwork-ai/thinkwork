import { createFileRoute } from "@tanstack/react-router";
import { AgentLoopDetail } from "@/components/agent-loops/AgentLoopDetail";
import { OperatorGuard } from "@/components/settings/OperatorGuard";

export const Route = createFileRoute(
  "/_authed/settings/agent-loops/$agentLoopId",
)({
  component: AgentLoopDetailRoute,
});

function AgentLoopDetailRoute() {
  const { agentLoopId } = Route.useParams();
  return (
    <OperatorGuard>
      <AgentLoopDetail agentLoopId={agentLoopId} />
    </OperatorGuard>
  );
}
