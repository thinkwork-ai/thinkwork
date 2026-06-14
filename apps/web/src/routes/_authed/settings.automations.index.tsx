import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import {
  AUTOMATIONS_DISPLAY_CONFIG,
  SettingsAutomations,
} from "@/components/settings/SettingsAutomations";
import {
  displayStateToSearch,
  normalizeDisplayState,
  type DisplaySearchParams,
} from "@/lib/list-view-display";

export const Route = createFileRoute("/_authed/settings/automations/")({
  validateSearch: (search: Record<string, unknown>): DisplaySearchParams =>
    displayStateToSearch(
      normalizeDisplayState(search, AUTOMATIONS_DISPLAY_CONFIG),
      AUTOMATIONS_DISPLAY_CONFIG,
    ),
  component: AutomationsRoute,
});

function AutomationsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const displayState = normalizeDisplayState(
    search,
    AUTOMATIONS_DISPLAY_CONFIG,
  );

  return (
    <OperatorGuard>
      <SettingsAutomations
        displayState={displayState}
        onDisplayStateChange={(nextState) =>
          navigate({
            search: displayStateToSearch(nextState, AUTOMATIONS_DISPLAY_CONFIG),
            replace: true,
          })
        }
      />
    </OperatorGuard>
  );
}
