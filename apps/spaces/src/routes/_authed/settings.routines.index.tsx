import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsRoutines } from "@/components/settings/SettingsRoutines";

export const Route = createFileRoute("/_authed/settings/routines/")({
  component: () => (
    <OperatorGuard>
      <SettingsRoutines />
    </OperatorGuard>
  ),
});
