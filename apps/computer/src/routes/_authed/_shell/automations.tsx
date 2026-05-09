import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_shell/automations")({
  component: AutomationsLayout,
});

function AutomationsLayout() {
  return <Outlet />;
}
