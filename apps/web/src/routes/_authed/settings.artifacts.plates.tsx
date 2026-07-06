import { createFileRoute } from "@tanstack/react-router";
import { SettingsArtifactsPlates } from "@/components/settings/SettingsArtifacts";

// Plate registry tab at /settings/artifacts/plates (THINK-153). Static segment
// wins over settings.artifacts.$id, and the parent layout route supplies the
// OperatorGuard.
export const Route = createFileRoute("/_authed/settings/artifacts/plates")({
  component: SettingsArtifactsPlates,
});
