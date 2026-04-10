import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Identity } from "@/components/Identity";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AgentsListQuery, TeamsListQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_tenant/org")({
  component: OrgPage,
});

function OrgPage() {
  const { tenantId } = useTenant();
  useBreadcrumbs([{ label: "Org Chart" }]);

  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  const [teamsResult] = useQuery({
    query: TeamsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  if (!tenantId) return <PageSkeleton />;

  const agents = agentsResult.data?.agents ?? [];
  const teams = teamsResult.data?.teams ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Organization" description="Team structure and agent hierarchy" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 *:data-[slot=card]:shadow-xs dark:*:data-[slot=card]:bg-card">
        <MetricCard label="Agents" value={agents.length} />
        <MetricCard label="Teams" value={teams.length} />
        <MetricCard label="Total Members" value={teams.reduce((s, h) => s + h.users.length, 0)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Agents</CardTitle></CardHeader>
          <CardContent>
            {agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agents registered.</p>
            ) : (
              <div className="space-y-3">
                {agents.map((agent) => (
                  <div key={agent.id} className="flex items-center justify-between">
                    <Identity name={agent.name} subtitle={agent.role ?? undefined} size="sm" />
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{agent.type.toLowerCase()}</Badge>
                      <StatusBadge status={agent.status.toLowerCase()} size="sm" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Teams</CardTitle></CardHeader>
          <CardContent>
            {teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">No teams created.</p>
            ) : (
              <div className="space-y-3">
                {teams.map((t) => (
                  <div key={team.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{team.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {team.agents.length} agent{team.agents.length !== 1 ? "s" : ""} · {team.users.length} user{team.users.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <StatusBadge status={team.status.toLowerCase()} size="sm" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
