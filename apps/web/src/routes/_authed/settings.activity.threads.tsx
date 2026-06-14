import { createFileRoute } from "@tanstack/react-router";
import { SettingsActivityHome } from "@/components/settings/SettingsActivityHome";
import { ACTIVITY_DISPLAY_CONFIG } from "@/components/settings/SettingsActivity";
import {
  displayStateToSearch,
  normalizeDisplayState,
  type DisplaySearchParams,
} from "@/lib/list-view-display";
import { isActivityDay } from "@/lib/settings-activity";

export type SettingsActivityThreadsSearch = DisplaySearchParams & {
  day?: string;
};

// Threads tab of the tabbed Activity page. Renders the same parent as the
// section root; the parent picks the facet by pathname. This route exists to
// register the path and validate the `day` filter param.
export const Route = createFileRoute("/_authed/settings/activity/threads")({
  validateSearch: (
    search: Record<string, unknown>,
  ): SettingsActivityThreadsSearch => ({
    ...(isActivityDay(search.day) ? { day: search.day } : {}),
    ...displayStateToSearch(
      normalizeDisplayState(search, ACTIVITY_DISPLAY_CONFIG),
      ACTIVITY_DISPLAY_CONFIG,
    ),
  }),
  component: SettingsActivityHome,
});
