import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { type SpaceAdminDetailQuery as SpaceAdminDetailQueryResult } from "@/gql/graphql";
import {
  SpaceAdminDetailQuery,
  UpdateSpaceMutation,
} from "@/lib/graphql-queries";

type SpaceDetailTab =
  | "workspace"
  | "connected-data"
  | "tools"
  | "mcp"
  | "settings";
type Space = NonNullable<SpaceAdminDetailQueryResult["space"]>;
type SpaceMcpAssignment = Space["mcpServers"][number];
type SpaceAccessMode = "PUBLIC" | "PRIVATE";
type SpaceDraft = {
  name: string;
  description: string;
  accessMode: SpaceAccessMode;
};

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

interface SpaceDetailChromeContext {
  space: Space;
  draft: SpaceDraft;
  setDraft: Dispatch<SetStateAction<SpaceDraft>>;
  toolRows: ToolPolicyRow[];
  connectedDataRows: ConnectedDataRow[];
}

interface SpaceDetailChromeProps {
  spaceId: string;
  activeTab: SpaceDetailTab;
  children: (context: SpaceDetailChromeContext) => ReactNode;
}

export function SpaceDetailChrome({
  spaceId,
  activeTab,
  children,
}: SpaceDetailChromeProps) {
  const { tenantId } = useTenant();
  const [draft, setDraft] = useState<SpaceDraft>({
    name: "",
    description: "",
    accessMode: "PUBLIC",
  });
  const [updateResult, updateSpace] = useMutation(UpdateSpaceMutation);

  const [spaceResult, reexecuteSpaceQuery] = useQuery({
    query: SpaceAdminDetailQuery,
    variables: { id: spaceId },
    pause: !spaceId,
    requestPolicy: "cache-and-network",
  });

  const space = spaceResult.data?.space ?? null;

  useEffect(() => {
    if (!space) return;
    setDraft({
      name: space.name,
      description: space.description ?? "",
      accessMode: space.accessMode as SpaceAccessMode,
    });
  }, [space?.id, space?.name, space?.description, space?.accessMode]);

  useBreadcrumbs([
    { label: "Spaces", href: "/spaces" },
    { label: space?.name ?? "Space" },
  ]);

  const toolRows = useMemo(() => buildToolPolicyRows(space), [space]);
  const connectedDataRows = useMemo(
    () => buildConnectedDataRows(space),
    [space],
  );
  const dirty = Boolean(
    space &&
      (draft.name.trim() !== space.name ||
        (draft.description.trim() || null) !== (space.description ?? null) ||
        draft.accessMode !== space.accessMode),
  );
  const canSave =
    dirty && draft.name.trim().length > 0 && !updateResult.fetching;

  async function handleSaveSpace() {
    if (!space || !tenantId || !canSave) return;
    const response = await updateSpace({
      input: {
        tenantId,
        spaceId: space.id,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        accessMode: draft.accessMode,
      },
    });

    if (response.error) {
      toast.error(`Could not save Space: ${response.error.message}`);
      return;
    }

    const updated = response.data?.updateSpace;
    if (updated) {
      setDraft({
        name: updated.name,
        description: updated.description ?? "",
        accessMode: updated.accessMode as SpaceAccessMode,
      });
    }
    toast.success("Space saved.");
    reexecuteSpaceQuery({ requestPolicy: "network-only" });
  }

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
        <div className="grid items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
          <h1 className="min-w-0 truncate text-2xl font-bold leading-tight tracking-tight text-foreground">
            {space.name}
          </h1>
          <div className="flex justify-start lg:justify-center">
            <Tabs value={activeTab}>
              <TabsList>
                <TabsTrigger value="workspace" asChild className="px-4">
                  <Link to="/spaces/$spaceId/workspace" params={{ spaceId }}>
                    Workspace
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="connected-data" asChild className="px-4">
                  <Link
                    to="/spaces/$spaceId/connected-data"
                    params={{ spaceId }}
                  >
                    Connected Data
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="tools" asChild className="px-4">
                  <Link to="/spaces/$spaceId/tools" params={{ spaceId }}>
                    Tools
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="mcp" asChild className="px-4">
                  <Link to="/spaces/$spaceId/mcp" params={{ spaceId }}>
                    MCP Servers
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="settings" asChild className="px-4">
                  <Link to="/spaces/$spaceId/settings" params={{ spaceId }}>
                    Settings
                  </Link>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex justify-start lg:justify-end">
            {dirty ? (
              <Button size="sm" onClick={handleSaveSpace} disabled={!canSave}>
                {updateResult.fetching ? "Saving..." : "Save"}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {children({
        space,
        draft,
        setDraft,
        toolRows,
        connectedDataRows,
      })}
    </PageLayout>
  );
}

export function SpaceWorkspacePanel({ spaceId }: { spaceId: string }) {
  return (
    <WorkspaceEditor
      target={{ spaceId }}
      mode="context"
      className="min-h-[620px]"
    />
  );
}

export function SpaceConnectedDataPanel({
  space,
  connectedDataRows,
}: {
  space: Space;
  connectedDataRows: ConnectedDataRow[];
}) {
  return (
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
  );
}

export function SpaceToolsPanel({
  space,
  toolRows,
}: {
  space: Space;
  toolRows: ToolPolicyRow[];
}) {
  return (
    <div className="space-y-4">
      <DataTable columns={toolPolicyColumns} data={toolRows} pageSize={20} />
      <JsonPanel title="Tool Policy" value={space.toolPolicy} />
    </div>
  );
}

export function SpaceMcpPanel({ space }: { space: Space }) {
  return (
    <div className="space-y-4">
      <DataTable columns={mcpColumns} data={space.mcpServers} pageSize={20} />
      <JsonPanel title="MCP Policy" value={space.mcpPolicy} />
    </div>
  );
}

export function SpaceSettingsPanel({
  space,
  draft,
  setDraft,
}: {
  space: Space;
  draft: SpaceDraft;
  setDraft: Dispatch<SetStateAction<SpaceDraft>>;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-md border p-4 lg:col-span-2">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="space-name">Name</Label>
            <Input
              id="space-name"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="space-access">Access</Label>
            <Select
              value={draft.accessMode}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  accessMode: value as SpaceAccessMode,
                }))
              }
            >
              <SelectTrigger id="space-access">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PUBLIC">Public</SelectItem>
                <SelectItem value="PRIVATE">Private</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="space-description">Description</Label>
            <Textarea
              id="space-description"
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </div>
        </div>
      </section>
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
  );
}

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
