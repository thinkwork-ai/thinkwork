import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import {
  Bot,
  Boxes,
  Database,
  FolderTree,
  Plug,
  Settings2,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "urql";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { type SpaceAdminDetailQuery as SpaceAdminDetailQueryResult } from "@/gql/graphql";
import { SpaceAdminDetailQuery } from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/spaces/$spaceId")({
  component: SpaceDetailPage,
});

type TabValue =
  | "overview"
  | "workspace"
  | "connected-data"
  | "tools"
  | "mcp"
  | "agents"
  | "settings";
type Space = NonNullable<SpaceAdminDetailQueryResult["space"]>;
type SpaceAgentAssignment = Space["agentAssignments"][number];
type SpaceMcpAssignment = Space["mcpServers"][number];

type ToolPolicyRow = {
  id: string;
  scope: string;
  policy: string;
  values: string;
};

type ConnectedDataRow = {
  id: string;
  source: string;
  summary: string;
};

function SpaceDetailPage() {
  const { spaceId } = Route.useParams();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabValue>("overview");

  const [spaceResult] = useQuery({
    query: SpaceAdminDetailQuery,
    variables: { id: spaceId },
    pause: !spaceId,
    requestPolicy: "cache-and-network",
  });

  const space = spaceResult.data?.space ?? null;
  useBreadcrumbs([
    { label: "Spaces", href: "/spaces" },
    { label: space?.name ?? "Space" },
  ]);

  const activeAssignments = useMemo(
    () =>
      (space?.agentAssignments ?? []).filter(
        (assignment) => assignment.status === "ACTIVE",
      ),
    [space?.agentAssignments],
  );
  const enabledMcpServers = useMemo(
    () => (space?.mcpServers ?? []).filter((assignment) => assignment.enabled),
    [space?.mcpServers],
  );
  const toolRows = useMemo(() => buildToolPolicyRows(space), [space]);
  const connectedDataRows = useMemo(
    () => buildConnectedDataRows(space),
    [space],
  );

  if (!tenantId || (spaceResult.fetching && !spaceResult.data)) {
    return <PageSkeleton />;
  }

  if (!space) {
    return (
      <PageLayout
        header={
          <PageHeader
            title="Space not found"
            description={spaceResult.error?.message}
          />
        }
      >
        <div className="text-sm text-muted-foreground">
          The Space could not be loaded or is not available to this tenant.
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      header={
        <>
          <PageHeader
            title={space.name}
            description={
              space.description ??
              `${formatLabel(space.kind)} contextual workroom`
            }
          />
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">{formatLabel(space.kind)}</Badge>
            <Badge variant={space.status === "ACTIVE" ? "default" : "outline"}>
              {formatLabel(space.status)}
            </Badge>
            <span className="text-muted-foreground">
              Updated {relativeTime(space.updatedAt)}
            </span>
          </div>
        </>
      }
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)}>
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="overview">
            <Boxes className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="workspace">
            <FolderTree className="h-4 w-4" />
            Workspace
          </TabsTrigger>
          <TabsTrigger value="connected-data">
            <Database className="h-4 w-4" />
            Connected Data
          </TabsTrigger>
          <TabsTrigger value="tools">
            <Wrench className="h-4 w-4" />
            Tools
          </TabsTrigger>
          <TabsTrigger value="mcp">
            <Plug className="h-4 w-4" />
            MCP Servers
          </TabsTrigger>
          <TabsTrigger value="agents">
            <Bot className="h-4 w-4" />
            Agents
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings2 className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-4">
            <MetricPanel
              label="Agents"
              value={activeAssignments.length}
              caption="available in this Space"
            />
            <MetricPanel
              label="MCP Servers"
              value={enabledMcpServers.length}
              caption="enabled for context"
            />
            <MetricPanel
              label="Tool Policies"
              value={toolRows.length}
              caption="explicit rules"
            />
            <MetricPanel
              label="Connected Data"
              value={connectedDataRows.length}
              caption="configured sources"
            />
            <InfoPanel title="Space Prompt" value={space.prompt} wide />
            <InfoPanel
              title="Render Diagnostics"
              value={formatJson(space.renderDiagnostics)}
              wide
            />
          </div>
        </TabsContent>

        <TabsContent value="workspace">
          <WorkspaceEditor
            target={{ spaceId: space.id }}
            mode="context"
            className="min-h-[620px]"
          />
        </TabsContent>

        <TabsContent value="connected-data">
          <div className="space-y-4">
            <DataTable
              columns={connectedDataColumns}
              data={connectedDataRows}
              pageSize={20}
            />
            <JsonPanel title="Context Config" value={space.contextConfig} />
            <JsonPanel
              title="Connected Data Config"
              value={space.connectedDataConfig}
            />
          </div>
        </TabsContent>

        <TabsContent value="tools">
          <div className="space-y-4">
            <DataTable
              columns={toolPolicyColumns}
              data={toolRows}
              pageSize={20}
            />
            <JsonPanel title="Tool Policy" value={space.toolPolicy} />
          </div>
        </TabsContent>

        <TabsContent value="mcp">
          <div className="space-y-4">
            <DataTable
              columns={mcpColumns}
              data={space.mcpServers}
              pageSize={20}
            />
            <JsonPanel title="MCP Policy" value={space.mcpPolicy} />
          </div>
        </TabsContent>

        <TabsContent value="agents">
          <DataTable
            columns={agentColumns}
            data={activeAssignments}
            pageSize={20}
            onRowClick={(row) => {
              if (row.agent?.id) {
                navigate({
                  to: "/agents/$agentId",
                  params: { agentId: row.agent.id },
                });
              }
            }}
          />
        </TabsContent>

        <TabsContent value="settings">
          <div className="grid gap-4 lg:grid-cols-2">
            <InfoPanel title="Slug" value={space.slug} />
            <InfoPanel title="Category" value={space.kind} />
            <InfoPanel title="Status" value={formatLabel(space.status)} />
            <InfoPanel
              title="Created"
              value={new Date(space.createdAt).toLocaleString()}
            />
            <JsonPanel
              title="Agent Availability"
              value={space.agentAvailabilityPolicy}
            />
            <JsonPanel title="Trigger Config" value={space.triggerConfig} />
            <JsonPanel title="Raw Config" value={space.config} wide />
          </div>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}

