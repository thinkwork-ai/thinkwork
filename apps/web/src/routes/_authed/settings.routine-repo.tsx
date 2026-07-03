import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsRoutineRepo } from "@/components/settings/SettingsRoutineRepo";

export const Route = createFileRoute("/_authed/settings/routine-repo")({
  component: () => (
    <OperatorGuard>
      <SettingsRoutineRepo />
    </OperatorGuard>
  ),
});
