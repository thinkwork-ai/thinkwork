import { createFileRoute } from "@tanstack/react-router";
import { AgentLoopInventory } from "@/components/agent-loops/AgentLoopInventory";

export const Route = createFileRoute("/_authed/_shell/automations/")({
  component: AutomationsRoute,
});

function AutomationsRoute() {
  return (
    <main className="h-full min-h-0 w-full overflow-y-auto bg-background">
      {/* THINK-264: Personal Memory Processing is a built-in row in the
          inventory below (with a real Definition and Executions), not a
          bespoke card bolted on top. */}
      <AgentLoopInventory routeScope="main" />
    </main>
  );
}
