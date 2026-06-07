import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsEvalStudio } from "@/components/settings/SettingsEvalStudio";

export const Route = createFileRoute("/_authed/settings/evaluations/studio/")({
  component: () => (
    <OperatorGuard>
      <SettingsEvalStudio />
    </OperatorGuard>
  ),
});
