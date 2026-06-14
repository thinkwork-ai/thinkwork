import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  ACTIVITY_DISPLAY_CONFIG,
  SettingsActivity,
  type SettingsActivityDisplayState,
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
  const [threadsHeaderAction, setThreadsHeaderAction] = useState<{
    action: ReactNode;
    actionKey: string;
  } | null>(null);

  // Loose read: this component mounts on both /settings/activity (Analytics, no
  // `day`) and /settings/activity/threads (Threads, where `day` is validated by
  // that route's validateSearch). strict:false is untyped, so coerce defensively
  // via the same isActivityDay guard the route uses.
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const selectedDay = isActivityDay(search.day) ? search.day : null;
  const rawDisplayState = normalizeDisplayState(
    search,
    ACTIVITY_DISPLAY_CONFIG,
  );
  const displayStateKey = JSON.stringify(rawDisplayState);
  const displayState = useMemo(
    () => rawDisplayState,
    // Keep display state referentially stable across parent-only header updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayStateKey],
  );
  const headerTabs = showOperatorAnalytics
    ? [
        { to: ANALYTICS, label: "Analytics" },
        { to: THREADS, label: "Threads" },
      ]
    : undefined;
  const handleSelectedDayChange = useCallback(
    (nextDay: string | null) =>
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
      }),
    [navigate],
  );
  const handleDisplayStateChange = useCallback(
    (nextState: SettingsActivityDisplayState) =>
      navigate({
        to: THREADS,
        search: (previous) => ({
          ...displayStateToSearch(nextState, ACTIVITY_DISPLAY_CONFIG),
          ...(isActivityDay(previous.day) ? { day: previous.day } : {}),
        }),
        replace: true,
      }),
    [navigate],
  );
  const handleThreadsHeaderActionChange = useCallback(
    (next: { action: ReactNode; actionKey: string } | null) => {
      setThreadsHeaderAction((current) => {
        if (!next) return current ? null : current;
        return current?.actionKey === next.actionKey ? current : next;
      });
    },
    [],
  );

  usePageHeaderActions({
    title: "Activity",
    breadcrumbs: [{ label: "Activity" }],
    tabs: headerTabs,
    action: activeTab === "threads" ? threadsHeaderAction?.action : undefined,
    actionKey:
      activeTab === "threads" ? threadsHeaderAction?.actionKey : undefined,
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {activeTab === "threads" ? (
        <SettingsActivity
          embedded
          selectedDay={selectedDay}
          onSelectedDayChange={handleSelectedDayChange}
          displayState={displayState}
          onHeaderActionChange={handleThreadsHeaderActionChange}
          onDisplayStateChange={handleDisplayStateChange}
        />
      ) : (
        <SettingsAnalytics embedded />
      )}
    </div>
  );
}
