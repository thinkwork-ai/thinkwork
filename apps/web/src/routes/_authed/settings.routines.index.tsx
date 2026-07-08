import { createFileRoute, redirect } from "@tanstack/react-router";

// THINK-218: the Routines list is now the Routines tab of the unified
// Workflows section. Routine *detail* routes (settings.routines.$routineId
// etc.) keep working unchanged — only the list index redirects.
export const Route = createFileRoute("/_authed/settings/routines/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/workflows", search: { tab: "routines" } });
  },
});
