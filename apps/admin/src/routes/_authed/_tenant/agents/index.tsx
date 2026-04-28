import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useSubscription } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Bot, Monitor, Plus, User, UserPlus } from "lucide-react";
import { IconCloudComputing } from "@tabler/icons-react";
import { useState, useMemo, useEffect } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FilterBarSearch,
  FilterBarSort,
} from "@/components/ui/data-table-filter-bar";
import { AgentsListQuery, OnAgentStatusChangedSubscription } from "@/lib/graphql-queries";
import { AgentRuntime } from "@/gql/graphql";
import { useDialog } from "@/context/DialogContext";
import { formatUsd, relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/agents/")({
  component: AgentsPage,
});

type AgentRow = {
  id: string;
  name: string;
  role: string | null;
  type: string;
  status: string;
  runtime: AgentRuntime | null;
  agentTemplateName: string | null;
  agentTemplateId: string | null;
  adapterType: string | null;
  isByob: boolean;
  humanPairName: string | null;
  budgetLimitUsd: number | null;
  lastHeartbeatAt: string | null;
};

const SERVERLESS_ADAPTERS = new Set(["sdk", "strands"]);

const formatHarness = (runtime: AgentRuntime | null | undefined): string => {
  if (!runtime) return "—";
  return runtime.charAt(0) + runtime.slice(1).toLowerCase();
};

const columns: ColumnDef<AgentRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5 font-medium whitespace-nowrap">
        {row.original.isByob ? (
          <Monitor className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        ) : (
          <IconCloudComputing className="h-3.5 w-3.5 shrink-0 text-blue-500" />
        )}
        {row.original.name}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="whitespace-nowrap"><StatusBadge status={row.original.status.toLowerCase()} size="sm" /></span>
    ),
    size: 100,
  },
  {
    accessorKey: "agentTemplateName",
    header: "Agent Template",
    cell: ({ row }) =>
      row.original.agentTemplateName ? (
        <Badge variant="outline" className="text-xs whitespace-nowrap">
          {row.original.agentTemplateName}
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    size: 140,
  },
  {
    accessorKey: "runtime",
    header: "Harness",
    cell: ({ row }) =>
      row.original.runtime ? (
        <Badge variant="outline" className="text-xs whitespace-nowrap">
          {formatHarness(row.original.runtime)}
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    size: 110,
  },
  {
    accessorKey: "humanPairName",
    header: "Human",
    cell: ({ row }) =>
      row.original.humanPairName ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
          <User className="h-3 w-3 shrink-0" />
          <span className="truncate max-w-[120px]">{row.original.humanPairName}</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "budgetLimitUsd",
    header: "Budget",
    cell: ({ row }) => {
      const { budgetLimitUsd } = row.original;
      if (budgetLimitUsd == null) return <span className="text-xs text-muted-foreground">—</span>;
      return (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatUsd(budgetLimitUsd, 0)}/mo
        </span>
      );
    },
    size: 120,
  },
  {
    accessorKey: "lastHeartbeatAt",
    header: "Heartbeat",
    cell: ({ row }) =>
      row.original.lastHeartbeatAt ? (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {relativeTime(row.original.lastHeartbeatAt)}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    size: 130,
  },
];

type SortField = "name" | "status" | "agentTemplateName" | "lastHeartbeatAt";

function AgentsPage() {
  const { tenantId } = useTenant();
  const { openNewAgent } = useDialog();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  useBreadcrumbs([{ label: "Agents" }]);

  const [result, reexecute] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  // Real-time: re-fetch when any agent status changes (create, delete, etc.)
  const [subResult] = useSubscription({
    query: OnAgentStatusChangedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  useEffect(() => {
    if (subResult.data?.onAgentStatusChanged) {
      reexecute({ requestPolicy: "network-only" });
    }
  }, [subResult.data, reexecute]);

  const agents = result.data?.agents ?? [];

  const rows: AgentRow[] = useMemo(() => {
    const mapped = agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role ?? null,
      type: a.type,
      status: a.status,
      runtime: (a as any).runtime ?? null,
      agentTemplateName: (a as any).agentTemplate?.name ?? null,
      agentTemplateId: (a as any).templateId ?? null,
      adapterType: a.adapterType ?? null,
      isByob: !!a.adapterType && !SERVERLESS_ADAPTERS.has(a.adapterType),
      humanPairName: a.humanPair?.name ?? a.humanPair?.email ?? null,
      budgetLimitUsd: (a as any).budgetPolicy?.limitUsd != null ? Number((a as any).budgetPolicy.limitUsd) : null,
      lastHeartbeatAt: a.lastHeartbeatAt ?? null,
    }));
    const dir = sortDir === "asc" ? 1 : -1;
    mapped.sort((a, b) => {
      const av = a[sortField] ?? "";
      const bv = b[sortField] ?? "";
      if (typeof av === "string" && typeof bv === "string") return dir * av.localeCompare(bv);
      return dir * (Number(av) - Number(bv));
    });
    return mapped;
  }, [agents, sortField, sortDir]);

  if (!tenantId) return <PageSkeleton />;
  const isLoading = result.fetching && !result.data;

  return (
    <PageLayout
      header={
        <>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">Agents</h1>
              <p className="text-xs text-muted-foreground">Manage and monitor your agents</p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => openNewAgent()}>
                <Plus className="h-4 w-4" />
                New Agent
              </Button>
              <Button variant="outline" onClick={() => navigate({ to: "/agents/invites" })}>
                <UserPlus className="h-4 w-4" />
                Invite BYOB
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <FilterBarSearch
              value={search}
              onChange={setSearch}
              placeholder="Search agents..."
              className="w-48"
            />
            <div className="ml-auto">
              <FilterBarSort
                options={[
                  { value: "name", label: "Name" },
                  { value: "status", label: "Status" },
                  { value: "agentTemplateName", label: "Agent Template" },
                  { value: "lastHeartbeatAt", label: "Heartbeat" },
                ]}
                field={sortField}
                direction={sortDir}
                onChange={(field, dir) => {
                  setSortField(field as SortField);
                  setSortDir(dir);
                }}
              />
            </div>
          </div>
        </>
      }
    >
      {agents.length === 0 && !isLoading ? (
        <EmptyState
          icon={Bot}
          title="No agents yet"
          description="Create your first agent to get started."
          action={{ label: "New Agent", onClick: () => openNewAgent() }}
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          filterValue={search}
          scrollable
          onRowClick={(row) =>
            navigate({ to: "/agents/$agentId", params: { agentId: row.id } })
          }
        />
      )}
    </PageLayout>
  );
}
