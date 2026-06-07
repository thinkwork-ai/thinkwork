import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsAgents } from "@/components/settings/SettingsAgents";

export const Route = createFileRoute("/_authed/settings/agents/")({
  component: () => (
    <OperatorGuard>
      <SettingsAgents />
    </OperatorGuard>
  ),
});
