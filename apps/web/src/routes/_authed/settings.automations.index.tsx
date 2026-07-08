import { createFileRoute, redirect } from "@tanstack/react-router";

// THINK-218: Automations is retired as a Settings surface — the unified
// Workflows section replaces it. Old links redirect rather than 404.
export const Route = createFileRoute("/_authed/settings/automations/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/workflows" });
  },
});
