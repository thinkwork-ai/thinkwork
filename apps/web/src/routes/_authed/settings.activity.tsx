import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsActivityHome } from "@/components/settings/SettingsActivityHome";

// Section root renders the Analytics tab (default) of the tabbed Activity page.
export const Route = createFileRoute("/_authed/settings/activity")({
  component: () => (
    <OperatorGuard>
      <SettingsActivityHome />
    </OperatorGuard>
  ),
});
