import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_shell/spaces/")({
  beforeLoad: () => {
    throw redirect({ to: "/threads", replace: true });
  },
});
