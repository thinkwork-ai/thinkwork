import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/skill-runs/")({
  beforeLoad: () => {
    throw redirect({
      to: "/analytics/skill-runs",
      search: { skillId: undefined, status: undefined, invocationSource: undefined },
    });
  },
});
