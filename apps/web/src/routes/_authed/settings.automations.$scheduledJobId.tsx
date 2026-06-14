import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { AUTOMATIONS_DISPLAY_CONFIG } from "@/components/settings/SettingsAutomations";
import { ScheduledJobDetail } from "@/components/scheduled-jobs/ScheduledJobDetail";
import {
  displayStateToSearch,
  normalizeDisplayState,
  type DisplaySearchParams,
} from "@/lib/list-view-display";

export const Route = createFileRoute(
  "/_authed/settings/automations/$scheduledJobId",
)({
  validateSearch: (search: Record<string, unknown>): DisplaySearchParams =>
    displayStateToSearch(
      normalizeDisplayState(search, AUTOMATIONS_DISPLAY_CONFIG),
      AUTOMATIONS_DISPLAY_CONFIG,
    ),
  component: SettingsAutomationDetailPage,
});

function SettingsAutomationDetailPage() {
  const { scheduledJobId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const backHref = `/settings/automations${toQueryString(search)}`;

  return (
    <OperatorGuard>
      <ScheduledJobDetail
        scheduledJobId={scheduledJobId}
        backHref={backHref}
        onDeleted={() => navigate({ to: "/settings/automations", search })}
      />
    </OperatorGuard>
  );
}

function toQueryString(search: DisplaySearchParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
