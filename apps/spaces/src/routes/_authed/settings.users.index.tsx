import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsUsers } from "@/components/settings/SettingsUsers";

export const Route = createFileRoute("/_authed/settings/users/")({
  component: () => (
    <OperatorGuard>
      <SettingsUsers />
    </OperatorGuard>
  ),
});
