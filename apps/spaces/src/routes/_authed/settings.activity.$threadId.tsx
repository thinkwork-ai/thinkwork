import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SpacesThreadDetailRoute } from "@/components/workbench/SpacesThreadDetailRoute";
import { formatActivityDay, isActivityDay } from "@/lib/settings-activity";

export const Route = createFileRoute("/_authed/settings/activity/$threadId")({
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
    <SpacesThreadDetailRoute
      threadId={threadId}
      backHref="/settings/activity"
      documentTitlePrefix="Activity Thread"
      breadcrumbParents={breadcrumbParents}
    />
  );
}
