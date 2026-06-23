import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_shell/automations/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/automations" });
  },
});
