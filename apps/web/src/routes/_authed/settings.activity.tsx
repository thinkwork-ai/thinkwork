import { createFileRoute } from "@tanstack/react-router";
import { SettingsActivityHome } from "@/components/settings/SettingsActivityHome";

// Operators see Analytics as the default tab; members see their thread activity.
export const Route = createFileRoute("/_authed/settings/activity")({
  component: SettingsActivityHome,
});
