import { createFileRoute } from "@tanstack/react-router";
import { PluginDetail } from "@/components/settings/plugins/PluginDetail";

// Deliberately NOT wrapped in OperatorGuard (plan 2026-06-12-001 U8): members
// land here from the plugin OAuth callback and use Connect / Disconnect;
// install / update / retry / uninstall gate at render time on the operator
// role inside PluginDetail.
export const Route = createFileRoute("/_authed/settings/plugins/$pluginKey")({
  component: PluginDetail,
});
