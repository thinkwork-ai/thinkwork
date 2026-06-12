import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsEvalDatasetDetail } from "@/components/settings/SettingsEvalDatasetDetail";

export const Route = createFileRoute(
  "/_authed/settings/evaluations/datasets/$slug",
)({
  component: () => (
    <OperatorGuard>
      <SettingsEvalDatasetDetail />
    </OperatorGuard>
  ),
});
