import { createFileRoute, redirect } from "@tanstack/react-router";

// /settings → /settings/general (the first section, visible to all members).
export const Route = createFileRoute("/_authed/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/general" });
  },
});
