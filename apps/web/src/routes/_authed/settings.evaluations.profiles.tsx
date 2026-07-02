import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsEvalProfiles } from "@/components/settings/SettingsEvalProfiles";

export const Route = createFileRoute("/_authed/settings/evaluations/profiles")({
  component: () => (
    <OperatorGuard>
      <SettingsEvalProfiles />
    </OperatorGuard>
  ),
});
