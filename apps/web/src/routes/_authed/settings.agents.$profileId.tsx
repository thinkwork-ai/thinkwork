import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsAgentProfileDetail } from "@/components/settings/SettingsAgents";

export const Route = createFileRoute("/_authed/settings/agents/$profileId")({
  component: () => (
    <OperatorGuard>
      <SettingsAgentProfileDetail />
    </OperatorGuard>
  ),
});
