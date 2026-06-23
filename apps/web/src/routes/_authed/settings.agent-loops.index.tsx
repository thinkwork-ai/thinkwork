import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings/agent-loops/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/automations" });
  },
});
