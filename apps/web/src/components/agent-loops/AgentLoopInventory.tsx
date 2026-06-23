import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Badge, Button, DataTable, Input } from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  SettingsPane,
  SettingsTablePane,
} from "@/components/settings/SettingsContent";
import { StatusBadge } from "@/components/StatusBadge";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsAgentLoopsQuery,
  SettingsSaveAgentLoopMutation,
} from "@/lib/graphql-queries";
import {
  SettingsAgentProfilesQuery,
  SettingsTenantAgentQuery,
} from "@/lib/settings-queries";
import { AgentLoopForm } from "./AgentLoopForm";
import type {
  AgentLoopRow,
  AgentLoopWorkerOption,
  SaveAgentLoopPayload,
} from "./agent-loop-types";
import {
  formatCost,
  formatDateTime,
  jsonRecord,
  stringValue,
  titleize,
} from "./agent-loop-utils";

type AgentLoopsData = {
  agentLoops?: AgentLoopRow[];
};

type AgentProfilesData = {
  agentProfiles?: Array<{
    id: string;
    name: string;
    description?: string | null;
    enabled: boolean;
  }>;
};

type TenantAgentData = {
  agent?: {
    id: string;
    name?: string | null;
  } | null;
};

export function AgentLoopInventory() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

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
  const [, saveAgentLoop] = useMutation(SettingsSaveAgentLoopMutation);

  const workerOptions = useMemo(
    () =>
      buildWorkerOptions({
        agent: agentResult.data?.agent ?? null,
        profiles: profilesResult.data?.agentProfiles ?? [],
      }),
    [agentResult.data?.agent, profilesResult.data?.agentProfiles],
  );

  const rows = useMemo(
    () =>
      (loopsResult.data?.agentLoops ?? []).filter(
        (loop) => loop.lifecycleStatus !== "archived",
      ),
    [loopsResult.data?.agentLoops],
  );
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [
        row.name,
        row.description ?? "",
        row.lifecycleStatus,
        row.primaryTriggerFamily,
        triggerLabel(row),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [rows, search]);

  const columns = useMemo<ColumnDef<AgentLoopRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Automation",
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.name}</span>
          </div>
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
        id: "trigger",
        header: "Trigger",
        size: 160,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs">
            {triggerLabel(row.original)}
          </Badge>
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
        id: "accepted",
        header: "Accepted",
        size: 110,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.acceptedRunCount}
          </span>
        ),
      },
      {
        id: "cost",
        header: "Cost",
        size: 100,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatCost(row.original.totalCostUsdCents)}
          </span>
        ),
      },
    ],
    [],
  );

  async function createLoop(payload: SaveAgentLoopPayload) {
    const result = await saveAgentLoop({ input: payload });
    if (result.error) throw result.error;
    const id = (result.data as { saveAgentLoop?: { id?: string } })
      ?.saveAgentLoop?.id;
    toast.success("Automation created");
    setCreating(false);
    refetchLoops({ requestPolicy: "network-only" });
    if (id) {
      navigate({
        to: "/settings/agent-loops/$agentLoopId",
        params: { agentLoopId: id },
      });
    }
  }

  if (creating) {
    if (!tenantId || (agentResult.fetching && workerOptions.length === 0)) {
      return (
        <SettingsPane>
          <div className="flex items-center justify-center py-24">
            <LoadingShimmer />
          </div>
        </SettingsPane>
      );
    }
    return (
      <SettingsPane className="max-w-none">
        <AgentLoopForm
          mode="create"
          tenantId={tenantId}
          workerOptions={workerOptions}
          onSubmit={createLoop}
          onCancel={() => setCreating(false)}
        />
      </SettingsPane>
    );
  }

  return (
    <SettingsTablePane
      title="Automations"
      description="Create, run, and inspect recurring or manual automations."
      loading={loopsResult.fetching && !loopsResult.data}
      actions={
        <Button type="button" size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-2 size-4" />
          New Automation
        </Button>
      }
      toolbar={
        <Input
          className="h-9 w-64"
          placeholder="Search automations..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
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
          onRowClick={(row) =>
            navigate({
              to: "/settings/agent-loops/$agentLoopId",
              params: { agentLoopId: row.id },
            })
          }
        />
      )}
    </SettingsTablePane>
  );
}

export function buildWorkerOptions(input: {
  agent?: { id: string; name?: string | null } | null;
  profiles: Array<{
    id: string;
    name: string;
    description?: string | null;
    enabled: boolean;
  }>;
}): AgentLoopWorkerOption[] {
  const options: AgentLoopWorkerOption[] = [];
  if (input.agent?.id) {
    options.push({
      id: input.agent.id,
      type: "agent",
      label: input.agent.name ?? "Default Agent",
      description: "Tenant default Agent",
    });
  }
  for (const profile of input.profiles) {
    if (!profile.enabled) continue;
    options.push({
      id: profile.id,
      type: "agent_profile",
      label: profile.name,
      description: profile.description,
    });
  }
  return options;
}

function triggerLabel(row: AgentLoopRow): string {
  if (row.primaryTriggerFamily !== "schedule") {
    return titleize(row.primaryTriggerFamily);
  }
  const trigger = jsonRecord(row.currentVersion?.triggerSpec);
  const config = jsonRecord(trigger.config);
  return stringValue(config.scheduleExpression, "Schedule");
}
