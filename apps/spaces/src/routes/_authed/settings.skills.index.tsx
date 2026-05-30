import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsSkills } from "@/components/settings/SettingsSkills";

export const Route = createFileRoute("/_authed/settings/skills/")({
  component: () => (
    <OperatorGuard>
      <SettingsSkills />
    </OperatorGuard>
  ),
});