const agentColumns: ColumnDef<SpaceAgentAssignment>[] = [
  {
    accessorKey: "agent",
    header: "Agent",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate font-medium">
          {row.original.agent?.name ?? "Unassigned agent"}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {row.original.agent?.slug ?? row.original.agentId}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "localRole",
    header: "Space Role",
    cell: ({ row }) => row.original.localRole ?? "Member",
  },
  {
    accessorKey: "allowedTools",
    header: "Allowed Tools",
    cell: ({ row }) => summarizeJson(row.original.allowedTools),
  },
  {
    accessorKey: "autoSubscribe",
    header: "Subscribe",
    cell: ({ row }) => (row.original.autoSubscribe ? "Auto" : "Manual"),
    size: 100,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant="outline">{formatLabel(row.original.status)}</Badge>
    ),
    size: 120,
  },
];

const mcpColumns: ColumnDef<SpaceMcpAssignment>[] = [
  {
    accessorKey: "mcpServer",
    header: "Server",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate font-medium">
          {row.original.mcpServer?.name ?? row.original.mcpServerId}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {row.original.mcpServer?.slug ?? row.original.mcpServerId}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "authType",
    header: "Auth",
    cell: ({ row }) => row.original.mcpServer?.authType ?? "-",
    size: 130,
  },
  {
    accessorKey: "enabled",
    header: "Enabled",
    cell: ({ row }) => (row.original.enabled ? "Yes" : "No"),
    size: 100,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant="outline">
        {formatLabel(row.original.mcpServer?.status ?? "unknown")}
      </Badge>
    ),
    size: 130,
  },
];

const toolPolicyColumns: ColumnDef<ToolPolicyRow>[] = [
  {
    accessorKey: "scope",
    header: "Scope",
    cell: ({ row }) => row.original.scope,
  },
  {
    accessorKey: "policy",
    header: "Policy",
    cell: ({ row }) => row.original.policy,
  },
  {
    accessorKey: "values",
    header: "Values",
    cell: ({ row }) => (
      <span className="block max-w-xl truncate">{row.original.values}</span>
    ),
  },
];

const connectedDataColumns: ColumnDef<ConnectedDataRow>[] = [
  {
    accessorKey: "source",
    header: "Source",
    cell: ({ row }) => row.original.source,
  },
  {
    accessorKey: "summary",
    header: "Configuration",
    cell: ({ row }) => (
      <span className="block max-w-2xl truncate">{row.original.summary}</span>
    ),
  },
];

function MetricPanel({
  label,
  value,
  caption,
}: {
  label: string;
  value: number;
  caption: string;
}) {
  return (
    <section className="rounded-md border p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{caption}</div>
    </section>
  );
}

function InfoPanel({
  title,
  value,
  wide = false,
}: {
  title: string;
  value?: string | null;
  wide?: boolean;
}) {
  return (
    <section
      className={
        wide ? "rounded-md border p-3 lg:col-span-2" : "rounded-md border p-3"
      }
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">
        {value || "-"}
      </pre>
    </section>
  );
}

function JsonPanel({
  title,
  value,
  wide = false,
}: {
  title: string;
  value: unknown;
  wide?: boolean;
}) {
  return <InfoPanel title={title} value={formatJson(value)} wide={wide} />;
}

function buildToolPolicyRows(space: Space | null): ToolPolicyRow[] {
  if (!space) return [];
  const rows: ToolPolicyRow[] = [];
  appendPolicyRows(rows, "Space", space.toolPolicy);
  for (const assignment of space.agentAssignments) {
    appendPolicyRows(
      rows,
      assignment.agent?.name ?? assignment.agentId,
      assignment.allowedTools,
    );
  }
  return rows;
}

function appendPolicyRows(
  rows: ToolPolicyRow[],
  scope: string,
  policy: unknown,
) {
  const object = objectValue(policy);
  if (!object) return;
  for (const [key, value] of Object.entries(object)) {
    rows.push({
      id: `${scope}:${key}`,
      scope,
      policy: formatLabel(key),
      values: summarizeJson(value),
    });
  }
}

function buildConnectedDataRows(space: Space | null): ConnectedDataRow[] {
  if (!space) return [];
  const rows: ConnectedDataRow[] = [];
  appendConnectedDataRows(rows, "Context", space.contextConfig);
  appendConnectedDataRows(rows, "Connected Data", space.connectedDataConfig);
  return rows;
}

function appendConnectedDataRows(
  rows: ConnectedDataRow[],
  source: string,
  config: unknown,
) {
  const object = objectValue(config);
  if (!object) return;
  for (const [key, value] of Object.entries(object)) {
    rows.push({
      id: `${source}:${key}`,
      source: `${source} / ${formatLabel(key)}`,
      summary: summarizeJson(value),
    });
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function summarizeJson(value: unknown) {
  if (value == null) return "-";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatJson(value: unknown) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
