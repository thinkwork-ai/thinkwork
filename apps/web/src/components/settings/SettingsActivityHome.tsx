import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  ACTIVITY_DISPLAY_CONFIG,
  SettingsActivity,
} from "@/components/settings/SettingsActivity";
import { SettingsAnalytics } from "@/components/settings/SettingsAnalytics";
import {
  displayStateToSearch,
  normalizeDisplayState,
} from "@/lib/list-view-display";
import { isActivityDay } from "@/lib/settings-activity";

const ANALYTICS = "/settings/activity";
const THREADS = "/settings/activity/threads";

type ActivityTab = "analytics" | "threads";

function tabForPath(pathname: string): ActivityTab {
  if (pathname.startsWith(THREADS)) return "threads";
  return "analytics";
}

/**
 * The unified Activity settings page. Analytics (cost/usage, the default tab)
 * and Threads (recent thread activity) are sibling tabs rendered in the
 * AppTopBar — driven by the route so each tab is deep-linkable. This page owns
 * the page header and renders the active facet's body; each embedded facet
 * suppresses its own header so the "Activity" breadcrumb stays stable. Mirrors
 * SettingsMemoryHome.
 */
export function SettingsActivityHome() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isOperator, roleResolved } = useTenant();
  const showOperatorAnalytics = roleResolved && isOperator;
  const activeTab = showOperatorAnalytics ? tabForPath(pathname) : "threads";
  const navigate = useNavigate();

  // Loose read: this component mounts on both /settings/activity (Analytics, no
  // `day`) and /settings/activity/threads (Threads, where `day` is validated by
  // that route's validateSearch). strict:false is untyped, so coerce defensively
  // via the same isActivityDay guard the route uses.
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const selectedDay = isActivityDay(search.day) ? search.day : null;
  const displayState = normalizeDisplayState(search, ACTIVITY_DISPLAY_CONFIG);

  usePageHeaderActions({
    title: "Activity",
    breadcrumbs: [{ label: "Activity" }],
    tabs: showOperatorAnalytics
      ? [
          { to: ANALYTICS, label: "Analytics" },
          { to: THREADS, label: "Threads" },
        ]
      : undefined,
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {activeTab === "threads" ? (
        <SettingsActivity
          embedded
          selectedDay={selectedDay}
          onSelectedDayChange={(nextDay) =>
            navigate({
              to: THREADS,
              search: (previous) => ({
                ...displayStateToSearch(
                  normalizeDisplayState(previous, ACTIVITY_DISPLAY_CONFIG),
                  ACTIVITY_DISPLAY_CONFIG,
                ),
                ...(nextDay ? { day: nextDay } : { day: undefined }),
              }),
              replace: false,
            })
          }
          displayState={displayState}
          onDisplayStateChange={(nextState) =>
            navigate({
              to: THREADS,
              search: (previous) => ({
                ...displayStateToSearch(nextState, ACTIVITY_DISPLAY_CONFIG),
                ...(isActivityDay(previous.day) ? { day: previous.day } : {}),
              }),
              replace: true,
            })
          }
        />
      ) : (
        <SettingsAnalytics embedded />
      )}
    </div>
  );
}
