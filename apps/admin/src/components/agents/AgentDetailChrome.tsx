import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { CalendarDays } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AgentDetailQuery,
  AgentsListQuery,
  DeleteAgentMutation,
  DeleteAgentBudgetPolicyMutation,
  SetAgentBudgetPolicyMutation,
  UpdateAgentMutation,
  UpdateAgentRuntimeMutation,
} from "@/lib/graphql-queries";
import { apiFetch } from "@/lib/api-fetch";
import { AgentRuntime } from "@/gql/graphql";
import { AgentFormDialog } from "./AgentFormDialog";
import { AgentHeaderBadges } from "./AgentHeaderBadges";
import { AgentRollbackButton } from "./AgentRollbackButton";

type AgentDetailTab = "dashboard" | "editor";

interface AgentDetailChromeContext {
  agent: any;
  tenantId: string;
  tenantSlug: string;
  refresh: () => void;
}

interface AgentDetailChromeProps {
  agentId: string;
  activeTab: AgentDetailTab;
  hasRecentActivity?: boolean;
  children: (context: AgentDetailChromeContext) => ReactNode;
}

export function AgentDetailChrome({
  agentId,
  activeTab,
  hasRecentActivity = false,
  children,
}: AgentDetailChromeProps) {
  const { tenantId, tenant } = useTenant();
  const tenantSlug = tenant?.slug ?? "";
  const navigate = useNavigate();

  const [result, reexecute] = useQuery({
    query: AgentDetailQuery,
    variables: { id: agentId },
  });
  const agent = result.data?.agent;

  const [, updateAgent] = useMutation(UpdateAgentMutation);
  const [, updateAgentRuntime] = useMutation(UpdateAgentRuntimeMutation);
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
          { label: "Workspace", href: `/agents/${parentAgent.id}/editor` },
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
      // Non-critical: the agent page can render without automation counts.
    }
  }, [tenantId, agentId]);

  useEffect(() => {
    fetchTriggerCount();
  }, [fetchTriggerCount]);

  const refresh = useCallback(() => {
    reexecute({ requestPolicy: "network-only" });
  }, [reexecute]);

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

  const handleSaveRuntime = useCallback(
    async (runtime: AgentRuntime) => {
      const res = await updateAgentRuntime({ id: agentId, runtime });
      if (!res.error) refresh();
    },
    [agentId, updateAgentRuntime, refresh],
  );

  const [editDialogOpen, setEditDialogOpen] = useState(false);

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
        <div className="space-y-3">
          <div className="grid items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
            <h1 className="min-w-0 truncate text-2xl font-bold leading-tight tracking-tight text-foreground">
              {agent.name}
            </h1>
            <div className="flex justify-start lg:justify-center">
              <Tabs value={activeTab}>
                <TabsList>
                  <TabsTrigger value="dashboard" asChild className="px-4">
                    <Link to="/agents/$agentId" params={{ agentId }}>
                      Dashboard
                    </Link>
                  </TabsTrigger>
                  <TabsTrigger value="editor" asChild className="px-4">
                    <Link
                      to="/agents/$agentId/editor"
                      params={{ agentId }}
                      search={{ folder: undefined }}
                    >
                      Workspace
                    </Link>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex justify-start lg:justify-end">
              {agent.slug ? (
                <button
                  type="button"
                  onClick={() => setEditDialogOpen(true)}
                  className="truncate text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {agent.slug}
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <AgentHeaderBadges
              agent={agent}
              tenantId={tenantId!}
              onSaveHumanPair={handleSaveHumanPair}
              onSaveBudget={handleSaveBudget}
              onDeleteBudget={handleDeleteBudget}
              onSaveRuntime={handleSaveRuntime}
            >
              <Link to="/automations/schedules" search={{ type: "agent", agentId }}>
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
      {children({ agent, tenantId: tenantId!, tenantSlug, refresh })}

      <AgentFormDialog
        mode="edit"
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        initial={{
          id: agentId,
          name: agent.name,
          templateId: (agent as any).templateId ?? "",
          runtime: (agent as any).runtime ?? AgentRuntime.Strands,
        }}
        hasRecentActivity={hasRecentActivity}
        onSaved={refresh}
        onDelete={handleDelete}
      />
    </PageLayout>
  );
}
