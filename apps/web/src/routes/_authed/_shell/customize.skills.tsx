import { createFileRoute, redirect } from "@tanstack/react-router";

// The Customize→Skills tab was removed in Composer plan U3 (R10): skill
// wiring now happens in Settings→Composer (/settings/capabilities). The
// route survives only as a redirect so stale links land on the Customize
// index instead of a 404.
export const Route = createFileRoute("/_authed/_shell/customize/skills")({
  beforeLoad: () => {
    throw redirect({ to: "/customize", replace: true });
  },
});
