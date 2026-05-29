import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsAgentConfig } from "@/components/settings/SettingsAgentConfig";

export const Route = createFileRoute("/_authed/settings/agent")({
  component: () => (
    <OperatorGuard>
      <SettingsAgentConfig />
    </OperatorGuard>
  ),
});
