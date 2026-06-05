import { createFileRoute } from "@tanstack/react-router";
import { ManagedApplicationRouteGuard } from "@/components/settings/ManagedApplicationRouteGuard";
import { SettingsCrm } from "@/components/settings/SettingsCrm";

export const Route = createFileRoute("/_authed/settings/crm")({
  component: () => (
    <ManagedApplicationRouteGuard appKey="twenty">
      <SettingsCrm />
    </ManagedApplicationRouteGuard>
  ),
});
