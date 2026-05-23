import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/agent/")({
  beforeLoad: () => {
    throw redirect({
      to: "/agent/files",
      replace: true,
    });
  },
});
