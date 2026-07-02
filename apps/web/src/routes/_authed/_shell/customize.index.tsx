import { createFileRoute, redirect } from "@tanstack/react-router";

// Skills was the former first tab; it moved to Settings→Composer in
// Composer plan U3, leaving Workflow Templates as the index target.
export const Route = createFileRoute("/_authed/_shell/customize/")({
  beforeLoad: () => {
    throw redirect({ to: "/customize/workflows", replace: true });
  },
});
