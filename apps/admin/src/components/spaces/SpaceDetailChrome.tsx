import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import {
  Bot,
  Pause,
  Play,
  Plus,
  Repeat,
  Webhook as WebhookIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";
import { ScheduledJobFormDialog } from "@/components/scheduled-jobs/ScheduledJobFormDialog";
import { SpaceEmailTriggersToggle } from "@/components/spaces/SpaceEmailTriggersToggle";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { WebhookFormDialog } from "@/components/webhooks/WebhookFormDialog";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { type SpaceAdminDetailQuery as SpaceAdminDetailQueryResult } from "@/gql/graphql";
import { apiFetch as authedApiFetch } from "@/lib/api-fetch";
import { listBuiltinTools, type BuiltinTool } from "@/lib/builtin-tools-api";
import {
  KnowledgeBasesListQuery,
  SetSpaceToolsMutation,
  SpaceMemoryQuery,
  SpaceToolsQuery,
  SetSpaceKnowledgeBasesMutation,
  SpaceAdminDetailQuery,
  UpdateSpaceMutation,
} from "@/lib/graphql-queries";
import { listMcpServers, type McpServer } from "@/lib/mcp-api";
import { relativeTime } from "@/lib/utils";

type SpaceDetailTab =
  | "configuration"
  | "workspace"
  | "tools"
  | "memory"
  | "automations";
type Space = NonNullable<SpaceAdminDetailQueryResult["space"]>;
type SpaceAccessMode = "PUBLIC" | "PRIVATE";
type SpaceDraft = {
  name: string;
  description: string;
  accessMode: SpaceAccessMode;
};

interface SpaceDetailChromeContext {
  space: Space;
  draft: SpaceDraft;
  setDraft: Dispatch<SetStateAction<SpaceDraft>>;
  refreshSpace: () => void;
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
                <TabsTrigger value="configuration" asChild className="px-4">
                  <Link
                    to="/spaces/$spaceId/configuration"
                    params={{ spaceId }}
                  >
                    Configuration
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="workspace" asChild className="px-4">
                  <Link to="/spaces/$spaceId/workspace" params={{ spaceId }}>
                    Workspace
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="tools" asChild className="px-4">
                  <Link to="/spaces/$spaceId/tools" params={{ spaceId }}>
                    Tools
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="memory" asChild className="px-4">
                  <Link to="/spaces/$spaceId/memory" params={{ spaceId }}>
                    Memory
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="automations" asChild className="px-4">
                  <Link to="/spaces/$spaceId/automations" params={{ spaceId }}>
                    Automations
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
        refreshSpace: () =>
          reexecuteSpaceQuery({ requestPolicy: "network-only" }),
      })}
    </PageLayout>
  );
}

