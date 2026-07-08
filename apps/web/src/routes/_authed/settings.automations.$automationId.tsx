import { createFileRoute, redirect } from "@tanstack/react-router";

// THINK-218: legacy Automation detail deep links redirect to the unified
// Workflows list — Automations no longer has a standalone detail surface
// under Settings.
export const Route = createFileRoute(
  "/_authed/settings/automations/$automationId",
)({
  beforeLoad: () => {
    throw redirect({ to: "/settings/workflows" });
  },
});
