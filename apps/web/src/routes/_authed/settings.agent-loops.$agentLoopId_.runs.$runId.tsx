import { createFileRoute, redirect } from "@tanstack/react-router";

// THINK-218: legacy Agent Loop run deep links redirect to the unified
// Workflows list.
export const Route = createFileRoute(
  "/_authed/settings/agent-loops/$agentLoopId_/runs/$runId",
)({
  beforeLoad: () => {
    throw redirect({ to: "/settings/workflows" });
  },
});
