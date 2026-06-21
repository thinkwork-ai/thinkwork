import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { WorkflowInventory } from "@/components/workflows/WorkflowInventory";

export const Route = createFileRoute("/_authed/settings/workflows/")({
  component: () => (
    <OperatorGuard>
      <WorkflowInventory />
    </OperatorGuard>
  ),
});
