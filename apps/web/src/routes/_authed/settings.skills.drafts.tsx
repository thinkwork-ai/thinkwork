import { createFileRoute, useParams } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsSkillDetail } from "@/components/settings/SettingsSkillDetail";
import { SettingsSkills } from "@/components/settings/SettingsSkills";

export const Route = createFileRoute("/_authed/settings/skills/drafts")({
  component: SkillDraftsRoute,
});

function SkillDraftsRoute() {
  const { draftId } = useParams({ strict: false }) as { draftId?: string };
  return (
    <OperatorGuard>
      {draftId ? (
        <SettingsSkillDetail mode="draft" draftId={draftId} />
      ) : (
        <SettingsSkills tab="drafts" />
      )}
    </OperatorGuard>
  );
}
