import { createFileRoute } from "@tanstack/react-router";
import { AgentLoopDetail } from "@/components/agent-loops/AgentLoopDetail";

export const Route = createFileRoute(
  "/_authed/_shell/automations/$automationId",
)({
  // THINK-247: the Definition | Executions tab strip lives in the AppTopBar
  // (like Memory), driven by a `tab` search param so tabs are linkable.
  validateSearch: (search: Record<string, unknown>): { tab?: "executions" } =>
    search.tab === "activity" || search.tab === "executions"
      ? { tab: "executions" }
      : {},
  component: AutomationDetailRoute,
});

function AutomationDetailRoute() {
  const { automationId } = Route.useParams();
  return <AgentLoopDetail agentLoopId={automationId} routeScope="main" />;
}
