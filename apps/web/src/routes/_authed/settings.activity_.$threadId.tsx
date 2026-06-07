import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsActivityThreadDetail as SettingsActivityThreadDetailView } from "@/components/settings/SettingsActivityThreadDetail";
import { formatActivityDay, isActivityDay } from "@/lib/settings-activity";

export const Route = createFileRoute("/_authed/settings/activity_/$threadId")({
  validateSearch: (search: Record<string, unknown>): { day?: string } => ({
    day: isActivityDay(search.day) ? search.day : undefined,
  }),
  component: () => (
    <OperatorGuard>
      <SettingsActivityThreadDetail />
    </OperatorGuard>
  ),
});

function SettingsActivityThreadDetail() {
  const { threadId } = Route.useParams();
  const { day } = Route.useSearch();
  const breadcrumbParents = day
    ? [
        { label: "Activity", href: "/settings/activity" },
        {
          label: formatActivityDay(day),
          href: "/settings/activity",
          search: { day },
        },
      ]
    : [{ label: "Activity", href: "/settings/activity" }];

  return (
    <SettingsActivityThreadDetailView
      threadId={threadId}
      breadcrumbParents={breadcrumbParents}
    />
  );
}
