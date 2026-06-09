import { createFileRoute, redirect } from "@tanstack/react-router";

// Analytics folded into the unified Activity page (Analytics tab, the default).
export const Route = createFileRoute("/_authed/settings/analytics")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/activity" });
  },
});
