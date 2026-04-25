import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useSubscription } from "urql";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PageLayout } from "@/components/PageLayout";
import {
  AgentDetailQuery,
  AgentsListQuery,
  UpdateAgentMutation,
  DeleteAgentMutation,
  SetAgentBudgetPolicyMutation,
  DeleteAgentBudgetPolicyMutation,
  AgentKnowledgeBasesQuery,
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
import { AgentHeaderBadges } from "@/components/agents/AgentHeaderBadges";
import { AgentFormDialog } from "@/components/agents/AgentFormDialog";
import { AgentRollbackButton } from "@/components/agents/AgentRollbackButton";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, FolderOpen } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

export const Route = createFileRoute("/_authed/_tenant/agents/$agentId")({
  component: AgentDetailPage,
});

function AgentDetailPage() {
  const { agentId } = Route.useParams();
  const { tenantId, tenant } = useTenant();
  const tenantSlug = tenant?.slug ?? "";
  const navigate = useNavigate();

  // --- Agent detail ---
  const [result, reexecute] = useQuery({
    query: AgentDetailQuery,
    variables: { id: agentId },
  });

  const [, updateAgent] = useMutation(UpdateAgentMutation);
  const [, deleteAgent] = useMutation(DeleteAgentMutation);
  const [, notifyAgentStatus] = useMutation(`
    mutation NotifyAgentStatus($agentId: ID!, $tenantId: ID!, $status: String!, $name: String!) {
      notifyAgentStatus(agentId: $agentId, tenantId: $tenantId, status: $status, name: $name) {
        agentId tenantId status name updatedAt
      }
    }
  `);
  const [, setBudgetPolicy] = useMutation(SetAgentBudgetPolicyMutation);
  const [, deleteBudgetPolicy] = useMutation(DeleteAgentBudgetPolicyMutation);

  // Agent knowledge bases (separate query — not in codegen yet)
  const [kbResult, reexecuteKbs] = useQuery({
    query: AgentKnowledgeBasesQuery,
    variables: { id: agentId },
  });

  const agent = result.data?.agent;

  // Query all agents for breadcrumb switcher
  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  const agentPopoverItems = useMemo(
    () =>
      (agentsResult.data?.agents ?? []).map((a: any) => ({
        label: a.name,
        href: `/agents/${a.id}`,
      })),
    [agentsResult.data],
  );

  // Build breadcrumbs — sub-agents show parent in the trail
  const parentAgentId = (agent as any)?.parentAgentId;
  const parentAgent = parentAgentId
    ? ((agentsResult.data?.agents as any[]) ?? []).find(
        (a: any) => a.id === parentAgentId,
      )
    : null;

  useBreadcrumbs(
    parentAgent
      ? [
          { label: "Agents", href: "/agents" },
          { label: parentAgent.name, href: `/agents/${parentAgent.id}` },
          { label: "Builder", href: `/agents/${parentAgent.id}/workspace` },
          { label: agent?.name ?? "..." },
        ]
      : [
          { label: "Agents", href: "/agents" },
          {
            label: agent?.name ?? "Loading...",
            popoverItems: agentPopoverItems,
          },
        ],
  );

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

  // --- Config counts for summary ---
  const [triggerCount, setTriggerCount] = useState<number>(0);
  const fetchTriggerCount = useCallback(async () => {
    if (!tenantId) return;
    try {
      const triggers = await apiFetch<{ agent_id: string | null }[]>(
        "/api/scheduled-jobs",
        { extraHeaders: { "x-tenant-id": tenantId } },
      );
      setTriggerCount(triggers.filter((t) => t.agent_id === agentId).length);
    } catch {
      // non-critical (NotReadyError and transient failures both swallowed)
    }
  }, [tenantId, agentId]);
  useEffect(() => {
    fetchTriggerCount();
  }, [fetchTriggerCount]);

  const kbCount = (kbResult.data as any)?.agent?.knowledgeBases?.length ?? 0;
  const isSubAgent = !!(agent as any)?.parentAgentId;

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

  // --- Mutation callbacks ---
  const refresh = useCallback(() => {
    reexecute({ requestPolicy: "network-only" });
    reexecuteKbs({ requestPolicy: "network-only" });
  }, [reexecute, reexecuteKbs]);

  const handleDelete = useCallback(async () => {
    const res = await deleteAgent({ id: agentId });
    if (!res.error) {
      notifyAgentStatus({
        agentId,
        tenantId: tenantId!,
        status: "ARCHIVED",
        name: agent!.name,
      });
      navigate({ to: "/agents" });
    }
  }, [agentId, deleteAgent, notifyAgentStatus, tenantId, agent, navigate]);

  const handleSaveBudget = useCallback(
    async (input: {
      period: string;
      limitUsd: number;
      actionOnExceed: string;
    }) => {
      const res = await setBudgetPolicy({ agentId, input });
      if (!res.error) refresh();
    },
    [agentId, setBudgetPolicy, refresh],
  );

  const handleDeleteBudget = useCallback(async () => {
    const res = await deleteBudgetPolicy({ agentId });
    if (!res.error) refresh();
  }, [agentId, deleteBudgetPolicy, refresh]);

  const handleSaveHumanPair = useCallback(
    async (humanPairId: string | null) => {
      const res = await updateAgent({ id: agentId, input: { humanPairId } });
      if (!res.error) refresh();
    },
    [agentId, updateAgent, refresh],
  );

  // --- Edit dialog ---
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // --- Loading ---
  if (result.error && !agent) {
    return (
      <PageLayout
        header={
          <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
            Agent
          </h1>
        }
      >
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load agent: {result.error.message}
        </div>
      </PageLayout>
    );
  }
  if ((result.fetching && !result.data) || !agent) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
              {agent.name}
            </h1>
            {agent.slug && (
              <button
                type="button"
                onClick={() => setEditDialogOpen(true)}
                className="ml-auto text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                {agent.slug}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <AgentHeaderBadges
              agent={agent}
              tenantId={tenantId!}
              onSaveHumanPair={handleSaveHumanPair}
              onSaveBudget={handleSaveBudget}
              onDeleteBudget={handleDeleteBudget}
            >
              <Link
                to="/agents/$agentId/workspace"
                params={{ agentId }}
                search={{ folder: undefined }}
              >
                <Badge
                  variant="outline"
                  className="gap-1 cursor-pointer hover:bg-accent"
                >
                  <FolderOpen className="h-3 w-3" />
                  Workspace
                </Badge>
              </Link>
              <Link to="/scheduled-jobs" search={{ type: "agent", agentId }}>
                <Badge
                  variant="outline"
                  className={`gap-1 cursor-pointer hover:bg-accent ${triggerCount === 0 ? "text-muted-foreground" : ""}`}
                >
                  <CalendarDays className="h-3 w-3" />
                  {triggerCount > 0 && <>{triggerCount} </>}Automations
                </Badge>
              </Link>
              <AgentRollbackButton agentId={agentId} onRollback={refresh} />
            </AgentHeaderBadges>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Charts */}
        <AgentMetrics
          agentId={agentId}
          tenantId={tenantId || ""}
          agentCost={agentCost}
          runs={agentRuns}
          chats={agentChats}
        />

        {/* Activity */}
        <AgentActivity
          items={agentActivityItems}
          onRefresh={refreshActivity}
          agentId={agentId}
          agentName={agent?.name}
        />
      </div>

      <AgentFormDialog
        mode="edit"
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        initial={{
          id: agentId,
          name: agent.name,
          templateId: (agent as any).templateId ?? "",
        }}
        onSaved={refresh}
        onDelete={handleDelete}
      />
    </PageLayout>
  );
}
