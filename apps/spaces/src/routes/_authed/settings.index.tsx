import { createFileRoute, redirect } from "@tanstack/react-router";

// /settings → /settings/appearance (the first personal-group section, visible
// to all members).
export const Route = createFileRoute("/_authed/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/appearance" });
  },
});
