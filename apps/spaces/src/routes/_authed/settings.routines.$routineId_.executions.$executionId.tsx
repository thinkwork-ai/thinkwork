import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsRoutineExecutionDetail } from "@/components/settings/SettingsRoutineExecutionDetail";

export const Route = createFileRoute(
  "/_authed/settings/routines/$routineId_/executions/$executionId",
)({
  component: () => (
    <OperatorGuard>
      <SettingsRoutineExecutionDetail />
    </OperatorGuard>
  ),
});
