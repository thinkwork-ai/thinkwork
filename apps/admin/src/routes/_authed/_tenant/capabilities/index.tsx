import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/capabilities/")({
  beforeLoad: () => {
    throw redirect({ to: "/capabilities/skills" });
  },
});
