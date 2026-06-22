import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { ScheduledJobDetail } from "@/components/scheduled-jobs/ScheduledJobDetail";

export const Route = createFileRoute(
  "/_authed/settings/automations/$scheduledJobId",
)({
  component: SettingsAutomationDetailPage,
});

function SettingsAutomationDetailPage() {
  const { scheduledJobId } = Route.useParams();
  const navigate = useNavigate();

  return (
    <OperatorGuard>
      <ScheduledJobDetail
        scheduledJobId={scheduledJobId}
        backHref="/settings/agent-loops"
        onDeleted={() => navigate({ to: "/settings/agent-loops" })}
      />
    </OperatorGuard>
  );
}
