import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSubscription } from "urql";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, BrainCircuit, Loader2 } from "lucide-react";
import {
  ThreadTurnsQuery,
  ThreadsListQuery,
  OnThreadTurnUpdatedSubscription,
  OnThreadUpdatedSubscription,
} from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import { useCostData } from "@/hooks/useCostData";
import { useCostStore } from "@/stores/cost-store";
import { mapRuns, mapThreads, type ActivityItem } from "@/lib/activity-utils";
import { AgentMetrics } from "@/components/agents/AgentMetrics";
import { AgentActivity } from "@/components/agents/AgentActivity";
import { AgentDetailChrome } from "@/components/agents/AgentDetailChrome";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAgentContextPolicy,
  type AgentContextPolicy,
} from "@/lib/context-engine-api";

export const Route = createFileRoute("/_authed/_tenant/agents/$agentId")({
  component: AgentDetailPage,
});

function AgentDetailPage() {
  const { agentId } = Route.useParams();
  const { tenantId } = useTenant();

  // --- Activity data (tenant-wide, filtered client-side) ---
  const [threadsResult, reexecuteThreads] = useQuery({
    query: ThreadsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const [runsResult, reexecuteRuns] = useQuery({
    query: ThreadTurnsQuery,
    variables: { tenantId: tenantId!, limit: 100 },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const refreshActivity = useCallback(() => {
    const opts = { requestPolicy: "network-only" as const };
    reexecuteThreads(opts);
    reexecuteRuns(opts);
  }, [reexecuteThreads, reexecuteRuns]);

  // Live subscriptions — refetch on updates
  const [runSub] = useSubscription({
    query: OnThreadTurnUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  useEffect(() => {
    if (!runSub.data?.onThreadTurnUpdated) return;
    reexecuteRuns({ requestPolicy: "network-only" });
  }, [runSub.data, reexecuteRuns]);

  const [threadSub] = useSubscription({
    query: OnThreadUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  useEffect(() => {
    if (!threadSub.data?.onThreadUpdated) return;
    reexecuteThreads({ requestPolicy: "network-only" });
  }, [threadSub.data, reexecuteThreads]);

  // --- Cost data ---
  useCostData(tenantId);
  const agentCosts = useCostStore((s) => s.byAgent);
  const agentCost = agentCosts.find((c) => c.agentId === agentId);

  // --- Build agent map & activity items filtered to this agent ---
  const agentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of (threadsResult.data?.threads ?? []) as any[]) {
      if (t.agent) map.set(t.agent.id, t.agent.name);
    }
    return map;
  }, [threadsResult.data]);

  const agentActivityItems = useMemo<ActivityItem[]>(() => {
    const threads = ((threadsResult.data?.threads ?? []) as any[]).filter(
      (t: any) => t.agentId === agentId,
    );
    const threadTurns = (
      ((runsResult.data as any)?.threadTurns ?? []) as any[]
    ).filter((r: any) => r.agentId === agentId);
    const combined = [
      ...mapRuns(threadTurns, agentMap),
      ...mapThreads(threads, agentMap),
    ];
    return combined.sort((a, b) => b.timestamp - a.timestamp);
  }, [threadsResult.data, runsResult.data, agentMap, agentId]);

  // Runs and chats (for metrics)
  const agentRuns = useMemo(
    () => agentActivityItems.filter((i) => i.sourceType === "ticket_turn"),
    [agentActivityItems],
  );
  const agentChats = useMemo(
    () =>
      agentActivityItems.filter(
        (i) => i.sourceType === "thread" && i.type === "chat",
      ),
    [agentActivityItems],
  );
  const hasRecentActivity = useMemo(
    () =>
      agentActivityItems.some(
        (item) => Date.now() - item.timestamp < 5 * 60 * 1000,
      ),
    [agentActivityItems],
  );

  return (
    <AgentDetailChrome
      agentId={agentId}
      activeTab="dashboard"
      hasRecentActivity={hasRecentActivity}
    >
      {({ agent }) => (
        <div className="space-y-4">
          <AgentMetrics
            agentId={agentId}
            tenantId={tenantId || ""}
            agentCost={agentCost}
            runs={agentRuns}
            chats={agentChats}
          />

          <AgentContextPolicyCard agentId={agentId} />

          <AgentActivity
            items={agentActivityItems}
            onRefresh={refreshActivity}
            agentId={agentId}
            agentName={agent?.name}
          />
        </div>
      )}
    </AgentDetailChrome>
  );
}

function AgentContextPolicyCard({ agentId }: { agentId: string }) {
  const [policy, setPolicy] = useState<AgentContextPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAgentContextPolicy(agentId)
      .then((next) => {
        if (cancelled) return;
        setPolicy(next);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">Context Engine Policy</CardTitle>
          </div>
          {policy && (
            <Badge variant={policy.enabled ? "secondary" : "outline"}>
              {policy.enabled ? "enabled" : "disabled"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading policy...
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 text-yellow-500" />
            <p>
              {error.includes("Unknown tool")
                ? "Effective policy is unavailable until the Context Engine API deploy includes the admin policy tool."
                : error}
            </p>
          </div>
        ) : policy ? (
          <div className="grid gap-3 md:grid-cols-3">
            <PolicyColumn
              title="Tenant defaults"
              providers={policy.tenantDefaults}
            />
            <PolicyColumn
              title={
                policy.templateOverride.mode === "inherit"
                  ? "Template override"
                  : "Template selection"
              }
              providers={
                policy.templateOverride.mode === "inherit"
                  ? []
                  : policy.finalProviders
              }
              empty={
                policy.templateOverride.mode === "inherit"
                  ? "Inherits tenant defaults"
                  : "No adapters selected"
              }
            />
            <PolicyColumn
              title="Final providers"
              providers={policy.finalProviders}
              empty={
                policy.enabled
                  ? "No adapters will run"
                  : "Context Engine disabled"
              }
            />
            {policy.providerOptions &&
              Object.keys(policy.providerOptions).length > 0 && (
                <div className="md:col-span-3 rounded-md border p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Provider options
                  </p>
                  <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(policy.providerOptions, null, 2)}
                  </pre>
                </div>
              )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PolicyColumn({
  title,
  providers,
  empty = "None",
}: {
  title: string;
  providers: AgentContextPolicy["finalProviders"];
  empty?: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      {providers.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {providers.map((provider) => (
            <Badge key={provider.id} variant="outline" className="text-[11px]">
              {provider.displayName}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
