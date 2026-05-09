import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_shell/automations/$scheduledJobId")({
  component: ScheduledJobDetailPage,
});

function ScheduledJobDetailPage() {
  return null;
}
