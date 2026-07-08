import { createFileRoute, redirect } from "@tanstack/react-router";

// THINK-218: legacy Agent Loop detail deep links redirect to the unified
// Workflows list.
export const Route = createFileRoute(
  "/_authed/settings/agent-loops/$agentLoopId",
)({
  beforeLoad: () => {
    throw redirect({ to: "/settings/workflows" });
  },
});
