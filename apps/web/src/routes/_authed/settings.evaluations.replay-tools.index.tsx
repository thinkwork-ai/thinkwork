import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsEvalReplayTools } from "@/components/settings/SettingsEvalReplayTools";

export const Route = createFileRoute(
  "/_authed/settings/evaluations/replay-tools/",
)({
  component: () => (
    <OperatorGuard>
      <SettingsEvalReplayTools />
    </OperatorGuard>
  ),
});
