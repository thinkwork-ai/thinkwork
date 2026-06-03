import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsArtifacts } from "@/components/settings/SettingsArtifacts";

export const Route = createFileRoute("/_authed/settings/artifacts")({
  component: () => (
    <OperatorGuard>
      <SettingsArtifacts />
    </OperatorGuard>
  ),
});
