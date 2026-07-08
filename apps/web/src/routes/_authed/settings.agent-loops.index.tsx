import { createFileRoute, redirect } from "@tanstack/react-router";

// THINK-218: Agent Loops (formerly re-routed to Automations) collapses into
// the unified Workflows section under Settings.
export const Route = createFileRoute("/_authed/settings/agent-loops/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/workflows" });
  },
});
