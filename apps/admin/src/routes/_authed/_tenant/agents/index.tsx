import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useSubscription } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { AtSign, Bot, Plus } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
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
import {
  AgentsListQuery,
  OnAgentStatusChangedSubscription,
  SpacesListQuery,
} from "@/lib/graphql-queries";
import { AgentRuntime } from "@/gql/graphql";
import { useDialog } from "@/context/DialogContext";

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
  mentionHandle: string | null;
  assignedSpaces: string[];
};

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
        <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
        {row.original.name}
      </span>
    ),
  },
  {
    accessorKey: "mentionHandle",
    header: "Mention",
    cell: ({ row }) =>
      row.original.mentionHandle ? (
        <Badge variant="outline" className="gap-1 text-xs whitespace-nowrap">
          <AtSign className="h-3 w-3" />
          {row.original.mentionHandle}
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    size: 140,
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => {
      const role = row.original.role?.trim();
      return role ? (
        <span className="text-sm text-foreground whitespace-nowrap">
          {role}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      );
    },
    size: 140,
  },
  {
    accessorKey: "assignedSpaces",
    header: "Spaces",
    cell: ({ row }) =>
      row.original.assignedSpaces.length === 0 ? (
        <span className="text-xs text-muted-foreground">—</span>
      ) : (
        <div className="flex max-w-[320px] flex-wrap gap-1">
          {row.original.assignedSpaces.slice(0, 3).map((space) => (
            <Badge key={space} variant="outline" className="text-xs">
              {space}
            </Badge>
          ))}
          {row.original.assignedSpaces.length > 3 ? (
            <Badge variant="outline" className="text-xs">
              +{row.original.assignedSpaces.length - 3}
            </Badge>
          ) : null}
        </div>
      ),
    size: 220,
  },
  {
    accessorKey: "runtime",
    header: "Runtime",
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
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        <StatusBadge status={row.original.status.toLowerCase()} size="sm" />
      </span>
    ),
    size: 100,
  },
];

type SortField = "name" | "status" | "role";

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
  const [spacesResult] = useQuery({
    query: SpacesListQuery,
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
  const spaces = spacesResult.data?.spaces ?? [];

  const rows: AgentRow[] = useMemo(() => {
    const spacesByAgent = new Map<string, string[]>();
    for (const space of spaces) {
      for (const assignment of space.agentAssignments ?? []) {
        const agentId = assignment.agent?.id;
        if (!agentId || assignment.status === "ARCHIVED") continue;
        spacesByAgent.set(agentId, [
          ...(spacesByAgent.get(agentId) ?? []),
          space.name,
        ]);
      }
    }

    const mapped = agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role ?? null,
      type: a.type,
      status: a.status,
      runtime: (a as any).runtime ?? null,
      mentionHandle: a.slug ?? null,
      assignedSpaces: spacesByAgent.get(a.id) ?? [],
    }));
    const dir = sortDir === "asc" ? 1 : -1;
    mapped.sort((a, b) => {
      const av = a[sortField] ?? "";
      const bv = b[sortField] ?? "";
      if (typeof av === "string" && typeof bv === "string")
        return dir * av.localeCompare(bv);
      return dir * (Number(av) - Number(bv));
    });
    return mapped;
  }, [agents, spaces, sortField, sortDir]);

  if (!tenantId) return <PageSkeleton />;
  const isLoading = result.fetching && !result.data;

  return (
    <PageLayout
      header={
        <>
          <PageHeader
            title="Agents"
            description="Configure role-based agents that can be mentioned inside Spaces"
            actions={
              <Button onClick={() => openNewAgent()}>
                <Plus className="h-4 w-4" />
                New Agent
              </Button>
            }
          />
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
                  { value: "role", label: "Role" },
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
          description="Create a role-based agent, then assign it to a Space so people can mention it in Threads."
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
