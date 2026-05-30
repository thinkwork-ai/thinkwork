import { createFileRoute } from "@tanstack/react-router";
import { LocalWorkspaceView } from "@/components/local-workspace/LocalWorkspaceView";

// Desktop-only inspector for the local Pi workspace cache. The nav entry is
// gated to the desktop build in SettingsSidebar; the view itself renders a
// graceful "only available in the desktop app" state if reached without the
// bridge (deep link / web). Return navigation is handled by the settings
// chrome (sidebar "Back to app" + header history controls), so no onClose.
export const Route = createFileRoute("/_authed/settings/local-workspace")({
  component: LocalWorkspaceView,
});
