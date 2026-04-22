import { createFileRoute } from "@tanstack/react-router";
import { CostView } from "../-analytics/CostView";

export const Route = createFileRoute("/_authed/_tenant/analytics/cost")({
  component: CostView,
});
