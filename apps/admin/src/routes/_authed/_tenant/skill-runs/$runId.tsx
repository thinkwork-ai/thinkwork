import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/skill-runs/$runId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/analytics/skill-runs/$runId",
      params: { runId: params.runId },
    });
  },
});
