import { createFileRoute } from "@tanstack/react-router";
import { ActivityView } from "../-analytics/ActivityView";

export const Route = createFileRoute("/_authed/_tenant/analytics/activity")({
  component: ActivityView,
});
