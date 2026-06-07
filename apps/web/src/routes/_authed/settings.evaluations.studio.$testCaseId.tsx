import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsEvalTestCaseDetail } from "@/components/settings/SettingsEvalTestCaseDetail";

export const Route = createFileRoute(
  "/_authed/settings/evaluations/studio/$testCaseId",
)({
  component: () => (
    <OperatorGuard>
      <SettingsEvalTestCaseDetail />
    </OperatorGuard>
  ),
});
