import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authed/_tenant/analytics")({
  component: AnalyticsLayout,
});

type AnalyticsTab = "cost" | "activity" | "performance";

function AnalyticsLayout() {
  useBreadcrumbs([{ label: "Analytics" }]);
  const { pathname } = useLocation();

  const currentTab: AnalyticsTab = pathname.startsWith("/analytics/activity")
    ? "activity"
    : pathname.startsWith("/analytics/performance")
      ? "performance"
      : "cost";

  return (
    <PageLayout
      header={
        <div className="grid grid-cols-3 items-center">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight leading-tight text-foreground">
              Analytics
            </h1>
          </div>
          <div className="flex justify-center">
            <Tabs value={currentTab}>
              <TabsList>
                <TabsTrigger value="cost" asChild className="px-2">
                  <Link to="/analytics/cost">Usage Cost</Link>
                </TabsTrigger>
                <TabsTrigger value="activity" asChild className="px-2">
                  <Link to="/analytics/activity">Activity</Link>
                </TabsTrigger>
                <TabsTrigger value="performance" asChild className="px-2">
                  <Link to="/analytics/performance">Performance</Link>
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
