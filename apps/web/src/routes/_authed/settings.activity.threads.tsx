import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsActivityHome } from "@/components/settings/SettingsActivityHome";
import { isActivityDay } from "@/lib/settings-activity";

// Threads tab of the tabbed Activity page. Renders the same parent as the
// section root; the parent picks the facet by pathname. This route exists to
// register the path and validate the `day` filter param.
export const Route = createFileRoute("/_authed/settings/activity/threads")({
  validateSearch: (search: Record<string, unknown>): { day?: string } => ({
    day: isActivityDay(search.day) ? search.day : undefined,
  }),
  component: () => (
    <OperatorGuard>
      <SettingsActivityHome />
    </OperatorGuard>
  ),
});
