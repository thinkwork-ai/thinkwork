import { createFileRoute } from "@tanstack/react-router";
import { PluginAppRoute } from "@/components/apps/PluginAppRoute";

export const Route = createFileRoute(
  "/_authed/_shell/apps/$pluginKey/$appRouteSegment",
)({
  component: AppRoute,
});

function AppRoute() {
  const { pluginKey, appRouteSegment } = Route.useParams();
  return (
    <PluginAppRoute pluginKey={pluginKey} appRouteSegment={appRouteSegment} />
  );
}
