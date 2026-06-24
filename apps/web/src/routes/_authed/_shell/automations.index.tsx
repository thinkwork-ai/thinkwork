import { createFileRoute } from "@tanstack/react-router";
import { AgentLoopInventory } from "@/components/agent-loops/AgentLoopInventory";

export const Route = createFileRoute("/_authed/_shell/automations/")({
  component: AutomationsRoute,
});

function AutomationsRoute() {
  return <AgentLoopInventory routeScope="main" />;
}
