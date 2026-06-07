import { createFileRoute, redirect } from "@tanstack/react-router";

// Wiki Memory folded into the unified Memory page (Wiki tab).
export const Route = createFileRoute("/_authed/settings/wiki")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/memory" });
  },
});
