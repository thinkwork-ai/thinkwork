import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsUserDetail } from "@/components/settings/SettingsUserDetail";

export const Route = createFileRoute("/_authed/settings/users/$userId")({
  component: () => (
    <OperatorGuard>
      <SettingsUserDetail />
    </OperatorGuard>
  ),
});
