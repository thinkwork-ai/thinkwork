import { createFileRoute } from "@tanstack/react-router";
import { AppletRouteContent } from "@/routes/_authed/_shell/artifacts.$id";

export const Route = createFileRoute("/_authed/settings/artifacts/$id")({
  component: SettingsArtifactDetail,
});

// Renders the applet detail INSIDE the Settings shell (via the parent
// settings.artifacts layout Outlet) so the operator stays in the Settings
// sidebar. `fill` makes the artifact canvas fill the settings content pane;
// `backHref`/`breadcrumbRoot` keep navigation within Settings. Operator gating
// is handled by the parent layout route.
function SettingsArtifactDetail() {
  const { id } = Route.useParams();
  return (
    <AppletRouteContent
      appId={id}
      fill
      backHref="/settings/artifacts"
      breadcrumbRoot={{ label: "Artifacts", href: "/settings/artifacts" }}
    />
  );
}
