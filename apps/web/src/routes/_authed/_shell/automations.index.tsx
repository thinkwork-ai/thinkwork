import { createFileRoute } from "@tanstack/react-router";
import { AgentLoopInventory } from "@/components/agent-loops/AgentLoopInventory";
import { PersonalMemoryAutomation } from "@/components/memory/PersonalMemoryAutomation";

export const Route = createFileRoute("/_authed/_shell/automations/")({
  component: AutomationsRoute,
});

function AutomationsRoute() {
  return (
    <main className="h-full min-h-0 w-full overflow-y-auto bg-background">
      {/* THINK-193 U3: owner-only managed Personal Memory Processing card. */}
      <PersonalMemoryAutomation />
      <AgentLoopInventory routeScope="main" />
    </main>
  );
}
