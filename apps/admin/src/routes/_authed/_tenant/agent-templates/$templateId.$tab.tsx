import { useState, useEffect, useCallback, useMemo } from "react";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery, useMutation } from "urql";
import {
  Save,
  Loader2,
  Plus,
  Trash2,
  Cable,
  Search,
  Mail,
  BrainCircuit,
  Settings2,
} from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { DataTable } from "@/components/ui/data-table";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { MultiSelect } from "@/components/ui/multi-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ModelSelect } from "@/components/agents/ModelSelect";
import {
  listContextProviders,
  type ContextProviderSummary,
} from "@/lib/context-engine-api";
import {
  AgentTemplateDetailQuery,
  CreateAgentTemplateMutation,
  UpdateAgentTemplateMutation,
  DeleteAgentTemplateMutation,
  LinkedAgentsForTemplateQuery,
} from "@/lib/graphql-queries";
import {
  listMcpServers,
  getTemplateMcpServers,
  assignMcpToTemplate,
  unassignMcpFromTemplate,
  getMcpKeyStatus,
  type McpServer,
  type McpKeyStatus,
} from "@/lib/mcp-api";
import { ApiKeyDialog } from "@/components/mcp/ApiKeyDialog";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";
import { TemplateSyncDialog } from "./-components/TemplateSyncDialog";
import { AgentRuntime } from "@/gql/graphql";

const VALID_TABS = ["configuration", "workspace", "mcp-servers"] as const;
type TabSlug = (typeof VALID_TABS)[number];

export const Route = createFileRoute(
  "/_authed/_tenant/agent-templates/$templateId/$tab",
)({
  beforeLoad: ({ params }) => {
    if (params.tab === "skills") {
      throw redirect({
        to: "/agent-templates/$templateId/$tab",
        params: { templateId: params.templateId, tab: "workspace" },
        replace: true,
      });
    }
  },
  component: TemplateEditorPage,
});

