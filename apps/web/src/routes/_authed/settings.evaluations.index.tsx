import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsEvaluations } from "@/components/settings/SettingsEvaluations";

export const Route = createFileRoute("/_authed/settings/evaluations/")({
  component: () => (
    <OperatorGuard>
      <SettingsEvaluations />
    </OperatorGuard>
  ),
});
