import { createFileRoute, redirect } from "@tanstack/react-router";

// /workspace-reviews retired in U5 of the workspace-reviews routing refactor.
// System-agent reviews now surface in Inbox; paired-human reviews live on
// mobile. See docs/plans/2026-04-28-004-refactor-workspace-reviews-routing-and-removal-plan.md.
export const Route = createFileRoute("/_authed/_tenant/workspace-reviews/")({
  beforeLoad: () => {
    throw redirect({ to: "/inbox" });
  },
});
