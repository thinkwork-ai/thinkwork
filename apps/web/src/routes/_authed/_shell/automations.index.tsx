import { createFileRoute } from "@tanstack/react-router";
import { AgentLoopInventory } from "@/components/agent-loops/AgentLoopInventory";

export const Route = createFileRoute("/_authed/_shell/automations/")({
  component: AutomationsRoute,
});

function AutomationsRoute() {
  return (
    <main className="h-full min-h-0 w-full overflow-y-auto bg-background">
      <AgentLoopInventory routeScope="main" />
    </main>
  );
}
