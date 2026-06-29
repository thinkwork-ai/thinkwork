import { createFileRoute } from "@tanstack/react-router";
import { PluginAppsIndexRoute } from "@/components/apps/PluginAppRoute";

export const Route = createFileRoute("/_authed/_shell/apps/")({
  component: PluginAppsIndexRoute,
});
