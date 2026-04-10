import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/agents/new")({
  beforeLoad: () => {
    throw redirect({ to: "/agents" });
  },
});
