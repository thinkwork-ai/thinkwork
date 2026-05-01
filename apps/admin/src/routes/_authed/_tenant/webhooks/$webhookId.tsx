import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/webhooks/$webhookId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/automations/webhooks/$webhookId",
      params,
    });
  },
});
