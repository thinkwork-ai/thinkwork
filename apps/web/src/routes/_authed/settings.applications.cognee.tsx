import { createFileRoute } from "@tanstack/react-router";
import { ManagedApplicationRouteGuard } from "@/components/settings/ManagedApplicationRouteGuard";
import { SettingsCogneeApplication } from "@/components/settings/SettingsCogneeApplication";

export const Route = createFileRoute("/_authed/settings/applications/cognee")({
  component: () => (
    <ManagedApplicationRouteGuard appKey="cognee">
      <SettingsCogneeApplication />
    </ManagedApplicationRouteGuard>
  ),
});
