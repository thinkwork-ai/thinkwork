import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/agent/config")({
  beforeLoad: () => {
    throw redirect({ to: "/agent/files", replace: true });
  },
});
