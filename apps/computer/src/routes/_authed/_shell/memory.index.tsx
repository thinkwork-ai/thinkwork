import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_shell/memory/")({
  beforeLoad: () => {
    throw redirect({ to: "/memory/brain", replace: true });
  },
});
