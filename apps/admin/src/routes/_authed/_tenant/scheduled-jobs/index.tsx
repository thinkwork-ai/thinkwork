import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/scheduled-jobs/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/automations/schedules", search });
  },
});