const CATEGORIES = [
  { value: "customer_support", label: "Customer Support" },
  { value: "sales", label: "Sales" },
  { value: "engineering", label: "Engineering" },
  { value: "personal", label: "Personal" },
  { value: "operations", label: "Operations" },
  { value: "custom", label: "Custom" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;
type MemoryQueryMode = "recall" | "reflect";

function parseJsonRecord(value: unknown): JsonRecord {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value as JsonRecord)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as JsonRecord)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function providerIdsFromConfig(value: JsonRecord): string[] | null {
  const providers = parseJsonRecord(value.providers);
  if (!Array.isArray(providers.ids)) return null;
  return providers.ids.filter((id): id is string => typeof id === "string");
}

function memoryModeFromConfig(value: JsonRecord): MemoryQueryMode {
  const options = parseJsonRecord(value.providerOptions);
  const memory = parseJsonRecord(options.memory);
  return memory.queryMode === "recall" ? "recall" : "reflect";
}

function TemplateEditorPage() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const tenantSlug = tenant?.slug;
  const navigate = useNavigate();
  const { templateId, tab: tabParam } = Route.useParams();
  const isNew = templateId === "new";
  const tab: TabSlug = (VALID_TABS as readonly string[]).includes(tabParam)
    ? (tabParam as TabSlug)
    : "configuration";

  useBreadcrumbs([
    { label: "Templates", href: "/agent-templates" },
    { label: isNew ? "New Template" : "Edit Template" },
  ]);

  // State -- config
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("");
  const [icon, setIcon] = useState("");
  const [model, setModel] = useState("");
  const [runtime, setRuntime] = useState<AgentRuntime>(AgentRuntime.Strands);
  const [templateConfig, setTemplateConfig] = useState<JsonRecord>({});
  const [blockedTools, setBlockedTools] = useState<string[]>([]);
  const [guardrailId, setGuardrailId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);

  // State -- sandbox (null persisted ⇒ template does not use the sandbox).
  // required_connections is intentionally not surfaced: OAuth token
  // injection into the sandbox process space is a named residual threat
  // (T1/T1b/T2) — agents that need OAuth'd work should call a composable
  // skill instead. execute_code stays a pure-compute primitive.
  type SandboxEnv = "default-public" | "internal-only";
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [sandboxEnv, setSandboxEnv] = useState<SandboxEnv>("default-public");
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [sendEmailEnabled, setSendEmailEnabled] = useState(true);
  const [contextEngineEnabled, setContextEngineEnabled] = useState(true);
  const [contextEngineProviderIds, setContextEngineProviderIds] = useState<
    string[] | null
  >(null);
  const [contextEngineMemoryQueryMode, setContextEngineMemoryQueryMode] =
    useState<MemoryQueryMode>("reflect");
  const [contextEngineDialogOpen, setContextEngineDialogOpen] = useState(false);
  const [contextProviders, setContextProviders] = useState<
    ContextProviderSummary[]
  >([]);
  const [contextProvidersLoading, setContextProvidersLoading] = useState(true);
  const [contextProvidersError, setContextProvidersError] = useState<
    string | null
  >(null);

  // State -- MCP servers
  const [templateMcpServers, setTemplateMcpServers] = useState<
    Array<{ mcp_server_id: string; enabled: boolean }>
  >([]);
  const [availableMcpServers, setAvailableMcpServers] = useState<McpServer[]>(
    [],
  );
  const [addMcpDialogOpen, setAddMcpDialogOpen] = useState(false);
  // tenant_api_key servers: id → {hasKey, lastFour}. Used to decide
  // whether enabling the toggle needs to open the ApiKeyDialog first
  // and to render the last-4 preview badge.
  const [mcpKeyStatus, setMcpKeyStatus] = useState<
    Record<string, McpKeyStatus>
  >({});
  const [apiKeyDialogServer, setApiKeyDialogServer] =
    useState<McpServer | null>(null);

  // Fetch existing template
  const [result, reexecute] = useQuery({
    query: AgentTemplateDetailQuery,
    variables: { id: templateId },
    pause: isNew,
  });

  const [, createTemplate] = useMutation(CreateAgentTemplateMutation);
  const [, updateTemplate] = useMutation(UpdateAgentTemplateMutation);
  const [, deleteTemplateMut] = useMutation(DeleteAgentTemplateMutation);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Linked agents for post-save sync dialog
  const [{ data: linkedAgentsData }, refetchLinkedAgents] = useQuery({
    query: LinkedAgentsForTemplateQuery,
    variables: { templateId },
    pause: isNew,
  });
  const linkedAgentCount =
    linkedAgentsData?.linkedAgentsForTemplate?.length ?? 0;
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setContextProvidersLoading(true);
    listContextProviders()
      .then((providers) => {
        if (cancelled) return;
        setContextProviders(providers);
        const enabledProviderIds = new Set(
          providers
            .filter((provider) => provider.enabled !== false)
            .map((provider) => provider.id),
        );
        setContextEngineProviderIds((current) =>
          current
            ? current.filter((id) => enabledProviderIds.has(id))
            : current,
        );
        setContextProvidersError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setContextProvidersError(
            err instanceof Error ? err.message : String(err),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setContextProvidersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentSnapshot = useMemo(
    () =>
      stableJson({
        name,
        slug,
        description,
        category,
        icon,
        model,
        runtime,
        blockedTools: [...blockedTools].sort(),
        guardrailId,
        sandboxEnabled,
        sandboxEnv,
        browserEnabled,
        webSearchEnabled,
        sendEmailEnabled,
        contextEngineEnabled,
        contextEngineProviderIds,
        contextEngineMemoryQueryMode,
      }),
    [
      name,
      slug,
      description,
      category,
      icon,
      model,
      runtime,
      blockedTools,
      guardrailId,
      sandboxEnabled,
      sandboxEnv,
      browserEnabled,
      webSearchEnabled,
      sendEmailEnabled,
      contextEngineEnabled,
      contextEngineProviderIds,
      contextEngineMemoryQueryMode,
    ],
  );
  const isDirty = isNew || initialSnapshot !== currentSnapshot;
  const canSave = Boolean(name && slug && model && isDirty && !saving);

  // Populate form from fetched data
  useEffect(() => {
    if (result.data?.agentTemplate) {
      const t = result.data.agentTemplate;
      const parsedConfig = parseJsonRecord(t.config);
      setName(t.name);
      setSlug(t.slug);
      setDescription(t.description || "");
      setCategory(t.category || "");
      setIcon(t.icon || "");
      setModel(t.model || "");
      setRuntime(t.runtime ?? AgentRuntime.Strands);
      setTemplateConfig(parsedConfig);

      // blocked tools
      let parsedBlockedTools: string[] = [];
      if (t.blockedTools) {
        const parsed =
          typeof t.blockedTools === "string"
            ? JSON.parse(t.blockedTools)
            : t.blockedTools;
        parsedBlockedTools = Array.isArray(parsed) ? parsed : [];
      }
      setBlockedTools(parsedBlockedTools);

      // guardrail
      setGuardrailId(t.guardrailId || null);

      // Sandbox opt-in hydration. AWSJSON may arrive as string or object;
      // null means the template doesn't use the sandbox. required_connections
      // from older rows is read but no longer editable from the UI.
      const sbRaw = (t as any).sandbox;
      const sb = typeof sbRaw === "string" && sbRaw ? JSON.parse(sbRaw) : sbRaw;
      let nextSandboxEnabled = false;
      let nextSandboxEnv: SandboxEnv = "default-public";
      if (sb && typeof sb === "object") {
        nextSandboxEnabled = true;
        nextSandboxEnv =
          sb.environment === "internal-only"
            ? "internal-only"
            : "default-public";
      }
      setSandboxEnabled(nextSandboxEnabled);
      setSandboxEnv(nextSandboxEnv);

      const browserRaw = (t as any).browser;
      const browser =
        typeof browserRaw === "string" && browserRaw
          ? JSON.parse(browserRaw)
          : browserRaw;
      const nextBrowserEnabled = !!(browser && browser.enabled === true);
      setBrowserEnabled(nextBrowserEnabled);

      const webSearchRaw = (t as any).webSearch;
      const webSearch =
        typeof webSearchRaw === "string" && webSearchRaw
          ? JSON.parse(webSearchRaw)
          : webSearchRaw;
      const nextWebSearchEnabled = !!(webSearch && webSearch.enabled === true);
      setWebSearchEnabled(nextWebSearchEnabled);

      const sendEmailRaw = (t as any).sendEmail;
      const sendEmail =
        typeof sendEmailRaw === "string" && sendEmailRaw
          ? JSON.parse(sendEmailRaw)
          : sendEmailRaw;
      const nextSendEmailEnabled = !!(sendEmail && sendEmail.enabled === true);
      setSendEmailEnabled(nextSendEmailEnabled);

      const contextEngineRaw = (t as any).contextEngine;
      const contextEngine =
        typeof contextEngineRaw === "string" && contextEngineRaw
          ? JSON.parse(contextEngineRaw)
          : contextEngineRaw;
      const nextContextEngineEnabled = !!(
        contextEngine && contextEngine.enabled === true
      );
      const nextContextEngineProviderIds =
        contextEngine && typeof contextEngine === "object"
          ? providerIdsFromConfig(contextEngine as JsonRecord)
          : null;
      const nextContextEngineMemoryQueryMode =
        contextEngine && typeof contextEngine === "object"
          ? memoryModeFromConfig(contextEngine as JsonRecord)
          : "reflect";
      setContextEngineEnabled(nextContextEngineEnabled);
      setContextEngineProviderIds(nextContextEngineProviderIds);
      setContextEngineMemoryQueryMode(nextContextEngineMemoryQueryMode);
      setInitialSnapshot(
        stableJson({
          name: t.name,
          slug: t.slug,
          description: t.description || "",
          category: t.category || "",
          icon: t.icon || "",
          model: t.model || "",
          runtime: t.runtime ?? AgentRuntime.Strands,
          blockedTools: [...parsedBlockedTools].sort(),
          guardrailId: t.guardrailId || null,
          sandboxEnabled: nextSandboxEnabled,
          sandboxEnv: nextSandboxEnv,
          browserEnabled: nextBrowserEnabled,
          webSearchEnabled: nextWebSearchEnabled,
          sendEmailEnabled: nextSendEmailEnabled,
          contextEngineEnabled: nextContextEngineEnabled,
          contextEngineProviderIds: nextContextEngineProviderIds,
          contextEngineMemoryQueryMode: nextContextEngineMemoryQueryMode,
        }),
      );
    }
  }, [result.data]);

  // Load MCP servers: template assignments + tenant registry. For every
  // tenant_api_key server, also probe its key-status so the toggle knows
  // whether to open the configure-key dialog and the row can render a
  // last-4 badge.
  useEffect(() => {
    if (!tenantSlug) return;
    listMcpServers(tenantSlug)
      .then(async (r) => {
        const servers = r.servers || [];
        setAvailableMcpServers(servers);
        const apiKeyServers = servers.filter(
          (s) => s.authType === "tenant_api_key",
        );
        const statusEntries = await Promise.all(
          apiKeyServers.map(async (s) => {
            try {
              const status = await getMcpKeyStatus(tenantSlug, s.id);
              return [s.id, status] as const;
            } catch (err) {
              console.error("key-status probe failed for", s.id, err);
              return [
                s.id,
                {
                  authType: s.authType,
                  hasKey: false,
                  lastFour: null,
                } satisfies McpKeyStatus,
              ] as const;
            }
          }),
        );
        setMcpKeyStatus(Object.fromEntries(statusEntries));
      })
      .catch(console.error);
  }, [tenantSlug]);

  useEffect(() => {
    if (!isNew && templateId) {
      getTemplateMcpServers(templateId)
        .then((r) => {
          if (r.mcpServers?.length) {
            setTemplateMcpServers(
              r.mcpServers.map((m) => ({
                mcp_server_id: m.mcp_server_id,
                enabled: m.enabled,
              })),
            );
          }
        })
        .catch(console.error);
    }
  }, [templateId, isNew]);

  const refreshTemplateMcp = useCallback(() => {
    if (!isNew && templateId) {
      getTemplateMcpServers(templateId)
        .then((r) => {
          setTemplateMcpServers(
            (r.mcpServers || []).map((m) => ({
              mcp_server_id: m.mcp_server_id,
              enabled: m.enabled,
            })),
          );
        })
        .catch(console.error);
    }
  }, [templateId, isNew]);

  if (!isNew && result.fetching) return <PageSkeleton />;

  // MCP helpers
  const mcpServerMap = new Map(availableMcpServers.map((s) => [s.id, s]));
  const unassignedMcpServers = availableMcpServers.filter(
    (s) => !templateMcpServers.some((ts) => ts.mcp_server_id === s.id),
  );
  const defaultContextProviderIds = contextProviders
    .filter((provider) => provider.enabled !== false && provider.defaultEnabled)
    .map((provider) => provider.id);
  const effectiveContextProviderIds =
    contextEngineProviderIds ?? defaultContextProviderIds;
  const effectiveContextProviders = effectiveContextProviderIds.map((id) => {
    const provider = contextProviders.find((candidate) => candidate.id === id);
    return provider?.displayName ?? id;
  });
  const contextMemorySelected = effectiveContextProviderIds.includes("memory");
  const contextProviderOptions = contextProviders
    .filter((provider) => provider.enabled !== false)
    .map((provider) => ({
      label: provider.displayName,
      value: provider.id,
    }));

  const addMcpServer = async (serverId: string) => {
    if (!templateId || isNew) return;
    try {
      await assignMcpToTemplate(templateId, serverId);
      refreshTemplateMcp();
    } catch (err) {
      console.error("Failed to assign MCP server:", err);
    }
    setAddMcpDialogOpen(false);
  };

  const removeMcpServer = async (serverId: string) => {
    if (!templateId || isNew) return;
    try {
      await unassignMcpFromTemplate(templateId, serverId);
      refreshTemplateMcp();
    } catch (err) {
      console.error("Failed to unassign MCP server:", err);
    }
  };

  // Save handler.
  const handleSave = async () => {
    if (!tenantId || !name || !slug) return;
    setSaving(true);

    // null persisted ⇒ template does not use the sandbox. Shape validated
    // server-side by packages/api/src/lib/templates/sandbox-config.ts.
    // required_connections is intentionally omitted — the UI no longer
    // surfaces OAuth-into-sandbox; server-side validator continues to
    // accept legacy rows that carry the field until the cleanup sweep.
    const sandboxJson = sandboxEnabled
      ? JSON.stringify({ environment: sandboxEnv })
      : JSON.stringify(null);
    const browserJson = browserEnabled
      ? JSON.stringify({ enabled: true })
      : JSON.stringify(null);
    const webSearchJson = webSearchEnabled
      ? JSON.stringify({ enabled: true })
      : JSON.stringify(null);
    const sendEmailJson = sendEmailEnabled
      ? JSON.stringify({ enabled: true })
      : JSON.stringify(null);
    const contextEngineConfig: JsonRecord = { enabled: true };
    const allowedContextEngineProviderIds =
      contextEngineProviderIds?.filter((id) =>
        contextProviders.some(
          (provider) => provider.id === id && provider.enabled !== false,
        ),
      ) ?? null;
    if (contextEngineProviderIds !== null) {
      contextEngineConfig.providers = {
        ids: allowedContextEngineProviderIds ?? [],
      };
      if (allowedContextEngineProviderIds?.includes("memory")) {
        contextEngineConfig.providerOptions = {
          memory: { queryMode: contextEngineMemoryQueryMode },
        };
      }
    }
    const contextEngineJson = contextEngineEnabled
      ? JSON.stringify(contextEngineConfig)
      : JSON.stringify(null);
    const config = JSON.stringify(templateConfig);

    try {
      if (isNew) {
        const res = await createTemplate({
          input: {
            tenantId,
            name,
            slug,
            description: description || undefined,
            category: category || undefined,
            icon: icon || undefined,
            config,
            sandbox: sandboxJson,
            browser: browserJson,
            webSearch: webSearchJson,
            sendEmail: sendEmailJson,
            contextEngine: contextEngineJson,
            runtime,

            model: model || undefined,
            guardrailId: guardrailId || undefined,
            blockedTools: JSON.stringify(
              blockedTools.length > 0 ? blockedTools : [],
            ),
          },
        });
        if (res.data?.createAgentTemplate?.id) {
          navigate({
            to: "/agent-templates/$templateId/$tab",
            params: {
              templateId: res.data.createAgentTemplate.id,
              tab: "configuration",
            },
            replace: true,
          });
        }
      } else {
        const res = await updateTemplate({
          id: templateId,
          input: {
            name,
            slug,
            description: description || undefined,
            category: category || undefined,
            icon: icon || undefined,
            config,
            sandbox: sandboxJson,
            browser: browserJson,
            webSearch: webSearchJson,
            sendEmail: sendEmailJson,
            contextEngine: contextEngineJson,
            runtime,

            model: model || undefined,
            guardrailId: guardrailId || undefined,
            blockedTools: JSON.stringify(
              blockedTools.length > 0 ? blockedTools : [],
            ),
          },
        });
        reexecute({ requestPolicy: "network-only" });
        // Prompt sync-to-linked-agents if the template has linked agents
        if (!res.error) {
          setInitialSnapshot(currentSnapshot);
          await refetchLinkedAgents({ requestPolicy: "network-only" });
          if (linkedAgentCount > 0) {
            setSyncDialogOpen(true);
          }
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await deleteTemplateMut({ id: templateId });
      if (!res.error) {
        navigate({ to: "/agent-templates", search: { _r: Date.now() } });
      }
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  return (
    <PageLayout
      header={
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">
              {isNew ? "New Template" : name || "Template"}
            </h1>
            {!isNew && slug && (
              <p className="text-xs text-muted-foreground">{slug}</p>
            )}
          </div>
          <Tabs value={tab}>
            <TabsList>
              <TabsTrigger value="configuration" asChild className="px-4">
                <Link
                  to="/agent-templates/$templateId/$tab"
                  params={{ templateId, tab: "configuration" }}
                >
                  Configuration
                </Link>
              </TabsTrigger>
              <TabsTrigger
                value="workspace"
                asChild
                className="px-4"
                disabled={isNew}
              >
                <Link
                  to="/agent-templates/$templateId/$tab"
                  params={{ templateId, tab: "workspace" }}
                  disabled={isNew}
                >
                  Workspace
                </Link>
              </TabsTrigger>
              <TabsTrigger
                value="mcp-servers"
                asChild
                className="px-4"
                disabled={isNew}
              >
                <Link
                  to="/agent-templates/$templateId/$tab"
                  params={{ templateId, tab: "mcp-servers" }}
                  disabled={isNew}
                >
                  MCP Servers
                </Link>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={!canSave}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isNew ? "Create Template" : "Save"}
            </Button>
            {!isNew && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="w-full h-full">
        {/* Configuration Tab */}
        {tab === "configuration" && (
          <div className="grid w-full max-w-[1024px] gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Basic Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Template Name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Customer Support Agent"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Model</Label>
                      <ModelSelect value={model} onValueChange={setModel} />
                    </div>
                    <div className="space-y-2">
                      <Label>Harness</Label>
                      <Select
                        value={runtime}
                        onValueChange={(value) =>
                          setRuntime(value as AgentRuntime)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={AgentRuntime.Strands}>
                            Strands
                          </SelectItem>
                          <SelectItem value={AgentRuntime.Pi}>Pi</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="slug">Slug</Label>
                    <Input
                      id="slug"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      placeholder="customer-support"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Empathetic support agent with escalation rules"
                      rows={3}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select value={category} onValueChange={setCategory}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="icon">Icon</Label>
                      <Input
                        id="icon"
                        value={icon}
                        onChange={(e) => setIcon(e.target.value)}
                        placeholder="🤖"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
              <Card size="sm">
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-sm">Code Sandbox</CardTitle>
                    <Switch
                      id="sandbox-enabled"
                      checked={sandboxEnabled}
                      onCheckedChange={setSandboxEnabled}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1">
                    <Label htmlFor="sandbox-enabled" className="font-normal">
                      Enable <code>execute_code</code>
                    </Label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Opts this template into AgentCore Code Interpreter. The
                      tool only registers if the tenant also has{" "}
                      <code>sandbox_enabled</code> set.
                    </p>
                  </div>
                  {sandboxEnabled && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Network mode</Label>
                      <Select
                        value={sandboxEnv}
                        onValueChange={(v) => setSandboxEnv(v as SandboxEnv)}
                      >
                        <SelectTrigger className="h-9 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default-public">
                            default-public (egress)
                          </SelectItem>
                          <SelectItem value="internal-only">
                            internal-only (compute)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm">Context Engine</CardTitle>
                    </div>
                    <Switch
                      id="context-engine-enabled"
                      checked={contextEngineEnabled}
                      onCheckedChange={setContextEngineEnabled}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label
                      htmlFor="context-engine-enabled"
                      className="font-normal"
                    >
                      Enable <code>query_context</code>
                    </Label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Injects Context Engine into agent turns for memory, wiki,
                      workspace, knowledge base, and approved MCP context
                      search.
                    </p>
                  </div>
                  {contextEngineEnabled && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {effectiveContextProviders.length > 0 ? (
                          effectiveContextProviders.map((label) => (
                            <Badge
                              key={label}
                              variant="outline"
                              className="text-[10px]"
                            >
                              {label}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            No adapters selected
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          {contextEngineProviderIds === null
                            ? "Using global defaults"
                            : "Template override"}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setContextEngineDialogOpen(true)}
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                          Configure
                        </Button>
                      </div>
                      {contextProvidersError && (
                        <p className="text-xs text-destructive">
                          {contextProvidersError}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-sm">
                      Browser Automation
                    </CardTitle>
                    <Switch
                      id="browser-enabled"
                      checked={browserEnabled}
                      onCheckedChange={setBrowserEnabled}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    <Label htmlFor="browser-enabled" className="font-normal">
                      Enable <code>browser_automation</code>
                    </Label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Registers an AgentCore Browser + Nova Act tool for dynamic
                      website workflows. Agent-level capability overrides can
                      still enable or disable it for individual agents.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm">Web Search</CardTitle>
                    </div>
                    <Switch
                      id="web-search-enabled"
                      checked={webSearchEnabled}
                      onCheckedChange={setWebSearchEnabled}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    <Label htmlFor="web-search-enabled" className="font-normal">
                      Enable <code>web_search</code>
                    </Label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Injects the tenant-configured Web Search built-in tool on
                      agent turns. Configure the provider and API key under
                      Capabilities.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm">Send Email</CardTitle>
                    </div>
                    <Switch
                      id="send-email-enabled"
                      checked={sendEmailEnabled}
                      onCheckedChange={setSendEmailEnabled}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    <Label htmlFor="send-email-enabled" className="font-normal">
                      Enable <code>send_email</code>
                    </Label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Injects the platform email-sending built-in tool on agent
                      turns. The agent email channel still controls the sending
                      address and per-agent delivery policy.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </aside>
          </div>
        )}

        {/* MCP Servers Tab */}
        {tab === "mcp-servers" && (
          <DataTable
            columns={[
              {
                accessorKey: "name",
                header: "Name",
                size: 180,
                cell: ({ row }: any) => (
                  <span className="font-medium">{row.original.name}</span>
                ),
              },
              {
                accessorKey: "authType",
                header: "Auth",
                size: 180,
                cell: ({ row }: any) => {
                  const authType = row.original.authType;
                  const label =
                    authType === "oauth"
                      ? "OAuth"
                      : authType === "tenant_api_key"
                        ? "API Key"
                        : "None";
                  const status = mcpKeyStatus[row.original.id];
                  return (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {label}
                      </Badge>
                      {authType === "tenant_api_key" && (
                        <>
                          {status?.hasKey ? (
                            <button
                              type="button"
                              onClick={() =>
                                setApiKeyDialogServer(row.original)
                              }
                              className="font-mono text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                              title="Click to rotate"
                            >
                              …{status.lastFour}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setApiKeyDialogServer(row.original)
                              }
                              className="text-[10px] text-amber-500 hover:text-amber-400 hover:underline"
                            >
                              no key — configure
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                },
              },
              {
                id: "tools",
                header: "Tools",
                size: 80,
                cell: ({ row }: any) => (
                  <span className="text-xs text-muted-foreground">
                    {row.original.tools?.length || 0} tools
                  </span>
                ),
              },
              {
                id: "enabled",
                header: () => <div className="text-right">Enabled</div>,
                size: 80,
                cell: ({ row }: any) => {
                  const isEnabled = templateMcpServers.some(
                    (ts) => ts.mcp_server_id === row.original.id,
                  );
                  const authType = row.original.authType;
                  const status = mcpKeyStatus[row.original.id];
                  const needsKey =
                    authType === "tenant_api_key" && !status?.hasKey;
                  return (
                    <div className="flex justify-end">
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={async (checked) => {
                          if (checked && needsKey) {
                            // Don't flip the toggle — open the configure-key
                            // dialog instead. Enabling without a key would
                            // give the agent an MCP server it can't
                            // authenticate against.
                            setApiKeyDialogServer(row.original);
                            return;
                          }
                          if (checked) await addMcpServer(row.original.id);
                          else await removeMcpServer(row.original.id);
                        }}
                      />
                    </div>
                  );
                },
              },
            ]}
            data={availableMcpServers}
            pageSize={0}
            tableClassName="table-fixed"
          />
        )}

        {/* Workspace Tab */}
        {tab === "workspace" && !isNew && (
          <WorkspaceEditor
            target={{ templateId }}
            mode="template"
            templateSlug={result.data?.agentTemplate?.slug ?? slug}
            className="min-h-[500px]"
          />
        )}
      </div>

      <Dialog
        open={contextEngineDialogOpen}
        onOpenChange={setContextEngineDialogOpen}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Context Engine Configuration</DialogTitle>
            <DialogDescription>
              Choose the adapters this template should use when it injects{" "}
              <code>query_context</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Enabled adapters</Label>
                {contextEngineProviderIds === null && (
                  <Badge variant="secondary" className="text-xs">
                    Global defaults
                  </Badge>
                )}
              </div>
              <MultiSelect
                options={contextProviderOptions}
                defaultValue={effectiveContextProviderIds}
                onValueChange={setContextEngineProviderIds}
                placeholder={
                  contextProvidersLoading
                    ? "Loading adapters..."
                    : "Select adapters..."
                }
                searchable
                hideSelectAll
                disabled={contextProvidersLoading}
                maxCount={6}
              />
              <p className="text-xs text-muted-foreground">
                Removing an adapter here prevents this template's default{" "}
                <code>query_context</code> calls from using it.
              </p>
            </div>

            {contextMemorySelected && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Hindsight Memory</p>
                  <p className="text-xs text-muted-foreground">
                    Choose whether memory uses raw recall or reflect synthesis.
                  </p>
                </div>
                <ToggleGroup
                  type="single"
                  value={contextEngineMemoryQueryMode}
                  onValueChange={(value) =>
                    value &&
                    setContextEngineMemoryQueryMode(value as MemoryQueryMode)
                  }
                  variant="outline"
                >
                  <ToggleGroupItem value="recall" className="px-3 text-xs">
                    recall
                  </ToggleGroupItem>
                  <ToggleGroupItem value="reflect" className="px-3 text-xs">
                    reflect
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setContextEngineProviderIds(null)}
              >
                Use global defaults
              </Button>
              <Button
                type="button"
                onClick={() => setContextEngineDialogOpen(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Template → Agent sync prompt (shown after Save when agents are linked) */}
      <TemplateSyncDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        templateId={templateId}
        templateName={name}
        linkedAgentCount={linkedAgentCount}
      />

      {/* Tenant API-key configure / rotate dialog for tenant_api_key MCP servers */}
      {apiKeyDialogServer && tenantSlug && (
        <ApiKeyDialog
          open={!!apiKeyDialogServer}
          onOpenChange={(o) => {
            if (!o) setApiKeyDialogServer(null);
          }}
          tenantSlug={tenantSlug}
          serverId={apiKeyDialogServer.id}
          serverName={apiKeyDialogServer.name}
          isRotation={!!mcpKeyStatus[apiKeyDialogServer.id]?.hasKey}
          onSuccess={(lastFour) => {
            setMcpKeyStatus((prev) => ({
              ...prev,
              [apiKeyDialogServer.id]: {
                authType: apiKeyDialogServer.authType || "tenant_api_key",
                hasKey: true,
                lastFour,
              },
            }));
            setApiKeyDialogServer(null);
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Template</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete "{name}"? This action cannot be
            undone.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete Template
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
