import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings/routines/")({
  beforeLoad: () => {
    throw redirect({
      to: "/settings/workflows",
    });
  },
});
