import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/analytics/")({
  beforeLoad: () => {
    throw redirect({ to: "/analytics/cost" });
  },
});
