import { createFileRoute, redirect } from "@tanstack/react-router";

// /settings → /settings/activity (Eric 2026-07-22: Activity is the default
// section; General is reachable from the alphabetised nav).
export const Route = createFileRoute("/_authed/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/activity" });
  },
});
