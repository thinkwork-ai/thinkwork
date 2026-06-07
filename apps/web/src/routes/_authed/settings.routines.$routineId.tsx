import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsRoutineDetail } from "@/components/settings/SettingsRoutineDetail";
import { parseStatusFilter } from "@/components/routines/ExecutionList";

export const Route = createFileRoute("/_authed/settings/routines/$routineId")({
  validateSearch: (search: Record<string, unknown>) => {
    const status = parseStatusFilter(search.status);
    return status === "all" ? {} : { status };
  },
  component: () => (
    <OperatorGuard>
      <SettingsRoutineDetail />
    </OperatorGuard>
  ),
});
