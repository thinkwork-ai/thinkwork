import { createFileRoute } from "@tanstack/react-router";
import { SettingsArtifactShares } from "@/components/settings/SettingsArtifacts";

// Public share links tab at /settings/artifacts/shares (THINK-208 U6). Static
// segment wins over settings.artifacts.$id, and the parent layout route
// supplies the OperatorGuard.
export const Route = createFileRoute("/_authed/settings/artifacts/shares")({
  component: SettingsArtifactShares,
});
