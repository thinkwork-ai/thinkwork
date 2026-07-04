import { createFileRoute, redirect } from "@tanstack/react-router";

// THINK-137 U8 (R8): the standalone Webhooks surface retired — every webhook is
// now an Automation with a `webhook` trigger. The list route redirects to
// Automations; old bookmarks keep working.
export const Route = createFileRoute("/_authed/settings/webhooks/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/automations", replace: true });
  },
});
