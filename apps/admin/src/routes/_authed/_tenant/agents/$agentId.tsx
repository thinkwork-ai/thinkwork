import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSubscription } from "urql";
import { useCallback, useEffect, useMemo } from "react";
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
