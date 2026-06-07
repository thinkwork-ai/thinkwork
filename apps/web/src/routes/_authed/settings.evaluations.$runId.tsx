import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsEvalRunDetail } from "@/components/settings/SettingsEvalRunDetail";

export const Route = createFileRoute("/_authed/settings/evaluations/$runId")({
  component: () => (
    <OperatorGuard>
      <SettingsEvalRunDetail />
    </OperatorGuard>
  ),
});
