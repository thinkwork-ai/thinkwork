import { createFileRoute } from "@tanstack/react-router";
import { AgentLoopDetail } from "@/components/agent-loops/AgentLoopDetail";
import { OperatorGuard } from "@/components/settings/OperatorGuard";

export const Route = createFileRoute(
  "/_authed/settings/automations/$automationId",
)({
  component: SettingsAutomationDetailPage,
});

function SettingsAutomationDetailPage() {
  const { automationId } = Route.useParams();
  return (
    <OperatorGuard>
      <AgentLoopDetail agentLoopId={automationId} />
    </OperatorGuard>
  );
}
