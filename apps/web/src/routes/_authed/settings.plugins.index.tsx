import { createFileRoute } from "@tanstack/react-router";
import { SettingsPlugins } from "@/components/settings/SettingsPlugins";

// Deliberately NOT wrapped in OperatorGuard (plan 2026-06-12-001 U8): all
// members can browse plugins and reach the detail page to Connect; operator
// actions gate at render time inside the components.
export const Route = createFileRoute("/_authed/settings/plugins/")({
  component: SettingsPlugins,
});
