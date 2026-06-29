import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings/brain-operations")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/context-diagnostics", replace: true });
  },
});
