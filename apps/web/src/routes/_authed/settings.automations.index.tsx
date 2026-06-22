import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings/automations/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/agent-loops" });
  },
});
