import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsCapabilities } from "@/components/settings/SettingsCapabilities";

export const Route = createFileRoute("/_authed/settings/capabilities")({
  component: () => (
    <OperatorGuard>
      <SettingsCapabilities />
    </OperatorGuard>
  ),
});
