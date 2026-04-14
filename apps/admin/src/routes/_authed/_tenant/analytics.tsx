import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgentsListQuery } from "@/lib/graphql-queries";
import { ActivityView } from "./-analytics/ActivityView";
import { CostView } from "./-analytics/CostView";
import { PerformanceView } from "./-analytics/PerformanceView";

type AnalyticsView = "activity" | "cost" | "performance";

function isAnalyticsView(v: unknown): v is AnalyticsView {
  return v === "activity" || v === "cost" || v === "performance";
}

export const Route = createFileRoute("/_authed/_tenant/analytics")({
  component: AnalyticsPage,
  validateSearch: (search: Record<string, unknown>): { view?: AnalyticsView } => ({
    ...(isAnalyticsView(search.view) ? { view: search.view } : {}),
  }),
});

function AnalyticsPage() {
  useBreadcrumbs([{ label: "Analytics" }]);
  const { tenantId } = useTenant();
  const { view } = Route.useSearch();
  const navigate = useNavigate();
  const active: AnalyticsView = view ?? "activity";
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || active !== "performance",
  });
  const allAgents = (agentsResult.data as any)?.agents ?? [];

  const setView = (next: AnalyticsView) => {
    navigate({
      to: "/analytics",
      search: next === "activity" ? {} : { view: next },
      replace: true,
    });
  };

  return (
    <PageLayout
      header={
        <PageHeader
          title="Analytics"
          actions={
            <>
              <ToggleGroup
                type="single"
                value={active}
                onValueChange={(v) => v && isAnalyticsView(v) && setView(v)}
                variant="outline"
              >
                <ToggleGroupItem value="activity" className="px-3 text-xs">Activity</ToggleGroupItem>
                <ToggleGroupItem value="cost" className="px-3 text-xs">Cost</ToggleGroupItem>
                <ToggleGroupItem value="performance" className="px-3 text-xs">Performance</ToggleGroupItem>
              </ToggleGroup>
              {active === "performance" && (
                <Select
                  value={selectedAgentId ?? "all"}
                  onValueChange={(v) => setSelectedAgentId(v === "all" ? null : v)}
                >
                  <SelectTrigger className="w-48 h-8 text-sm">
                    <SelectValue placeholder="All agents" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All agents</SelectItem>
                    {allAgents.map((a: { id: string; name: string }) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          }
        />
      }
    >
      {active === "activity" && <ActivityView />}
      {active === "cost" && <CostView />}
      {active === "performance" && <PerformanceView selectedAgentId={selectedAgentId} />}
    </PageLayout>
  );
}
