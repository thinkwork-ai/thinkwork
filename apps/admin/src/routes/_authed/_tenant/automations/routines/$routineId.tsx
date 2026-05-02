import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { Zap } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RoutineDetailQuery,
  TriggerRoutineRunMutation,
} from "@/lib/graphql-queries";
import {
  ExecutionList,
  parseStatusFilter,
  type StatusFilterId,
} from "@/components/routines/ExecutionList";

export const Route = createFileRoute("/_authed/_tenant/automations/routines/$routineId")({
  component: RoutineDetailPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): { status?: StatusFilterId } => {
    // Phase D U14: Status filter pills persist via URL search params so
    // a reload preserves the operator's view. parseStatusFilter()
    // normalizes any unknown value (e.g., a typoed deep-link) back to
    // "all" rather than rendering an unknown filter pill as active.
    const status = parseStatusFilter(search.status);
    return status === "all" ? {} : { status };
  },
});

function RoutineDetailPage() {
  const { routineId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const statusFilter: StatusFilterId = parseStatusFilter(search.status);

  const [result] = useQuery({
    query: RoutineDetailQuery,
    variables: { id: routineId },
  });
  const [triggerState, executeTrigger] = useMutation(TriggerRoutineRunMutation);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const handleRunNow = async () => {
    setTriggerError(null);
    const res = await executeTrigger({ routineId, input: null });
    if (res.error) {
      setTriggerError(res.error.message.replace(/^\[GraphQL\]\s*/, ""));
    }
  };

  const routine = result.data?.routine;
  useBreadcrumbs([
    { label: "Routines", href: "/automations/routines" },
    { label: routine?.name ?? "Loading..." },
  ]);

  if (result.fetching || !routine) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <PageHeader
          title={routine.name}
          description={routine.description ?? undefined}
          actions={<StatusBadge status={routine.status.toLowerCase()} />}
        />
      }
    >
      <Tabs defaultValue="runs">
        <div className="flex items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="runs">Runs</TabsTrigger>
            <TabsTrigger value="triggers">
              Scheduled Jobs ({routine.triggers.length})
            </TabsTrigger>
          </TabsList>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRunNow}
            disabled={triggerState.fetching}
          >
            <Zap className="h-3.5 w-3.5" />
            {triggerState.fetching ? "Starting…" : "Test"}
          </Button>
        </div>
        {triggerError && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">
            {triggerError}
          </p>
        )}

        <TabsContent value="runs" className="mt-4">
          <ExecutionList
            routineId={routineId}
            statusFilter={statusFilter}
            onStatusFilterChange={(next) =>
              navigate({
                to: "/automations/routines/$routineId",
                params: { routineId },
                search: next === "all" ? {} : { status: next },
                replace: true,
              })
            }
            emptyCta={
              statusFilter === "all" ? (
                <Button size="sm" asChild>
                  <Link to="/automations/schedules" search={{ type: "routine" }}>
                    Set up a trigger
                  </Link>
                </Button>
              ) : null
            }
          />
        </TabsContent>

        <TabsContent value="triggers" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              {routine.triggers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No scheduled jobs configured.
                </p>
              ) : (
                <div className="space-y-2">
                  {routine.triggers.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between py-1.5"
                    >
                      <span className="text-sm font-medium">
                        {t.triggerType}
                      </span>
                      <Badge variant={t.enabled ? "default" : "secondary"}>
                        {t.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
