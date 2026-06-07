import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsTools } from "@/components/settings/SettingsTools";

export const Route = createFileRoute("/_authed/settings/tools")({
  component: () => (
    <OperatorGuard>
      <SettingsTools />
    </OperatorGuard>
  ),
});
