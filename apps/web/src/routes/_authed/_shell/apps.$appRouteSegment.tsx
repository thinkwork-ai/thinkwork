import { createFileRoute } from "@tanstack/react-router";
import { PluginAppRoute } from "@/components/apps/PluginAppRoute";

export const Route = createFileRoute("/_authed/_shell/apps/$appRouteSegment")({
  component: AppRoute,
});

function AppRoute() {
  const { appRouteSegment } = Route.useParams();
  return <PluginAppRoute appRouteSegment={appRouteSegment} />;
}
