import { createFileRoute } from "@tanstack/react-router";
import { SettingsArtifacts } from "@/components/settings/SettingsArtifacts";

// List at exactly /settings/artifacts. Operator gating is handled by the
// parent layout route (settings.artifacts.tsx).
export const Route = createFileRoute("/_authed/settings/artifacts/")({
  component: SettingsArtifacts,
});
