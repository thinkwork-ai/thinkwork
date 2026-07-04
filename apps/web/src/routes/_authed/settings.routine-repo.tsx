import { createFileRoute, redirect } from "@tanstack/react-router";

// Routine Repo folded into the Routines page (config lives behind the
// header cog). Keep the old path as a redirect for existing links.
export const Route = createFileRoute("/_authed/settings/routine-repo")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/routines" });
  },
});
