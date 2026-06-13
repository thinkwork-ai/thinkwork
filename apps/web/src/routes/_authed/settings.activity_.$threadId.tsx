import { createFileRoute } from "@tanstack/react-router";
import { SettingsActivityThreadDetail as SettingsActivityThreadDetailView } from "@/components/settings/SettingsActivityThreadDetail";
import { formatActivityDay, isActivityDay } from "@/lib/settings-activity";

export const Route = createFileRoute("/_authed/settings/activity_/$threadId")({
  validateSearch: (search: Record<string, unknown>): { day?: string } => ({
    day: isActivityDay(search.day) ? search.day : undefined,
  }),
  component: SettingsActivityThreadDetail,
});

function SettingsActivityThreadDetail() {
  const { threadId } = Route.useParams();
  const { day } = Route.useSearch();
  const breadcrumbParents = day
    ? [
        { label: "Activity", href: "/settings/activity/threads" },
        {
          label: formatActivityDay(day),
          href: "/settings/activity/threads",
          search: { day },
        },
      ]
    : [{ label: "Activity", href: "/settings/activity/threads" }];

  return (
    <SettingsActivityThreadDetailView
      threadId={threadId}
      breadcrumbParents={breadcrumbParents}
    />
  );
}
