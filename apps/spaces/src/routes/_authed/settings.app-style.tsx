import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsAppStyle } from "@/components/settings/SettingsAppStyle";

export const Route = createFileRoute("/_authed/settings/app-style")({
  component: () => (
    <OperatorGuard>
      <SettingsAppStyle />
    </OperatorGuard>
  ),
});