export function SpaceConfigurationPanel({
  space,
  draft,
  setDraft,
  refreshSpace,
}: {
  space: Space;
  draft: SpaceDraft;
  setDraft: Dispatch<SetStateAction<SpaceDraft>>;
  refreshSpace: () => void;
}) {
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug ?? "";

  return (
    <div className="space-y-4">
      <section className="rounded-md border p-4">
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
      <SpaceEmailTriggersToggle
        tenantSlug={tenantSlug}
        space={{
          id: space.id,
          slug: space.slug,
          status: space.status,
          accessMode: space.accessMode,
          emailTriggersEnabled: space.emailTriggersEnabled,
        }}
        onSaved={refreshSpace}
      />
    </div>
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

export function SpaceToolsPanel({ space }: { space: Space }) {
  const { tenantId, tenant } = useTenant();
  const tenantSlug = tenant?.slug ?? "";
  const [builtInTools, setBuiltInTools] = useState<BuiltinTool[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [spaceToolsResult, reexecuteSpaceToolsQuery] = useQuery({
    query: SpaceToolsQuery,
    variables: { id: space.id },
    pause: !space.id,
    requestPolicy: "cache-and-network",
  });
  const selectedBuiltInToolSlugs =
    (spaceToolsResult.data as any)?.space?.builtInTools ?? [];
  const selectedMcpServerIds = (
    (spaceToolsResult.data as any)?.space?.mcpServers ?? []
  )
    .filter((assignment) => assignment.enabled)
    .map((assignment) => assignment.mcpServerId);
  const [selectedBuiltIns, setSelectedBuiltIns] = useState<string[]>(
    selectedBuiltInToolSlugs,
  );
  const [selectedMcpIds, setSelectedMcpIds] =
    useState<string[]>(selectedMcpServerIds);
  const [, setSpaceTools] = useMutation(SetSpaceToolsMutation);

  useEffect(() => {
    if (!tenantSlug) return;
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);

    Promise.all([listBuiltinTools(tenantSlug), listMcpServers(tenantSlug)])
      .then(([builtinResult, mcpResult]) => {
        if (cancelled) return;
        setBuiltInTools(builtinResult.tools);
        setMcpServers(mcpResult.servers);
      })
      .catch((err) => {
        if (cancelled) return;
        setCatalogError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  useEffect(() => {
    setSelectedBuiltIns(selectedBuiltInToolSlugs);
  }, [selectedBuiltInToolSlugs.join("|")]);

  useEffect(() => {
    setSelectedMcpIds(selectedMcpServerIds);
  }, [selectedMcpServerIds.join("|")]);

  const builtInToolBySlug = new Map(
    builtInTools.map((tool) => [tool.toolSlug, tool]),
  );
  const mcpServerById = new Map(
    mcpServers.map((server) => [server.id, server]),
  );
  const assignedMcpServers = new Map(
    ((spaceToolsResult.data as any)?.space?.mcpServers ?? [])
      .map((assignment) => assignment.mcpServer)
      .filter(Boolean)
      .map((server) => [server.id, server]),
  );

  const builtInOptions = [
    ...builtInTools.map((tool) => ({
      label: formatToolSlug(tool.toolSlug),
      value: tool.toolSlug,
      disabled: !selectedBuiltIns.includes(tool.toolSlug) && !tool.enabled,
    })),
    ...selectedBuiltIns
      .filter((slug) => !builtInToolBySlug.has(slug))
      .map((slug) => ({
        label: formatToolSlug(slug),
        value: slug,
        disabled: true,
      })),
  ];
  const mcpOptions = [
    ...mcpServers.map((server) => ({
      label: server.name,
      value: server.id,
      disabled:
        !selectedMcpIds.includes(server.id) &&
        (!server.enabled || server.status === "pending"),
    })),
    ...selectedMcpIds
      .filter((id) => !mcpServerById.has(id) && !assignedMcpServers.has(id))
      .map((id) => ({
        label: id,
        value: id,
        disabled: true,
      })),
  ];

  const selectedBuiltInTools = selectedBuiltIns.map((slug) => ({
    slug,
    label: formatToolSlug(slug),
    status:
      builtInToolBySlug.get(slug)?.enabled === false ? "disabled" : "enabled",
  }));
  const selectedMcpServers = selectedMcpIds
    .map((id) => mcpServerById.get(id) ?? assignedMcpServers.get(id))
    .filter(Boolean) as Array<{
    id: string;
    name: string;
    slug: string;
    enabled: boolean;
    status?: string | null;
  }>;

  async function saveTools(nextBuiltIns: string[], nextMcpIds: string[]) {
    if (!tenantId) return;
    setSelectedBuiltIns(nextBuiltIns);
    setSelectedMcpIds(nextMcpIds);

    const response = await setSpaceTools({
      input: {
        tenantId,
        spaceId: space.id,
        builtInToolSlugs: nextBuiltIns,
        mcpServerIds: nextMcpIds,
      },
    });

    if (response.error) {
      setSelectedBuiltIns(selectedBuiltInToolSlugs);
      setSelectedMcpIds(selectedMcpServerIds);
      toast.error(`Could not save tools: ${response.error.message}`);
      return;
    }

    toast.success("Tools saved.");
    reexecuteSpaceToolsQuery({ requestPolicy: "network-only" });
  }

  return (
    <section className="space-y-6 rounded-md border p-4">
      <div className="space-y-1.5">
        <Label>Built-in Tools</Label>
        <MultiSelect
          options={builtInOptions}
          defaultValue={selectedBuiltIns}
          onValueChange={(nextBuiltIns) =>
            saveTools(nextBuiltIns, selectedMcpIds)
          }
          placeholder={
            catalogLoading
              ? "Loading built-in tools..."
              : "Choose built-in tools"
          }
          emptyIndicator={
            <span className="text-sm text-muted-foreground">
              No configured built-in tools found.
            </span>
          }
          maxCount={4}
          disabled={catalogLoading && builtInTools.length === 0}
          className="w-full justify-between"
          popoverClassName="w-[var(--radix-popover-trigger-width)]"
          hideSelectAll
          deduplicateOptions
        />
      </div>

      <div className="space-y-1.5">
        <Label>MCP Servers</Label>
        <MultiSelect
          options={mcpOptions}
          defaultValue={selectedMcpIds}
          onValueChange={(nextMcpIds) =>
            saveTools(selectedBuiltIns, nextMcpIds)
          }
          placeholder={
            catalogLoading ? "Loading MCP servers..." : "Choose MCP servers"
          }
          emptyIndicator={
            <span className="text-sm text-muted-foreground">
              No MCP servers found.
            </span>
          }
          maxCount={4}
          disabled={catalogLoading && mcpServers.length === 0}
          className="w-full justify-between"
          popoverClassName="w-[var(--radix-popover-trigger-width)]"
          hideSelectAll
          deduplicateOptions
        />
      </div>

      {catalogError ? (
        <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {catalogError}
        </div>
      ) : null}

      <SelectedToolSummary
        builtInTools={selectedBuiltInTools}
        mcpServers={selectedMcpServers}
      />
    </section>
  );
}

function SelectedToolSummary({
  builtInTools,
  mcpServers,
}: {
  builtInTools: Array<{ slug: string; label: string; status: string }>;
  mcpServers: Array<{
    id: string;
    name: string;
    slug: string;
    enabled: boolean;
    status?: string | null;
  }>;
}) {
  if (builtInTools.length === 0 && mcpServers.length === 0) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        No tools selected.
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SelectedToolList
        title="Selected Built-in Tools"
        empty="No built-in tools selected."
        rows={builtInTools.map((tool) => ({
          id: tool.slug,
          label: tool.label,
          status: tool.status,
        }))}
      />
      <SelectedToolList
        title="Selected MCP Servers"
        empty="No MCP servers selected."
        rows={mcpServers.map((server) => ({
          id: server.id,
          label: server.name,
          status: server.status ?? (server.enabled ? "enabled" : "disabled"),
        }))}
      />
    </div>
  );
}

function SelectedToolList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Array<{ id: string; label: string; status: string }>;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">{title}</div>
      {rows.length > 0 ? (
        <div className="divide-y rounded-md border">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate font-medium">{row.label}</span>
              <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {row.status}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border p-3 text-sm text-muted-foreground">
          {empty}
        </div>
      )}
    </div>
  );
}

function formatToolSlug(slug: string) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function SpaceMemoryPanel({ space }: { space: Space }) {
  const { tenantId } = useTenant();
  const [spaceMemoryResult, reexecuteSpaceMemoryQuery] = useQuery({
    query: SpaceMemoryQuery,
    variables: { id: space.id },
    pause: !space.id,
    requestPolicy: "cache-and-network",
  });
  const spaceKnowledgeBases =
    (spaceMemoryResult.data as any)?.space?.knowledgeBases ?? [];
  const selectedKnowledgeBaseIds = spaceKnowledgeBases
    .filter((assignment) => assignment.enabled)
    .map((assignment) => assignment.knowledgeBaseId);
  const [selectedIds, setSelectedIds] = useState(selectedKnowledgeBaseIds);
  const [, setSpaceKnowledgeBases] = useMutation(
    SetSpaceKnowledgeBasesMutation,
  );
  const [knowledgeBasesResult] = useQuery({
    query: KnowledgeBasesListQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  useEffect(() => {
    setSelectedIds(selectedKnowledgeBaseIds);
  }, [selectedKnowledgeBaseIds.join("|")]);

  const knowledgeBases =
    (knowledgeBasesResult.data as any)?.knowledgeBases ?? [];
  const assignedKnowledgeBases = new Map(
    spaceKnowledgeBases
      .map((assignment) => assignment.knowledgeBase)
      .filter(Boolean)
      .map((knowledgeBase) => [knowledgeBase.id, knowledgeBase]),
  );
  const knowledgeBaseOptions = knowledgeBases.map(
    (knowledgeBase: { id: string; name: string; status: string }) => ({
      label: knowledgeBase.name,
      value: knowledgeBase.id,
      disabled:
        !selectedIds.includes(knowledgeBase.id) &&
        knowledgeBase.status !== "active",
    }),
  );
  const selectedKnowledgeBases = selectedIds
    .map(
      (id) =>
        knowledgeBases.find(
          (knowledgeBase: { id: string }) => knowledgeBase.id === id,
        ) ?? assignedKnowledgeBases.get(id),
    )
    .filter(Boolean) as Array<{ id: string; name: string; status: string }>;

  async function handleKnowledgeBasesChange(nextIds: string[]) {
    if (!tenantId) return;
    setSelectedIds(nextIds);
    const response = await setSpaceKnowledgeBases({
      input: {
        tenantId,
        spaceId: space.id,
        knowledgeBases: nextIds.map((knowledgeBaseId) => ({
          knowledgeBaseId,
          enabled: true,
        })),
      },
    });

    if (response.error) {
      setSelectedIds(selectedKnowledgeBaseIds);
      toast.error(`Could not save knowledge bases: ${response.error.message}`);
      return;
    }

    toast.success("Knowledge bases saved.");
    reexecuteSpaceMemoryQuery({ requestPolicy: "network-only" });
  }

  return (
    <section className="space-y-4 rounded-md border p-4">
      <div className="space-y-1.5">
        <Label>Knowledge Bases</Label>
        <MultiSelect
          options={knowledgeBaseOptions}
          defaultValue={selectedIds}
          onValueChange={handleKnowledgeBasesChange}
          placeholder={
            knowledgeBasesResult.fetching
              ? "Loading knowledge bases..."
              : "Choose knowledge bases"
          }
          emptyIndicator={
            <span className="text-sm text-muted-foreground">
              No knowledge bases found.
            </span>
          }
          maxCount={4}
          disabled={
            knowledgeBasesResult.fetching && knowledgeBases.length === 0
          }
          className="w-full justify-between"
          popoverClassName="w-[var(--radix-popover-trigger-width)]"
          hideSelectAll
          deduplicateOptions
        />
      </div>
      {selectedKnowledgeBases.length > 0 ? (
        <div className="divide-y rounded-md border">
          {selectedKnowledgeBases.map((knowledgeBase) => (
            <div
              key={knowledgeBase.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate font-medium">
                {knowledgeBase.name}
              </span>
              <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {knowledgeBase.status}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border p-3 text-sm text-muted-foreground">
          No knowledge bases selected.
        </div>
      )}
    </section>
  );
}

type ScheduledJobRow = {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  enabled: boolean;
  schedule_type: string | null;
  schedule_expression: string | null;
  timezone: string;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
};

type WebhookRow = {
  id: string;
  name: string;
  description: string | null;
  target_type: string;
  enabled: boolean;
  last_invoked_at: string | null;
  invocation_count: number;
  created_at: string;
};

type SpaceAutomationRow = {
  id: string;
  kind: "schedule" | "webhook";
  name: string;
  description: string | null;
  typeLabel: string;
  triggerLabel: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunOrDeliveryAt: string | null;
  createdAt: string;
};

const SPACE_AUTOMATION_TYPE_LABELS: Record<string, string> = {
  agent_heartbeat: "Heartbeat",
  agent_reminder: "Reminder",
  agent_scheduled: "Scheduled",
  eval_scheduled: "Evaluation",
  routine_schedule: "Routine",
  routine_one_time: "One-time",
};

async function spaceApiFetch<T>(
  path: string,
  tenantId: string,
  options: RequestInit = {},
): Promise<T> {
  const { headers, ...rest } = options;
  return authedApiFetch<T>(path, {
    ...rest,
    extraHeaders: {
      "x-tenant-id": tenantId,
      ...(headers as Record<string, string> | undefined),
    },
  });
}

function formatAutomationSchedule(expr: string | null): string {
  if (!expr) return "—";
  if (expr.startsWith("rate(")) return expr.slice(5, -1);
  if (expr.startsWith("at(")) {
    const value = expr.slice(3, -1);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
  return expr;
}

function estimateNextAutomationRun(
  scheduleExpr: string | null,
  lastRunAt: string | null,
): string | null {
  if (!scheduleExpr) return null;
  if (scheduleExpr.startsWith("at(")) {
    const date = new Date(scheduleExpr.slice(3, -1));
    return date.getTime() > Date.now() ? date.toISOString() : null;
  }
  if (!scheduleExpr.startsWith("rate(")) return null;
  const match = scheduleExpr
    .slice(5, -1)
    .trim()
    .match(/^(\d+)\s+(minute|hour|day|second)s?$/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const unitMs =
    unit === "second"
      ? 1000
      : unit === "minute"
        ? 60000
        : unit === "hour"
          ? 3600000
          : 86400000;
  const intervalMs = value * unitMs;
  const base = lastRunAt ? new Date(lastRunAt).getTime() : Date.now();
  if (!Number.isFinite(base) || intervalMs <= 0) return null;
  const elapsed = Date.now() - base;
  const periods = elapsed > 0 ? Math.ceil(elapsed / intervalMs) : 1;
  return new Date(base + periods * intervalMs).toISOString();
}

function automationColumns(): ColumnDef<SpaceAutomationRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.original.name}</span>
          {row.original.description ? (
            <span className="truncate text-xs text-muted-foreground">
              {row.original.description}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "typeLabel",
      header: "Type",
      cell: ({ row }) => {
        const Icon =
          row.original.kind === "webhook"
            ? WebhookIcon
            : row.original.typeLabel === "Routine" ||
                row.original.typeLabel === "One-time"
              ? Repeat
              : Bot;
        return (
          <Badge variant="secondary" className="gap-1 text-xs">
            <Icon className="h-3.5 w-3.5" />
            {row.original.typeLabel}
          </Badge>
        );
      },
      size: 150,
    },
    {
      accessorKey: "triggerLabel",
      header: "Schedule / Trigger",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.triggerLabel}
        </span>
      ),
    },
    {
      accessorKey: "enabled",
      header: "Status",
      cell: ({ row }) =>
        row.original.enabled ? (
          <Badge
            variant="secondary"
            className="gap-1 bg-green-500/15 text-xs text-green-600 dark:text-green-400"
          >
            <Play className="h-3 w-3 fill-current" />
            Enabled
          </Badge>
        ) : (
          <Badge
            variant="secondary"
            className="gap-1 bg-muted text-xs text-muted-foreground"
          >
            <Pause className="h-3 w-3" />
            Disabled
          </Badge>
        ),
      size: 120,
    },
    {
      accessorKey: "lastRunAt",
      header: "Last Run",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.lastRunAt ? relativeTime(row.original.lastRunAt) : "—"}
        </span>
      ),
      size: 120,
    },
    {
      accessorKey: "nextRunOrDeliveryAt",
      header: "Next Run / Last Delivery",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.nextRunOrDeliveryAt
            ? relativeTime(row.original.nextRunOrDeliveryAt)
            : "—"}
        </span>
      ),
      size: 180,
    },
  ];
}

export function SpaceAutomationsPanel({ space }: { space: Space }) {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJobRow[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [webhookDialogOpen, setWebhookDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchAutomations = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ spaceId: space.id }).toString();
      const [jobs, hooks] = await Promise.all([
        spaceApiFetch<ScheduledJobRow[]>(
          `/api/scheduled-jobs?${query}`,
          tenantId,
        ),
        spaceApiFetch<WebhookRow[]>(`/api/webhooks?${query}`, tenantId),
      ]);
      setScheduledJobs(jobs);
      setWebhooks(hooks);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [space.id, tenantId]);

  useEffect(() => {
    void fetchAutomations();
  }, [fetchAutomations]);

  const rows = useMemo<SpaceAutomationRow[]>(
    () =>
      [
        ...scheduledJobs.map((job) => ({
          id: job.id,
          kind: "schedule" as const,
          name: job.name,
          description: job.description,
          typeLabel:
            SPACE_AUTOMATION_TYPE_LABELS[job.trigger_type] ?? job.trigger_type,
          triggerLabel: formatAutomationSchedule(job.schedule_expression),
          enabled: job.enabled,
          lastRunAt: job.last_run_at,
          nextRunOrDeliveryAt:
            job.next_run_at ??
            estimateNextAutomationRun(job.schedule_expression, job.last_run_at),
          createdAt: job.created_at,
        })),
        ...webhooks.map((webhook) => ({
          id: webhook.id,
          kind: "webhook" as const,
          name: webhook.name,
          description: webhook.description,
          typeLabel: "Webhook",
          triggerLabel:
            webhook.target_type === "agent"
              ? "Agent webhook"
              : "Routine webhook",
          enabled: webhook.enabled,
          lastRunAt: null,
          nextRunOrDeliveryAt: webhook.last_invoked_at,
          createdAt: webhook.created_at,
        })),
      ].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [scheduledJobs, webhooks],
  );

  if (loading) return <PageSkeleton />;

  if (errorMessage) {
    return (
      <section className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">
        {errorMessage}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setWebhookDialogOpen(true)}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add Webhook
        </Button>
        <Button size="sm" onClick={() => setScheduleDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Add Schedule
        </Button>
      </div>
      <DataTable
        columns={automationColumns()}
        data={rows}
        pageSize={20}
        onRowClick={(row) => {
          if (row.kind === "schedule") {
            navigate({
              to: "/automations/schedules/$scheduledJobId",
              params: { scheduledJobId: row.id },
            });
          } else {
            navigate({
              to: "/automations/webhooks/$webhookId",
              params: { webhookId: row.id },
            });
          }
        }}
      />
      {tenantId ? (
        <>
          <ScheduledJobFormDialog
            open={scheduleDialogOpen}
            onOpenChange={setScheduleDialogOpen}
            mode="create"
            tenantId={tenantId}
            onSubmit={async (data) => {
              await spaceApiFetch("/api/scheduled-jobs", tenantId, {
                method: "POST",
                body: JSON.stringify({ ...data, spaceId: space.id }),
              });
              toast.success("Schedule added");
              await fetchAutomations();
            }}
          />
          <WebhookFormDialog
            open={webhookDialogOpen}
            onOpenChange={setWebhookDialogOpen}
            mode="create"
            tenantId={tenantId}
            onSubmit={async (data) => {
              await spaceApiFetch("/api/webhooks", tenantId, {
                method: "POST",
                body: JSON.stringify({ ...data, spaceId: space.id }),
              });
              toast.success("Webhook added");
              await fetchAutomations();
            }}
          />
        </>
      ) : null}
    </section>
  );
}

function EmptyPanel({ title }: { title: string }) {
  return (
    <section className="rounded-md border p-4 text-sm text-muted-foreground">
      {title}
    </section>
  );
}
