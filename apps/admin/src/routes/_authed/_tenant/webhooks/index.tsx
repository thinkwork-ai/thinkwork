import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/webhooks/")({
  beforeLoad: () => {
    throw redirect({ to: "/automations/webhooks" });
  },
});
