import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsWebhookDetail } from "@/components/settings/SettingsWebhookDetail";

export const Route = createFileRoute("/_authed/settings/webhooks/$webhookId")({
  component: () => (
    <OperatorGuard>
      <SettingsWebhookDetail />
    </OperatorGuard>
  ),
});
