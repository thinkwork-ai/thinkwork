import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/automations/")({
  beforeLoad: () => {
    throw redirect({ to: "/automations/routines" });
  },
});
