import { createFileRoute } from "@tanstack/react-router";
import { SettingsAppearance } from "@/components/settings/SettingsAppearance";

export const Route = createFileRoute("/_authed/settings/appearance")({
  component: SettingsAppearance,
});
