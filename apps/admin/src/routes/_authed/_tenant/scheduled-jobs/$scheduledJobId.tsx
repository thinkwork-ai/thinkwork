import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/scheduled-jobs/$scheduledJobId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/automations/schedules/$scheduledJobId",
      params,
    });
  },
});
