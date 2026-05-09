import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_shell/customize/")({
  beforeLoad: () => {
    throw redirect({ to: "/customize/connectors", replace: true });
  },
});
