import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Search, X } from "lucide-react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Badge, Button, DataTable, Input } from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import { SettingsTablePane } from "@/components/settings/SettingsContent";
import { StatusBadge } from "@/components/StatusBadge";
import { useTenant } from "@/context/TenantContext";
import {
  SpacesQuery,
  SettingsAgentLoopsQuery,
  SettingsGitRoutinesQuery,
  SettingsSaveAgentLoopMutation,
} from "@/lib/graphql-queries";
import {
  SettingsAgentProfilesQuery,
  SettingsTenantAgentQuery,
  SettingsTenantMembersQuery,
} from "@/lib/settings-queries";
import { AgentLoopForm } from "./AgentLoopForm";
import {
  buildMemberOptions,
  buildRoutineOptions,
  buildWorkerOptions,
  buildWorkflowOptions,
  type RoutineRow,
  type TenantMemberRow,
} from "./agent-loop-options";
import type { AgentLoopRow, SaveAgentLoopPayload } from "./agent-loop-types";
import {
  defaultSpaceIdFromAgentRuntimeConfig,
  formatDateTime,
  jsonRecord,
  readTargetSpec,
  stringValue,
  titleize,
} from "./agent-loop-utils";

export { buildWorkerOptions };

type AgentLoopsData = { agentLoops?: AgentLoopRow[] };
type AgentProfilesData = {
  agentProfiles?: Array<{
    id: string;
    name: string;
    description?: string | null;
    enabled: boolean;
  }>;
};
type SpacesData = {
  spaces?: Array<{ id: string; name: string; slug?: string | null }>;
};
type TenantAgentData = {
  agent?: { id: string; name?: string | null; runtimeConfig?: unknown } | null;
};
type RoutinesData = { routines?: RoutineRow[] };
type MembersData = { tenantMembers?: TenantMemberRow[] };

const STATUS_TABS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
] as const;

type StatusTab = (typeof STATUS_TABS)[number]["id"];

