import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsSkillDetail } from "@/components/settings/SettingsSkillDetail";

export const Route = createFileRoute("/_authed/settings/skills/$skillSlug")({
  component: () => (
    <OperatorGuard>
      <SettingsSkillDetail />
    </OperatorGuard>
  ),
});
