import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsActivity } from "@/components/settings/SettingsActivity";
import { isActivityDay } from "@/lib/settings-activity";

export const Route = createFileRoute("/_authed/settings/activity")({
  validateSearch: (search: Record<string, unknown>): { day?: string } => ({
    day: isActivityDay(search.day) ? search.day : undefined,
  }),
  component: () => (
    <OperatorGuard>
      <ActivityRouteContent />
    </OperatorGuard>
  ),
});

function ActivityRouteContent() {
  const { day } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SettingsActivity
      selectedDay={day ?? null}
      onSelectedDayChange={(nextDay) =>
        navigate({
          search: nextDay ? { day: nextDay } : {},
          replace: false,
        })
      }
    />
  );
}
