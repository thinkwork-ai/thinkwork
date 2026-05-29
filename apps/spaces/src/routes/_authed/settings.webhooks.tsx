import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsWebhooks } from "@/components/settings/SettingsWebhooks";

export const Route = createFileRoute("/_authed/settings/webhooks")({
  component: () => (
    <OperatorGuard>
      <SettingsWebhooks />
    </OperatorGuard>
  ),
});
