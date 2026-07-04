import { createFileRoute } from "@tanstack/react-router";
import { AgentLoopDetail } from "@/components/agent-loops/AgentLoopDetail";

export const Route = createFileRoute(
  "/_authed/_shell/automations/$automationId",
)({
  component: AutomationDetailRoute,
});

function AutomationDetailRoute() {
  const { automationId } = Route.useParams();
  return <AgentLoopDetail agentLoopId={automationId} routeScope="main" />;
}
