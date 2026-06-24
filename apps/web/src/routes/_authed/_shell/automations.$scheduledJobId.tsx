import { createFileRoute } from "@tanstack/react-router";
import { AgentLoopDetail } from "@/components/agent-loops/AgentLoopDetail";

export const Route = createFileRoute(
  "/_authed/_shell/automations/$scheduledJobId",
)({
  component: AutomationDetailRoute,
});

function AutomationDetailRoute() {
  const { scheduledJobId } = Route.useParams();
  return <AgentLoopDetail agentLoopId={scheduledJobId} routeScope="main" />;
}
