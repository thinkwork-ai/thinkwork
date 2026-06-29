import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_shell/memory/brain")({
  beforeLoad: () => {
    throw redirect({ to: "/memory/memories", replace: true });
  },
});
