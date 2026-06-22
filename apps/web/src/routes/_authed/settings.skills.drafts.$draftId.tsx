import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsSkillDetail } from "@/components/settings/SettingsSkillDetail";

export const Route = createFileRoute(
  "/_authed/settings/skills/drafts/$draftId",
)({
  component: SkillDraftDetailRoute,
});

function SkillDraftDetailRoute() {
  const { draftId } = Route.useParams();
  return (
    <OperatorGuard>
      <SettingsSkillDetail mode="draft" draftId={draftId} />
    </OperatorGuard>
  );
}
