import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ScheduledJobDetail } from "@/components/scheduled-jobs/ScheduledJobDetail";

export const Route = createFileRoute(
  "/_authed/_shell/automations/$scheduledJobId",
)({
  component: ScheduledJobDetailPage,
});

function ScheduledJobDetailPage() {
  const { scheduledJobId } = Route.useParams();
  const navigate = useNavigate();
  return (
    <ScheduledJobDetail
      scheduledJobId={scheduledJobId}
      backHref="/automations"
      onDeleted={() => navigate({ to: "/automations" })}
    />
  );
}
