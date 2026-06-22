import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authed/_shell/automations/$scheduledJobId",
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/settings/automations/$scheduledJobId",
      params,
    });
  },
});
