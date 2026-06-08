import { createFileRoute } from "@tanstack/react-router";
import { ManagedApplicationRouteGuard } from "@/components/settings/ManagedApplicationRouteGuard";
import { SettingsKestraApplication } from "@/components/settings/SettingsKestraApplication";

export const Route = createFileRoute("/_authed/settings/applications/kestra")({
  component: () => (
    <ManagedApplicationRouteGuard appKey="kestra" allowDisabled>
      <SettingsKestraApplication />
    </ManagedApplicationRouteGuard>
  ),
});
