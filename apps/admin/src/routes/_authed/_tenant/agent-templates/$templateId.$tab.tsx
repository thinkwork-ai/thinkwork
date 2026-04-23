import { useState, useEffect, useCallback, useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "urql";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { EditorView } from "@codemirror/view";
import {
  Save,
  Loader2,
  Plus,
  Trash2,
  File,
  Folder,
  FolderOpen,
  FilePlus,
  ChevronRight,
  ChevronDown,
  Cable,
  XCircle,
  Shield,
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { ModelSelect } from "@/components/agents/ModelSelect";
import {
  AgentTemplateDetailQuery,
  CreateAgentTemplateMutation,
  UpdateAgentTemplateMutation,
  DeleteAgentTemplateMutation,
  LinkedAgentsForTemplateQuery,
} from "@/lib/graphql-queries";
import {
  listCatalog,
  getCatalogSkill,
  type CatalogSkill,
} from "@/lib/skills-api";
import {
  PermissionsEditor,
  type SkillOperation,
} from "@/components/skills/PermissionsEditor";
import {
  listMcpServers,
  getTemplateMcpServers,
  assignMcpToTemplate,
  unassignMcpFromTemplate,
  type McpServer,
} from "@/lib/mcp-api";
import { TemplateSyncDialog } from "./-components/TemplateSyncDialog";

const VALID_TABS = [
  "configuration",
  "workspace",
  "skills",
  "mcp-servers",
] as const;
type TabSlug = (typeof VALID_TABS)[number];

export const Route = createFileRoute(
  "/_authed/_tenant/agent-templates/$templateId/$tab",
)({
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
// Workspace API (shared client — see apps/admin/src/lib/workspace-files-api.ts)
// ---------------------------------------------------------------------------

import {
  deleteWorkspaceFile,
  getWorkspaceFile,
  listWorkspaceFiles,
  putWorkspaceFile,
} from "@/lib/workspace-files-api";

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

type TreeNode = {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
};

function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const filePath of files.sort()) {
    const parts = filePath.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const pathSoFar = parts.slice(0, i + 1).join("/");
      let node = current.find((n) => n.name === part && n.isFolder === !isLast);
      if (!node) {
        node = { name: part, path: isLast ? pathSoFar : pathSoFar + "/", isFolder: !isLast, children: [] };
        current.push(node);
      }
      current = node.children;
    }
  }
  return root;
}

function WsTreeItem({
  node,
  selectedFile,
  onSelect,
  onDelete,
  depth = 0,
}: {
  node: TreeNode;
  selectedFile: string | null;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = selectedFile === node.path;

  if (node.isFolder) {
    return (
      <div>
        <button
          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-sm hover:bg-accent rounded"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {expanded ? <FolderOpen className="h-3 w-3 text-muted-foreground" /> : <Folder className="h-3 w-3 text-muted-foreground" />}
          <span>{node.name}</span>
        </button>
        {expanded && node.children.map((child) => (
          <WsTreeItem key={child.path} node={child} selectedFile={selectedFile} onSelect={onSelect} onDelete={onDelete} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-between group rounded cursor-pointer text-sm hover:bg-accent ${isActive ? "bg-accent" : ""}`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onSelect(node.path)}
    >
      <div className="flex items-center gap-1.5 py-1 truncate">
        <File className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 mr-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(node.path);
        }}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type TemplateSkill = {
  skill_id: string;
  enabled: boolean;
  model_override?: string | null;
  permissions?: { operations: string[] } | null;
};

type SkillManifestMeta = {
  permissions_model?: "operations";
  scripts?: Array<{
    name: string;
    path: string;
    description?: string;
    default_enabled?: boolean;
  }>;
};

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
    { label: "Agent Templates", href: "/agent-templates" },
    { label: isNew ? "New Template" : "Edit Template" },
  ]);

  // State -- config
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("");
  const [icon, setIcon] = useState("");
  const [model, setModel] = useState("");
  const [blockedTools, setBlockedTools] = useState<string[]>([]);
  const [guardrailId, setGuardrailId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // State -- sandbox (null persisted ⇒ template does not use the sandbox).
  // required_connections is intentionally not surfaced: OAuth token
  // injection into the sandbox process space is a named residual threat
  // (T1/T1b/T2) — agents that need OAuth'd work should call a composable
  // skill instead. execute_code stays a pure-compute primitive.
  type SandboxEnv = "default-public" | "internal-only";
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [sandboxEnv, setSandboxEnv] = useState<SandboxEnv>("default-public");

  // State -- skills
  const [templateSkills, setTemplateSkills] = useState<TemplateSkill[]>([]);
  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  const [addSkillDialogOpen, setAddSkillDialogOpen] = useState(false);
  // Permissions editor (Phase 4 / Unit 8). Manifest metadata is fetched
  // lazily from getCatalogSkill and cached here so the Skills tab knows
  // which skills surface a Permissions dialog.
  const [manifestMetaCache, setManifestMetaCache] = useState<
    Record<string, SkillManifestMeta>
  >({});
  const [permissionsDialogSlug, setPermissionsDialogSlug] = useState<
    string | null
  >(null);

  // State -- MCP servers
  const [templateMcpServers, setTemplateMcpServers] = useState<Array<{ mcp_server_id: string; enabled: boolean }>>([]);
  const [availableMcpServers, setAvailableMcpServers] = useState<McpServer[]>([]);
  const [addMcpDialogOpen, setAddMcpDialogOpen] = useState(false);

  // State -- workspace
  const [wsFiles, setWsFiles] = useState<string[]>([]);
  const [wsSelectedFile, setWsSelectedFile] = useState<string | null>(null);
  const [wsContent, setWsContent] = useState("");
  const [wsOriginalContent, setWsOriginalContent] = useState("");
  const [wsLoadingFiles, setWsLoadingFiles] = useState(false);
  const [wsSavingFile, setWsSavingFile] = useState(false);
  const [wsNewFileName, setWsNewFileName] = useState("");
  const [wsNewFileDialogOpen, setWsNewFileDialogOpen] = useState(false);

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
  const linkedAgentCount = linkedAgentsData?.linkedAgentsForTemplate?.length ?? 0;
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Load skill catalog
  useEffect(() => {
    listCatalog().then(setCatalog).catch(console.error);
  }, []);

  const catalogMap = new Map(catalog.map((s) => [s.slug, s]));

  const sortedCatalog = useMemo(
    () =>
      [...catalog].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [catalog],
  );

  // Lazily fetch manifest details (scripts, permissions_model) for any
  // templateSkill whose details we don't yet have. listCatalog's payload
  // omits scripts; getCatalogSkill returns the full parsed YAML per
  // plan Key Technical Decisions. Only one fetch per slug per mount.
  useEffect(() => {
    const missing = templateSkills
      .map((s) => s.skill_id)
      .filter((slug) => !(slug in manifestMetaCache));
    if (missing.length === 0) return;
    let canceled = false;
    Promise.all(
      missing.map((slug) =>
        getCatalogSkill(slug)
          .then((payload) => ({
            slug,
            meta: {
              permissions_model: (payload as any).permissions_model,
              scripts: (payload as any).scripts,
            } as SkillManifestMeta,
          }))
          .catch(() => ({ slug, meta: {} as SkillManifestMeta })),
      ),
    ).then((entries) => {
      if (canceled) return;
      setManifestMetaCache((prev) => {
        const next = { ...prev };
        for (const { slug, meta } of entries) next[slug] = meta;
        return next;
      });
    });
    return () => {
      canceled = true;
    };
  }, [templateSkills, manifestMetaCache]);

  // Populate form from fetched data
  useEffect(() => {
    if (result.data?.agentTemplate) {
      const t = result.data.agentTemplate;
      setName(t.name);
      setSlug(t.slug);
      setDescription(t.description || "");
      setCategory(t.category || "");
      setIcon(t.icon || "");
      setModel(t.model || "");

      // blocked tools
      if (t.blockedTools) {
        const parsed =
          typeof t.blockedTools === "string"
            ? JSON.parse(t.blockedTools)
            : t.blockedTools;
        setBlockedTools(Array.isArray(parsed) ? parsed : []);
      } else {
        setBlockedTools([]);
      }

      // guardrail
      setGuardrailId(t.guardrailId || null);

      const skills =
        typeof t.skills === "string" ? JSON.parse(t.skills) : t.skills;
      if (Array.isArray(skills)) {
        setTemplateSkills(skills);
      }

      // Sandbox opt-in hydration. AWSJSON may arrive as string or object;
      // null means the template doesn't use the sandbox. required_connections
      // from older rows is read but no longer editable from the UI.
      const sbRaw = (t as any).sandbox;
      const sb =
        typeof sbRaw === "string" && sbRaw ? JSON.parse(sbRaw) : sbRaw;
      if (sb && typeof sb === "object") {
        setSandboxEnabled(true);
        setSandboxEnv(
          sb.environment === "internal-only" ? "internal-only" : "default-public",
        );
      } else {
        setSandboxEnabled(false);
        setSandboxEnv("default-public");
      }
    }
  }, [result.data]);

  // Load MCP servers: template assignments + tenant registry
  useEffect(() => {
    if (tenantSlug) {
      listMcpServers(tenantSlug)
        .then((r) => setAvailableMcpServers(r.servers || []))
        .catch(console.error);
    }
  }, [tenantSlug]);

  useEffect(() => {
    if (!isNew && templateId) {
      getTemplateMcpServers(templateId)
        .then((r) => {
          if (r.mcpServers?.length) {
            setTemplateMcpServers(r.mcpServers.map((m) => ({ mcp_server_id: m.mcp_server_id, enabled: m.enabled })));
          }
        })
        .catch(console.error);
    }
  }, [templateId, isNew]);

  // Load workspace files when switching to workspace tab
  const loadWorkspaceFiles = useCallback(async () => {
    if (isNew || !templateId) return;
    setWsLoadingFiles(true);
    try {
      const res = await listWorkspaceFiles({ templateId });
      setWsFiles(res.files.map((f) => f.path));
    } catch (err) {
      console.error("Failed to load workspace files:", err);
      setWsFiles([]);
    } finally {
      setWsLoadingFiles(false);
    }
  }, [templateId, isNew]);

  useEffect(() => {
    if (tab === "workspace" && !isNew) {
      loadWorkspaceFiles();
    }
  }, [tab, loadWorkspaceFiles, isNew]);

  const loadFileContent = async (path: string) => {
    if (!templateId) return;
    setWsSelectedFile(path);
    try {
      const res = await getWorkspaceFile({ templateId }, path);
      const c = res.content || "";
      setWsContent(c);
      setWsOriginalContent(c);
    } catch (err) {
      console.error("Failed to load file:", err);
      setWsContent("");
      setWsOriginalContent("");
    }
  };

  const saveFileContent = async () => {
    if (!templateId || !wsSelectedFile) return;
    setWsSavingFile(true);
    try {
      await putWorkspaceFile({ templateId }, wsSelectedFile, wsContent);
      setWsOriginalContent(wsContent);
    } catch (err) {
      console.error("Failed to save file:", err);
    } finally {
      setWsSavingFile(false);
    }
  };

  const createNewFile = async () => {
    if (!templateId || !wsNewFileName) return;
    try {
      await putWorkspaceFile({ templateId }, wsNewFileName, "");
      setWsNewFileDialogOpen(false);
      setWsNewFileName("");
      await loadWorkspaceFiles();
      await loadFileContent(wsNewFileName);
    } catch (err) {
      console.error("Failed to create file:", err);
    }
  };

  const deleteFile = async (path: string) => {
    if (!templateId) return;
    try {
      await deleteWorkspaceFile({ templateId }, path);
      if (wsSelectedFile === path) {
        setWsSelectedFile(null);
        setWsContent("");
      }
      await loadWorkspaceFiles();
    } catch (err) {
      console.error("Failed to delete file:", err);
    }
  };

  const refreshTemplateMcp = useCallback(() => {
    if (!isNew && templateId) {
      getTemplateMcpServers(templateId)
        .then((r) => {
          setTemplateMcpServers((r.mcpServers || []).map((m) => ({ mcp_server_id: m.mcp_server_id, enabled: m.enabled })));
        })
        .catch(console.error);
    }
  }, [templateId, isNew]);

  if (!isNew && result.fetching) return <PageSkeleton />;

  // Skills helpers
  const availableSkills = catalog.filter(
    (s) => !templateSkills.some((cs) => cs.skill_id === s.slug),
  );

  const addSkill = (skillSlug: string) => {
    // If the skill's manifest declares `permissions_model: operations`,
    // pre-seed permissions with the default_enabled ops so the agent's
    // allowlist is usable immediately rather than R12-empty on first add.
    // Uses the manifestMetaCache populated by the useEffect below; if the
    // cache hasn't filled yet for this skill, permissions stays undefined
    // (the operator can author it later via the Permissions dialog).
    const meta = manifestMetaCache[skillSlug];
    const defaultOps =
      meta?.permissions_model === "operations"
        ? (meta.scripts ?? [])
            .filter((s) => s.default_enabled === true)
            .map((s) => s.name)
        : null;
    const newEntry: TemplateSkill = {
      skill_id: skillSlug,
      enabled: true,
      ...(defaultOps ? { permissions: { operations: defaultOps } } : {}),
    };
    const updated = [...templateSkills, newEntry];
    setTemplateSkills(updated);
    setAddSkillDialogOpen(false);
  };

  const removeSkill = (skillId: string) => {
    setTemplateSkills(templateSkills.filter((s) => s.skill_id !== skillId));
  };

  const updateSkillPermissions = (
    skillId: string,
    next: { operations: string[] } | null,
  ) => {
    setTemplateSkills((prev) =>
      prev.map((s) =>
        s.skill_id !== skillId
          ? s
          : next === null
            ? (() => {
                // Drop the permissions key entirely when the operator clears.
                const { permissions: _p, ...rest } = s;
                return rest as TemplateSkill;
              })()
            : { ...s, permissions: next },
      ),
    );
  };

  // MCP helpers
  const mcpServerMap = new Map(availableMcpServers.map((s) => [s.id, s]));
  const unassignedMcpServers = availableMcpServers.filter(
    (s) => !templateMcpServers.some((ts) => ts.mcp_server_id === s.id),
  );

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

  // Save handler -- includes skills in the update
  const handleSave = async () => {
    if (!tenantId || !name || !slug) return;
    setSaving(true);

    const config = JSON.stringify({});

    const skillsJson = JSON.stringify(templateSkills);

    // null persisted ⇒ template does not use the sandbox. Shape validated
    // server-side by packages/api/src/lib/templates/sandbox-config.ts.
    // required_connections is intentionally omitted — the UI no longer
    // surfaces OAuth-into-sandbox; server-side validator continues to
    // accept legacy rows that carry the field until the cleanup sweep.
    const sandboxJson = sandboxEnabled
      ? JSON.stringify({ environment: sandboxEnv })
      : JSON.stringify(null);

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
            skills: skillsJson,
            sandbox: sandboxJson,

            model: model || undefined,
            guardrailId: guardrailId || undefined,
            blockedTools: JSON.stringify(blockedTools.length > 0 ? blockedTools : []),
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
            skills: skillsJson,
            sandbox: sandboxJson,

            model: model || undefined,
            guardrailId: guardrailId || undefined,
            blockedTools: JSON.stringify(blockedTools.length > 0 ? blockedTools : []),
          },
        });
        reexecute({ requestPolicy: "network-only" });
        // Prompt sync-to-linked-agents if the template has linked agents
        if (!res.error) {
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
                value="skills"
                asChild
                className="px-4"
                disabled={isNew}
              >
                <Link
                  to="/agent-templates/$templateId/$tab"
                  params={{ templateId, tab: "skills" }}
                  disabled={isNew}
                >
                  Skills
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
            <Button onClick={handleSave} disabled={saving || !name || !slug || !model}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isNew ? "Create Template" : "Save Changes"}
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
      <div className="w-full">
        {/* Configuration Tab */}
        {tab === "configuration" && (
          <div className="max-w-[750px] space-y-6">
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
                <div className="space-y-2">
                  <Label>Model</Label>
                  <ModelSelect value={model} onValueChange={setModel} />
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
                <div className="grid grid-cols-2 gap-4">
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

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Code Sandbox</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="sandbox-enabled" className="font-normal">
                      Enable <code>execute_code</code> for agents in this template
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Opts this template into the AgentCore Code Interpreter sandbox. The tool only registers on a turn if the tenant also has <code>sandbox_enabled</code> set.
                    </p>
                  </div>
                  {sandboxEnabled && (
                    <div className="w-60 space-y-1">
                      <Label className="text-xs">Network mode</Label>
                      <Select
                        value={sandboxEnv}
                        onValueChange={(v) => setSandboxEnv(v as SandboxEnv)}
                      >
                        <SelectTrigger className="h-9">
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
                  <Switch
                    id="sandbox-enabled"
                    checked={sandboxEnabled}
                    onCheckedChange={setSandboxEnabled}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Skills Tab */}
        {tab === "skills" && (
          <DataTable
            columns={[
              {
                accessorKey: "name",
                header: "Name",
                size: 180,
                cell: ({ row }: any) => <span className="font-medium">{row.original.name}</span>,
              },
              {
                accessorKey: "description",
                header: "Description",
                cell: ({ row }: any) => (
                  <span className="text-muted-foreground text-xs truncate block max-w-[400px]">
                    {row.original.description || "—"}
                  </span>
                ),
              },
              {
                accessorKey: "category",
                header: "Category",
                size: 120,
                cell: ({ row }: any) => (
                  <Badge variant="outline" className="text-[10px]">{row.original.category || "—"}</Badge>
                ),
              },
              {
                id: "permissions",
                header: () => <div className="text-center">Permissions</div>,
                size: 110,
                cell: ({ row }: any) => {
                  const slug = row.original.slug;
                  const isEnabled = templateSkills.some((s) => s.skill_id === slug);
                  const meta = manifestMetaCache[slug];
                  const usesOps = meta?.permissions_model === "operations";
                  if (!isEnabled || !usesOps) {
                    return <div className="text-center text-xs text-muted-foreground">—</div>;
                  }
                  const assigned = templateSkills.find((s) => s.skill_id === slug);
                  const count = assigned?.permissions?.operations?.length;
                  return (
                    <div className="flex justify-center">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => setPermissionsDialogSlug(slug)}
                      >
                        <Shield className="h-3 w-3" />
                        {count === undefined ? "Defaults" : `${count} op${count === 1 ? "" : "s"}`}
                      </Button>
                    </div>
                  );
                },
              },
              {
                id: "enabled",
                header: () => <div className="text-right">Enabled</div>,
                size: 80,
                cell: ({ row }: any) => {
                  const isEnabled = templateSkills.some((s) => s.skill_id === row.original.slug);
                  return (
                    <div className="flex justify-end">
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={(checked) => {
                          if (checked) addSkill(row.original.slug);
                          else removeSkill(row.original.slug);
                        }}
                      />
                    </div>
                  );
                },
              },
            ]}
            data={sortedCatalog}
            pageSize={0}
            tableClassName="table-fixed"
          />
        )}

        {/* Permissions editor dialog (Unit 8) — rendered unconditionally
            so state persists across tab changes. */}
        <TemplatePermissionsDialog
          slug={permissionsDialogSlug}
          meta={
            permissionsDialogSlug
              ? manifestMetaCache[permissionsDialogSlug]
              : undefined
          }
          assigned={
            permissionsDialogSlug
              ? templateSkills.find(
                  (s) => s.skill_id === permissionsDialogSlug,
                )
              : undefined
          }
          onClose={() => setPermissionsDialogSlug(null)}
          onChange={(next) => {
            if (permissionsDialogSlug)
              updateSkillPermissions(permissionsDialogSlug, next);
          }}
        />

        {/* MCP Servers Tab */}
        {tab === "mcp-servers" && (
          <DataTable
            columns={[
              {
                accessorKey: "name",
                header: "Name",
                size: 180,
                cell: ({ row }: any) => <span className="font-medium">{row.original.name}</span>,
              },
              {
                accessorKey: "authType",
                header: "Auth",
                size: 100,
                cell: ({ row }: any) => (
                  <Badge variant="outline" className="text-[10px]">
                    {row.original.authType === "oauth" ? "OAuth" : row.original.authType === "tenant_api_key" ? "API Key" : "None"}
                  </Badge>
                ),
              },
              {
                id: "tools",
                header: "Tools",
                size: 80,
                cell: ({ row }: any) => (
                  <span className="text-xs text-muted-foreground">{row.original.tools?.length || 0} tools</span>
                ),
              },
              {
                id: "enabled",
                header: () => <div className="text-right">Enabled</div>,
                size: 80,
                cell: ({ row }: any) => {
                  const isEnabled = templateMcpServers.some((ts) => ts.mcp_server_id === row.original.id);
                  return (
                    <div className="flex justify-end">
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={async (checked) => {
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
        {tab === "workspace" && !isNew && (() => {
          const wsTree = buildTree(wsFiles);
          const wsIsDirty = wsContent !== wsOriginalContent;
          return (
            <>
              <div className="grid grid-cols-[250px_1fr] gap-0 h-[calc(100vh-160px)] border rounded-md overflow-hidden">
                {/* File Tree */}
                <div className="border-r bg-background overflow-y-auto">
                  <div className="flex items-center justify-between px-3 py-2 border-b">
                    <span className="text-sm text-muted-foreground">
                      {wsFiles.length} file{wsFiles.length !== 1 ? "s" : ""}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => {
                        setWsNewFileName("");
                        setWsNewFileDialogOpen(true);
                      }}
                    >
                      <FilePlus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {wsLoadingFiles ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="py-1">
                      {wsTree.map((node) => (
                        <WsTreeItem
                          key={node.path}
                          node={node}
                          selectedFile={wsSelectedFile}
                          onSelect={loadFileContent}
                          onDelete={deleteFile}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Editor */}
                <div className="flex flex-col bg-background">
                  {wsSelectedFile ? (
                    <>
                      <div className="flex items-center justify-between px-3 py-1.5 border-b">
                        <div className="flex items-center gap-2 min-w-0">
                          <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="text-xs font-medium truncate">{wsSelectedFile}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {wsIsDirty && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[11px] px-2 text-muted-foreground"
                              onClick={() => setWsContent(wsOriginalContent)}
                            >
                              Discard
                            </Button>
                          )}
                          <Button
                            size="sm"
                            className="h-6 text-[11px] px-2"
                            onClick={saveFileContent}
                            disabled={wsSavingFile || !wsIsDirty}
                          >
                            {wsSavingFile ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                            Save
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground" onClick={() => deleteFile(wsSelectedFile)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden bg-black [&>div]:h-full">
                        <CodeMirror
                          value={wsContent}
                          onChange={setWsContent}
                          theme={vscodeDark}
                          extensions={[
                            markdown({ base: markdownLanguage, codeLanguages: languages }),
                            EditorView.lineWrapping,
                          ]}
                          height="100%"
                          style={{ fontSize: "12px", backgroundColor: "black" }}
                        className="[&_.cm-editor]:!bg-black [&_.cm-gutters]:!bg-black [&_.cm-activeLine]:!bg-transparent [&_.cm-activeLineGutter]:!bg-transparent"
                          basicSetup={{ highlightActiveLine: false }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                      Select a file to edit
                    </div>
                  )}
                </div>
              </div>

              {/* New File Dialog */}
              <Dialog open={wsNewFileDialogOpen} onOpenChange={setWsNewFileDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create File</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label>File Path</Label>
                      <Input
                        value={wsNewFileName}
                        onChange={(e) => setWsNewFileName(e.target.value)}
                        placeholder="SOUL.md"
                        onKeyDown={(e) => e.key === "Enter" && createNewFile()}
                      />
                    </div>
                    <Button onClick={createNewFile} disabled={!wsNewFileName} className="w-full">
                      Create
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          );
        })()}
      </div>

      {/* Template → Agent sync prompt (shown after Save when agents are linked) */}
      <TemplateSyncDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        templateId={templateId}
        templateName={name}
        linkedAgentCount={linkedAgentCount}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Template</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete "{name}"? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
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

// ---------------------------------------------------------------------------
// TemplatePermissionsDialog — Unit 8
// ---------------------------------------------------------------------------

function TemplatePermissionsDialog({
  slug,
  meta,
  assigned,
  onClose,
  onChange,
}: {
  slug: string | null;
  meta?: SkillManifestMeta;
  assigned?: TemplateSkill;
  onClose: () => void;
  onChange: (next: { operations: string[] } | null) => void;
}) {
  const open = slug !== null;
  const scripts = meta?.scripts ?? [];
  const ops: SkillOperation[] = scripts.map((s) => ({
    name: s.name,
    path: s.path,
    description: s.description,
    default_enabled: s.default_enabled,
  }));
  const value = assigned?.permissions?.operations ?? null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Template permissions — {slug}
          </DialogTitle>
          <DialogDescription>
            Authored here, these ops are the ceiling for every agent
            instantiated from this template. Agents may narrow further
            on the per-agent Skills tab; they cannot widen.
          </DialogDescription>
        </DialogHeader>

        {ops.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4">
            No operations available for this skill.
          </div>
        ) : (
          <PermissionsEditor
            mode="template"
            ops={ops}
            value={value}
            onChange={(next) =>
              onChange(next === null ? null : { operations: next })
            }
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
