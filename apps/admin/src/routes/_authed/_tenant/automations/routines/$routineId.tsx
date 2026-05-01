import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "urql";
import { ArrowLeft, Play } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Identity } from "@/components/Identity";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RoutineDetailQuery } from "@/lib/graphql-queries";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/automations/routines/$routineId")({
  component: RoutineDetailPage,
});

function RoutineDetailPage() {
  const { routineId } = Route.useParams();

  const [result] = useQuery({
    query: RoutineDetailQuery,
    variables: { id: routineId },
  });

  const routine = result.data?.routine;
  useBreadcrumbs([{ label: "Routines", href: "/automations/routines" }, { label: routine?.name ?? "Loading..." }]);

  if (result.fetching || !routine) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/automations/routines">
          <Button variant="ghost" size="icon-sm"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <PageHeader title={routine.name} description={routine.description ?? undefined} actions={<StatusBadge status={routine.status.toLowerCase()} />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs defaultValue="runs">
            <TabsList>
              <TabsTrigger value="runs">Runs ({routine.runs.length})</TabsTrigger>
              <TabsTrigger value="triggers">Scheduled Jobs ({routine.triggers.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="runs" className="mt-4">
              <Card>
                <CardContent className="pt-4">
                  {routine.runs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No runs yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {routine.runs.map((run) => (
                        <div key={run.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                          <div className="flex items-center gap-2">
                            <Play className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm font-mono text-muted-foreground">{run.id.slice(0, 8)}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {run.startedAt && <span className="text-xs text-muted-foreground">{relativeTime(run.startedAt)}</span>}
                            <StatusBadge status={run.status.toLowerCase()} size="sm" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="triggers" className="mt-4">
              <Card>
                <CardContent className="pt-4">
                  {routine.triggers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No scheduled jobs configured.</p>
                  ) : (
                    <div className="space-y-2">
                      {routine.triggers.map((t) => (
                        <div key={t.id} className="flex items-center justify-between py-1.5">
                          <span className="text-sm font-medium">{t.triggerType}</span>
                          <Badge variant={t.enabled ? "default" : "secondary"}>{t.enabled ? "Enabled" : "Disabled"}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Row label="Type" value={routine.type} />
            {routine.schedule && <Row label="Schedule" value={routine.schedule} />}
            {routine.agent && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Agent</span>
                <Identity name={routine.agent.name} size="sm" />
              </div>
            )}
            {routine.team && <Row label="Team" value={routine.team.name} />}
            {routine.lastRunAt && <Row label="Last Run" value={relativeTime(routine.lastRunAt)} />}
            {routine.nextRunAt && <Row label="Next Run" value={formatDateTime(routine.nextRunAt)} />}
            <Row label="Created" value={formatDateTime(routine.createdAt)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
