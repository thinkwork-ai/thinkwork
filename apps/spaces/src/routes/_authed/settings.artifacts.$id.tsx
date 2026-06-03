import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { AppletRouteContent } from "@/routes/_authed/_shell/artifacts.$id";

export const Route = createFileRoute("/_authed/settings/artifacts/$id")({
  component: SettingsArtifactDetail,
});

// Renders the applet detail INSIDE the Settings shell so the operator stays in
// the Settings sidebar instead of bouncing to the main app shell. `fill` makes
// the artifact canvas fill the settings content pane; `backHref` returns to the
// Settings artifacts list.
function SettingsArtifactDetail() {
  const { id } = Route.useParams();
  return (
    <OperatorGuard>
      <AppletRouteContent appId={id} backHref="/settings/artifacts" fill />
    </OperatorGuard>
  );
}
