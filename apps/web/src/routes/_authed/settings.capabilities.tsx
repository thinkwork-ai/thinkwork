import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsCapabilities } from "@/components/settings/SettingsCapabilities";

// Composer (Composer plan U3): the surface is labeled "Composer" but the
// route path deliberately stays /settings/capabilities (KTD-6) so deep
// links and the route tree don't churn on a cosmetic rename.

export const Route = createFileRoute("/_authed/settings/capabilities")({
  component: () => (
    <OperatorGuard>
      <SettingsCapabilities />
    </OperatorGuard>
  ),
});
