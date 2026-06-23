import { createFileRoute } from "@tanstack/react-router";
import { AgentLoopInventory } from "@/components/agent-loops/AgentLoopInventory";
import { OperatorGuard } from "@/components/settings/OperatorGuard";

export const Route = createFileRoute("/_authed/settings/automations/")({
  component: AutomationsRoute,
});

function AutomationsRoute() {
  return (
    <OperatorGuard>
      <AgentLoopInventory />
    </OperatorGuard>
  );
}
