import { createFileRoute } from "@tanstack/react-router";
import { ACTIVITY_DISPLAY_CONFIG } from "@/components/settings/SettingsActivity";
import { SettingsActivityThreadDetail as SettingsActivityThreadDetailView } from "@/components/settings/SettingsActivityThreadDetail";
import {
  displayStateToSearch,
  normalizeDisplayState,
  type DisplaySearchParams,
} from "@/lib/list-view-display";
import { formatActivityDay, isActivityDay } from "@/lib/settings-activity";

export const Route = createFileRoute("/_authed/settings/activity_/$threadId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): DisplaySearchParams & { day?: string } => ({
    ...(isActivityDay(search.day) ? { day: search.day } : {}),
    ...displayStateToSearch(
      normalizeDisplayState(search, ACTIVITY_DISPLAY_CONFIG),
      ACTIVITY_DISPLAY_CONFIG,
    ),
  }),
  component: SettingsActivityThreadDetail,
});

function SettingsActivityThreadDetail() {
  const { threadId } = Route.useParams();
  const search = Route.useSearch();
  const { day, ...displaySearch } = search;
  const threadsSearch = { ...displaySearch, ...(day ? { day } : {}) };
  const breadcrumbParents = day
    ? [
        {
          label: "Activity",
          href: "/settings/activity/threads",
          search: displaySearch,
        },
        {
          label: formatActivityDay(day),
          href: "/settings/activity/threads",
          search: threadsSearch,
        },
      ]
    : [
        {
          label: "Activity",
          href: "/settings/activity/threads",
          search: displaySearch,
        },
      ];

  return (
    <SettingsActivityThreadDetailView
      threadId={threadId}
      breadcrumbParents={breadcrumbParents}
    />
  );
}
