import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsAnalytics } from "@/components/settings/SettingsAnalytics";

export const Route = createFileRoute("/_authed/settings/analytics")({
  component: () => (
    <OperatorGuard>
      <SettingsAnalytics />
    </OperatorGuard>
  ),
});
