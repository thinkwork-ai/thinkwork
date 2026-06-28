import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings/wiki")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/memory" });
  },
});
