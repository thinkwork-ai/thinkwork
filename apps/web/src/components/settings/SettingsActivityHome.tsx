import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { SettingsActivity } from "@/components/settings/SettingsActivity";
import { SettingsAnalytics } from "@/components/settings/SettingsAnalytics";
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
  const activeTab = tabForPath(pathname);
  const navigate = useNavigate();

  // Loose read: this component mounts on both /settings/activity (Analytics, no
  // `day`) and /settings/activity/threads (Threads, where `day` is validated by
  // that route's validateSearch). strict:false is untyped, so coerce defensively
  // via the same isActivityDay guard the route uses.
  const search = useSearch({ strict: false }) as { day?: unknown };
  const selectedDay = isActivityDay(search.day) ? search.day : null;

  usePageHeaderActions({
    title: "Activity",
    breadcrumbs: [{ label: "Activity" }],
    tabs: [
      { to: ANALYTICS, label: "Analytics" },
      { to: THREADS, label: "Threads" },
    ],
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
              search: nextDay ? { day: nextDay } : {},
              replace: false,
            })
          }
        />
      ) : (
        <SettingsAnalytics embedded />
      )}
    </div>
  );
}