export function AgentLoopInventory({
  routeScope = "settings",
}: {
  routeScope?: "main" | "settings";
}) {
  const { tenantId, userId } = useTenant();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [editingLoop, setEditingLoop] = useState<AgentLoopRow | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [statusTab, setStatusTab] = useState<StatusTab>("all");

  const [loopsResult, refetchLoops] = useQuery<AgentLoopsData>({
    query: SettingsAgentLoopsQuery,
    variables: { tenantId: tenantId ?? "", limit: 100 },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [agentResult] = useQuery<TenantAgentData>({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [profilesResult] = useQuery<AgentProfilesData>({
    query: SettingsAgentProfilesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [spacesResult] = useQuery<SpacesData>({
    query: SpacesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [routinesResult] = useQuery<RoutinesData>({
    query: SettingsGitRoutinesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [membersResult] = useQuery<MembersData>({
    query: SettingsTenantMembersQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [, saveAgentLoop] = useMutation(SettingsSaveAgentLoopMutation);

  const workerOptions = useMemo(
    () =>
      buildWorkerOptions({
        agent: agentResult.data?.agent ?? null,
        profiles: profilesResult.data?.agentProfiles ?? [],
      }),
    [agentResult.data?.agent, profilesResult.data?.agentProfiles],
  );
  const spaceOptions = useMemo(
    () => spacesResult.data?.spaces ?? [],
    [spacesResult.data?.spaces],
  );
  const routineOptions = useMemo(
    () => buildRoutineOptions(routinesResult.data?.routines ?? []),
    [routinesResult.data?.routines],
  );
  const workflowOptions = useMemo(
    () => buildWorkflowOptions(routinesResult.data?.routines ?? []),
    [routinesResult.data?.routines],
  );
  const memberOptions = useMemo(
    () =>
      buildMemberOptions(
        membersResult.data?.tenantMembers ?? [],
        userId ? { id: userId, label: "You" } : null,
      ),
    [membersResult.data?.tenantMembers, userId],
  );
  const defaultSpaceId = useMemo(
    () =>
      defaultSpaceIdFromAgentRuntimeConfig(
        agentResult.data?.agent?.runtimeConfig,
      ),
    [agentResult.data?.agent?.runtimeConfig],
  );

  const rows = useMemo(
    () =>
      (loopsResult.data?.agentLoops ?? []).filter(
        (loop) => loop.lifecycleStatus !== "archived",
      ),
    [loopsResult.data?.agentLoops],
  );

  const counts = useMemo(() => {
    const active = rows.filter((r) => r.lifecycleStatus === "active").length;
    const paused = rows.filter((r) => r.lifecycleStatus === "paused").length;
    return { all: rows.length, active, paused };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusTab === "active" && row.lifecycleStatus !== "active") {
        return false;
      }
      if (statusTab === "paused" && row.lifecycleStatus !== "paused") {
        return false;
      }
      if (!query) return true;
      return [
        row.name,
        row.description ?? "",
        row.lifecycleStatus,
        triggerLabel(row),
        targetLabel(row),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [rows, search, statusTab]);

  const columns = useMemo<ColumnDef<AgentLoopRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <span className="truncate font-medium">{row.original.name}</span>
        ),
      },
      {
        id: "trigger",
        header: "Trigger",
        size: 170,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs">
            {triggerLabel(row.original)}
          </Badge>
        ),
      },
      {
        id: "target",
        header: "Target",
        size: 150,
        cell: ({ row }) => (
          <Badge variant="secondary" className="text-xs">
            {targetLabel(row.original)}
          </Badge>
        ),
      },
      {
        id: "status",
        header: "Status",
        size: 120,
        cell: ({ row }) => (
          <StatusBadge status={row.original.lifecycleStatus} size="sm" />
        ),
      },
      {
        id: "lastRun",
        header: "Last run",
        size: 180,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.lastRunAt
              ? formatDateTime(row.original.lastRunAt)
              : "Never"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 56,
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Edit automation"
            onClick={(event) => {
              event.stopPropagation();
              setEditingLoop(row.original);
            }}
          >
            <Pencil className="size-4" />
          </Button>
        ),
      },
    ],
    [],
  );

  const openLoop = (id: string) => {
    if (routeScope === "main") {
      navigate({
        to: "/automations/$automationId",
        params: { automationId: id },
      });
      return;
    }
    navigate({
      to: "/settings/agent-loops/$agentLoopId",
      params: { agentLoopId: id },
    });
  };

  async function createLoop(payload: SaveAgentLoopPayload) {
    const result = await saveAgentLoop({ input: payload });
    if (result.error) throw result.error;
    const id = (result.data as { saveAgentLoop?: { id?: string } })
      ?.saveAgentLoop?.id;
    toast.success("Automation created");
    setCreating(false);
    refetchLoops({ requestPolicy: "network-only" });
    if (id) openLoop(id);
  }

  async function updateLoop(payload: SaveAgentLoopPayload) {
    const result = await saveAgentLoop({ input: payload });
    if (result.error) throw result.error;
    toast.success("Automation updated");
    setEditingLoop(null);
    refetchLoops({ requestPolicy: "network-only" });
  }

  const dialogOpen = (creating || editingLoop !== null) && Boolean(tenantId);
  const closeDialog = () => {
    setCreating(false);
    setEditingLoop(null);
  };

  return (
    <>
      {dialogOpen ? (
        <AgentLoopForm
          mode={editingLoop ? "edit" : "create"}
          tenantId={tenantId ?? ""}
          initialLoop={editingLoop}
          workerOptions={workerOptions}
          spaceOptions={spaceOptions}
          routineOptions={routineOptions}
          workflowOptions={workflowOptions}
          memberOptions={memberOptions}
          defaultSpaceId={defaultSpaceId}
          currentUserId={userId}
          onSubmit={editingLoop ? updateLoop : createLoop}
          onCancel={closeDialog}
        />
      ) : null}
      <SettingsTablePane
        title="Automations"
        description="Create, run, and inspect recurring or webhook automations."
        loading={loopsResult.fetching && !loopsResult.data}
        actions={
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-2 size-4" />
            New Automation
          </Button>
        }
        toolbar={
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusTab(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    statusTab === tab.id
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                  <span className="text-xs text-muted-foreground">
                    {counts[tab.id]}
                  </span>
                </button>
              ))}
            </div>
            {searchOpen ? (
              <div className="flex items-center gap-1">
                <Input
                  autoFocus
                  className="h-9 w-56"
                  placeholder="Search automations..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close search"
                  onClick={() => {
                    setSearch("");
                    setSearchOpen(false);
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Search"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="size-4" />
              </Button>
            )}
          </div>
        }
      >
        {loopsResult.error ? (
          <div className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
            {loopsResult.error.message}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filteredRows}
            scrollable
            emptyState={
              <div className="py-12 text-center text-sm text-muted-foreground">
                No automations found.
              </div>
            }
            onRowClick={(row) => openLoop(row.id)}
          />
        )}
      </SettingsTablePane>
    </>
  );
}

export function triggerLabel(row: AgentLoopRow): string {
  const family = row.primaryTriggerFamily;
  if (family === "webhook") return "Webhook";
  if (family !== "schedule") return titleize(family);
  const trigger = jsonRecord(row.currentVersion?.triggerSpec);
  const config = jsonRecord(trigger.config);
  return stringValue(config.scheduleExpression, "Schedule");
}

export function targetLabel(row: AgentLoopRow): string {
  const target = readTargetSpec(row.currentVersion);
  if (target.kind === "routine") return "Routine";
  if (target.kind === "workflow") return "Workflow";
  return "Agent thread";
}
