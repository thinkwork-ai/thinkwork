import { useState, useEffect, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
} from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
  type CatalogSkill,
} from "@/lib/skills-api";
import {
  listMcpServers,
  assignMcpToAgent,
  unassignMcpFromAgent,
  listAgentMcpServers,
  type McpServer,
} from "@/lib/mcp-api";
import { TemplateSyncDialog } from "./-components/TemplateSyncDialog";

export const Route = createFileRoute(
  "/_authed/_tenant/agent-templates/$templateId",
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

const AVAILABLE_TOOLS = [
  { id: "artifacts", label: "Artifacts" },
  { id: "agent-thread-management", label: "Thread Management" },
  { id: "agent-email-send", label: "Email Send" },
  { id: "web-search", label: "Web Search" },
  { id: "workspace-memory", label: "Workspace Memory" },
  { id: "lastmile-tasks", label: "LastMile Tasks" },
  { id: "lastmile-p21", label: "LastMile P21" },
];

// ---------------------------------------------------------------------------
// Workspace API (same as agent workspace editor)
// ---------------------------------------------------------------------------

const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

async function workspaceApi(body: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/internal/workspace-files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Workspace API: ${res.status}`);
  return res.json();
}

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
};

function TemplateEditorPage() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const tenantSlug = tenant?.slug;
  const navigate = useNavigate();
  const { templateId } = Route.useParams();
  const isNew = templateId === "new";

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
  const [activeTab, setActiveTab] = useState("config");

  // State -- skills
  const [templateSkills, setTemplateSkills] = useState<TemplateSkill[]>([]);
  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  const [addSkillDialogOpen, setAddSkillDialogOpen] = useState(false);

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

      // MCP servers
      const mcpSvrs =
        typeof t.mcpServers === "string" ? JSON.parse(t.mcpServers) : t.mcpServers;
      if (Array.isArray(mcpSvrs)) {
        setTemplateMcpServers(mcpSvrs);
      }
    }
  }, [result.data]);

  // Load available MCP servers for the tenant
  useEffect(() => {
    if (tenantSlug) {
      listMcpServers(tenantSlug)
        .then((r) => setAvailableMcpServers(r.servers || []))
        .catch(console.error);
    }
  }, [tenantSlug]);

  // Load workspace files when switching to workspace tab
  const loadWorkspaceFiles = useCallback(async () => {
    if (!tenantSlug || !slug || isNew) return;
    setWsLoadingFiles(true);
    try {
      const res = await workspaceApi({
        action: "list",
        tenantSlug,
        instanceId: `_catalog/${slug}`,
      });
      setWsFiles(res.files || []);
    } catch (err) {
      console.error("Failed to load workspace files:", err);
      setWsFiles([]);
    } finally {
      setWsLoadingFiles(false);
    }
  }, [tenantSlug, slug, isNew]);

  useEffect(() => {
    if (activeTab === "workspace" && !isNew) {
      loadWorkspaceFiles();
    }
  }, [activeTab, loadWorkspaceFiles, isNew]);

  const loadFileContent = async (path: string) => {
    if (!tenantSlug || !slug) return;
    setWsSelectedFile(path);
    try {
      const res = await workspaceApi({
        action: "get",
        tenantSlug,
        instanceId: `_catalog/${slug}`,
        path,
      });
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
    if (!tenantSlug || !slug || !wsSelectedFile) return;
    setWsSavingFile(true);
    try {
      await workspaceApi({
        action: "put",
        tenantSlug,
        instanceId: `_catalog/${slug}`,
        path: wsSelectedFile,
        content: wsContent,
      });
      setWsOriginalContent(wsContent);
    } catch (err) {
      console.error("Failed to save file:", err);
    } finally {
      setWsSavingFile(false);
    }
  };

  const createNewFile = async () => {
    if (!tenantSlug || !slug || !wsNewFileName) return;
    try {
      await workspaceApi({
        action: "put",
        tenantSlug,
        instanceId: `_catalog/${slug}`,
        path: wsNewFileName,
        content: "",
      });
      setWsNewFileDialogOpen(false);
      setWsNewFileName("");
      await loadWorkspaceFiles();
      await loadFileContent(wsNewFileName);
    } catch (err) {
      console.error("Failed to create file:", err);
    }
  };

  const deleteFile = async (path: string) => {
    if (!tenantSlug || !slug) return;
    try {
      await workspaceApi({
        action: "delete",
        tenantSlug,
        instanceId: `_catalog/${slug}`,
        path,
      });
      if (wsSelectedFile === path) {
        setWsSelectedFile(null);
        setWsContent("");
      }
      await loadWorkspaceFiles();
    } catch (err) {
      console.error("Failed to delete file:", err);
    }
  };

  if (!isNew && result.fetching) return <PageSkeleton />;

  // Skills helpers
  const availableSkills = catalog.filter(
    (s) => !templateSkills.some((cs) => cs.skill_id === s.slug),
  );

  const addSkill = (skillSlug: string) => {
    const updated = [...templateSkills, { skill_id: skillSlug, enabled: true }];
    setTemplateSkills(updated);
    setAddSkillDialogOpen(false);
  };

  const removeSkill = (skillId: string) => {
    setTemplateSkills(templateSkills.filter((s) => s.skill_id !== skillId));
  };

  // MCP helpers
  const mcpServerMap = new Map(availableMcpServers.map((s) => [s.id, s]));
  const unassignedMcpServers = availableMcpServers.filter(
    (s) => !templateMcpServers.some((ts) => ts.mcp_server_id === s.id),
  );

  const addMcpServer = (serverId: string) => {
    setTemplateMcpServers([...templateMcpServers, { mcp_server_id: serverId, enabled: true }]);
    setAddMcpDialogOpen(false);
  };

  const removeMcpServer = (serverId: string) => {
    setTemplateMcpServers(templateMcpServers.filter((s) => s.mcp_server_id !== serverId));
  };

  const toggleBlockedTool = (toolId: string) => {
    setBlockedTools((prev) =>
      prev.includes(toolId)
        ? prev.filter((t) => t !== toolId)
        : [...prev, toolId],
    );
  };

  // Save handler -- includes skills in the update
  const handleSave = async () => {
    if (!tenantId || !name || !slug) return;
    setSaving(true);

    const config = JSON.stringify({});

    const skillsJson = JSON.stringify(templateSkills);
    const mcpServersJson = JSON.stringify(templateMcpServers);

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
            mcpServers: mcpServersJson,
            model: model || undefined,
            guardrailId: guardrailId || undefined,
            blockedTools: JSON.stringify(blockedTools.length > 0 ? blockedTools : []),
          },
        });
        if (res.data?.createAgentTemplate?.id) {
          navigate({
            to: "/agent-templates/$templateId",
            params: { templateId: res.data.createAgentTemplate.id },
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
            mcpServers: mcpServersJson,
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
          <ToggleGroup type="single" value={activeTab} onValueChange={(v) => v && setActiveTab(v)} variant="outline">
            <ToggleGroupItem value="config" className="px-4">Configuration</ToggleGroupItem>
            <ToggleGroupItem value="workspace" className="px-4" disabled={isNew}>Workspace</ToggleGroupItem>
            <ToggleGroupItem value="skills" className="px-4" disabled={isNew}>Skills</ToggleGroupItem>
          </ToggleGroup>
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
        {activeTab === "config" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                <CardTitle className="text-sm">Template Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Model</Label>
                  <ModelSelect value={model} onValueChange={setModel} />
                </div>
                <div className="space-y-2">
                  <Label>Blocked Tools</Label>
                  <p className="text-xs text-muted-foreground">
                    Checked tools will be blocked for agents using this template.
                  </p>
                  <div className="space-y-2 pt-1">
                    {AVAILABLE_TOOLS.map((tool) => (
                      <div key={tool.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`blocked-${tool.id}`}
                          checked={blockedTools.includes(tool.id)}
                          onCheckedChange={() => toggleBlockedTool(tool.id)}
                        />
                        <Label
                          htmlFor={`blocked-${tool.id}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {tool.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="guardrailId">Guardrail</Label>
                  <Input
                    id="guardrailId"
                    value={guardrailId || ""}
                    onChange={(e) =>
                      setGuardrailId(e.target.value || null)
                    }
                    placeholder="Guardrail ID (Phase 4)"
                  />
                  <p className="text-xs text-muted-foreground">
                    Guardrail dropdown coming in Phase 4.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Skills Tab */}
        {activeTab === "skills" && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Assigned Skills</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddSkillDialogOpen(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Skill
              </Button>
            </CardHeader>
            <CardContent>
              {templateSkills.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No skills assigned. Click "Add Skill" to assign skills from the catalog.
                </p>
              ) : (
                <div className="space-y-2">
                  {templateSkills.map((s) => {
                    const meta = catalogMap.get(s.skill_id);
                    return (
                      <div
                        key={s.skill_id}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-sm">
                            {meta?.name || s.skill_id}
                          </span>
                          {meta?.description && (
                            <span className="text-xs text-muted-foreground truncate max-w-[300px]">
                              {meta.description}
                            </span>
                          )}
                          {(meta as any)?.mode === "agent" && (
                            <Badge variant="outline" className="text-[10px]">agent</Badge>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeSkill(s.skill_id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>

            {/* Add Skill Dialog */}
            <Dialog open={addSkillDialogOpen} onOpenChange={setAddSkillDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Skill</DialogTitle>
                </DialogHeader>
                <div className="max-h-[400px] overflow-y-auto space-y-1">
                  {availableSkills.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      All available skills are already assigned.
                    </p>
                  ) : (
                    availableSkills.map((s) => (
                      <button
                        key={s.slug}
                        className="w-full flex items-center justify-between rounded-md px-3 py-2 hover:bg-accent text-left"
                        onClick={() => addSkill(s.slug)}
                      >
                        <div>
                          <span className="font-medium text-sm">{s.name}</span>
                          {s.description && (
                            <p className="text-xs text-muted-foreground truncate max-w-[350px]">
                              {s.description}
                            </p>
                          )}
                        </div>
                        <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </Card>

          {/* MCP Servers */}
          <Card className="mt-4">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Cable className="h-4 w-4" />
                MCP Servers
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddMcpDialogOpen(true)}
                disabled={unassignedMcpServers.length === 0}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add MCP Server
              </Button>
            </CardHeader>
            <CardContent>
              {templateMcpServers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {availableMcpServers.length === 0
                    ? "No MCP servers registered. Register one in the MCP Servers page first."
                    : "No MCP servers assigned. Click \"Add MCP Server\" to assign one."}
                </p>
              ) : (
                <div className="space-y-2">
                  {templateMcpServers.map((ms) => {
                    const server = mcpServerMap.get(ms.mcp_server_id);
                    return (
                      <div
                        key={ms.mcp_server_id}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <div className="flex items-center gap-3">
                          <Cable className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">
                            {server?.name || ms.mcp_server_id}
                          </span>
                          {server?.authType && (
                            <Badge variant="outline" className="text-[10px]">
                              {server.authType === "per_user_oauth" ? "OAuth" : server.authType === "tenant_api_key" ? "API Key" : "No Auth"}
                            </Badge>
                          )}
                          {server?.url && (
                            <span className="text-xs text-muted-foreground truncate max-w-[250px]">
                              {server.url}
                            </span>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeMcpServer(ms.mcp_server_id)}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>

            {/* Add MCP Server Dialog */}
            <Dialog open={addMcpDialogOpen} onOpenChange={setAddMcpDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add MCP Server</DialogTitle>
                </DialogHeader>
                <div className="max-h-[400px] overflow-y-auto space-y-1">
                  {unassignedMcpServers.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      All registered MCP servers are already assigned.
                    </p>
                  ) : (
                    unassignedMcpServers.map((s) => (
                      <button
                        key={s.id}
                        className="w-full flex items-center justify-between rounded-md px-3 py-2 hover:bg-accent text-left"
                        onClick={() => addMcpServer(s.id)}
                      >
                        <div>
                          <span className="font-medium text-sm">{s.name}</span>
                          <p className="text-xs text-muted-foreground truncate max-w-[350px]">
                            {s.url}
                          </p>
                        </div>
                        <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </Card>
        )}

        {/* Workspace Tab */}
        {activeTab === "workspace" && !isNew && (() => {
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
