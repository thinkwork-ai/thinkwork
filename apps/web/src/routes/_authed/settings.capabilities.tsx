import { createFileRoute, redirect } from "@tanstack/react-router";

// The Composer's standalone route is retired (THINK-132 U7): Settings → Agent
// at /settings/agents IS the Composer surface now. This redirect holds for one
// release before removal so existing deep links keep resolving.
export const Route = createFileRoute("/_authed/settings/capabilities")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/agents", replace: true });
  },
});
