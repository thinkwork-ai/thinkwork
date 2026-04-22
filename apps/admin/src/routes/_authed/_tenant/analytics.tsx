import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authed/_tenant/analytics")({
  component: AnalyticsLayout,
});

type AnalyticsTab = "cost" | "activity" | "performance" | "skill-runs";

function AnalyticsLayout() {
  useBreadcrumbs([{ label: "Analytics" }]);
  const { pathname } = useLocation();

  const currentTab: AnalyticsTab = pathname.startsWith("/analytics/skill-runs")
    ? "skill-runs"
    : pathname.startsWith("/analytics/activity")
      ? "activity"
      : pathname.startsWith("/analytics/performance")
        ? "performance"
        : "cost";

  return (
    <PageLayout
      header={
        <div className="grid grid-cols-3 items-center">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
              Analytics
            </h1>
          </div>
          <div className="flex justify-center">
            <Tabs value={currentTab}>
              <TabsList>
                <TabsTrigger value="cost" asChild className="px-2">
                  <Link to="/analytics/cost">Cost</Link>
                </TabsTrigger>
                <TabsTrigger value="activity" asChild className="px-2">
                  <Link to="/analytics/activity">Activity</Link>
                </TabsTrigger>
                <TabsTrigger value="performance" asChild className="px-2">
                  <Link to="/analytics/performance">Performance</Link>
                </TabsTrigger>
                <TabsTrigger value="skill-runs" asChild className="px-2">
                  <Link
                    to="/analytics/skill-runs"
                    search={{ skillId: undefined, status: undefined, invocationSource: undefined }}
                  >
                    Runs
                  </Link>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div />
        </div>
      }
    >
      <Outlet />
    </PageLayout>
  );
}
