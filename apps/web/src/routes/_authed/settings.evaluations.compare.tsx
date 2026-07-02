import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsEvalCompare } from "@/components/settings/SettingsEvalCompare";

export const Route = createFileRoute("/_authed/settings/evaluations/compare")({
  component: () => (
    <OperatorGuard>
      <SettingsEvalCompare />
    </OperatorGuard>
  ),
});
