import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsAutomations } from "@/components/settings/SettingsAutomations";

export const Route = createFileRoute("/_authed/settings/automations/")({
  component: () => (
    <OperatorGuard>
      <SettingsAutomations />
    </OperatorGuard>
  ),
});
