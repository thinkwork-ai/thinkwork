import { useState, useEffect, useCallback, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { EditorView } from "@codemirror/view";
import {
  Loader2,
  Wand2,
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Plus,
  Trash2,
  FolderPlus,
  FilePlus,
} from "lucide-react";
import { AgentDetailQuery } from "@/lib/graphql-queries";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PageLayout } from "@/components/PageLayout";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authed/_tenant/agents/$agentId_/workspace")({
  component: AgentWorkspacePage,
  validateSearch: (search: Record<string, unknown>) => ({
    folder: (search.folder as string) || undefined,
  }),
});

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

const FILE_DESCRIPTIONS: Record<string, string> = {
  "SOUL.md": "Core personality, values, and behavioral guidelines",
  "USER.md": "What the assistant knows about you",
  "IDENTITY.md": "Name, role, and persona definition",
  "AGENTS.md": "Workspace map — folder structure, skill catalog, KB catalog (auto-generated)",
  "CONTEXT.md": "Task router — routes tasks to workspaces (auto-generated)",
  "TOOLS.md": "Tool usage preferences and instructions",
  "ROUTER.md": "Legacy context routing — which files load for each channel/task",
};

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
// Tree data structure
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

      let existing = current.find((n) => n.name === part);
      if (!existing) {
        existing = {
          name: part,
          path: pathSoFar,
          isFolder: !isLast,
          children: [],
        };
        current.push(existing);
      }
      if (!isLast) {
        existing.isFolder = true;
        current = existing.children;
      }
    }
  }

  // Sort: folders first, then alphabetically
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.isFolder) sortNodes(n.children);
    }
    return nodes;
  };

  return sortNodes(root);
}

// ---------------------------------------------------------------------------
// Tree node component
// ---------------------------------------------------------------------------

function TreeItem({
  node,
  depth,
  selectedPath,
  expandedFolders,
  profileFiles,
  onSelect,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  expandedFolders: Set<string>;
  profileFiles: Set<string> | null;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedPath === node.path;
  const isProfileFile =
    profileFiles !== null &&
    (profileFiles.has(node.path) ||
      (node.isFolder && Array.from(profileFiles).some((f) => f.startsWith(node.path + "/"))));

  return (
    <>
      <div
        className={`flex items-center gap-1 px-2 py-1 text-sm cursor-pointer hover:bg-accent ${
          isSelected ? "bg-accent" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (node.isFolder) {
            onToggle(node.path);
          } else {
            onSelect(node.path);
          }
        }}
      >
        {node.isFolder ? (
          <>
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <File className="h-4 w-4 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate">{node.name}</span>
        {isProfileFile && (
          <Badge variant="secondary" className="ml-auto text-[10px] px-1 py-0">
            active
          </Badge>
        )}
      </div>
      {node.isFolder && isExpanded && (
        <>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedFolders={expandedFolders}
              profileFiles={profileFiles}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
          {node.children.length === 0 && (
            <div
              className="text-xs text-muted-foreground italic px-2 py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              Empty folder
            </div>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Default ROUTER.md content
// ---------------------------------------------------------------------------

const DEFAULT_ROUTER = `# Workspace Router

## default
- load: SOUL.md, IDENTITY.md, USER.md
- skills: all

## chat
- load: docs/tone.md, memory/preferences.md
- skills: all

## email
- load: docs/procedures/
- skills: agent-email-send

## heartbeat
- load: docs/procedures/
- skip: IDENTITY.md, USER.md
- skills: ticket-management
`;

// ---------------------------------------------------------------------------
// Quick-add folder templates
// ---------------------------------------------------------------------------

const FOLDER_TEMPLATES: Record<string, { files: Record<string, string> }> = {
  "docs/": {
    files: {
      "docs/tone.md": "# Tone & Voice\n\nDescribe how this agent should communicate.\n",
    },
  },
  "docs/procedures/": {
    files: {
      "docs/procedures/README.md":
        "# Procedures\n\nStandard operating procedures for this agent.\n",
    },
  },
  "templates/": {
    files: {
      "templates/README.md": "# Templates\n\nReusable content templates.\n",
    },
  },
  "memory/": {
    files: {
      "memory/lessons.md": "# Lessons Learned\n\nThings this agent has learned across conversations.\n",
      "memory/preferences.md": "# Preferences\n\nDiscovered user and team preferences.\n",
      "memory/contacts.md": "# Contacts\n\nKey people and their roles.\n",
    },
  },
};

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function AgentWorkspacePage() {
  const { agentId } = Route.useParams();
  const { folder: initialFolder } = Route.useSearch();
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug ?? "";

  const [result] = useQuery({
    query: AgentDetailQuery,
    variables: { id: agentId },
  });

  const agent = result.data?.agent;
  const instanceId = agent?.slug ?? agentId;

  useBreadcrumbs([
    { label: "Agents", href: "/agents" },
    { label: agent?.name ?? "...", href: `/agents/${agentId}` },
    { label: "Workspace" },
  ]);

  // ---------------------------------------------------------------------------
  // File list
  // ---------------------------------------------------------------------------

  const [files, setFiles] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchFiles = useCallback(async () => {
    if (!tenantSlug || !instanceId) return;
    setLoadingFiles(true);
    try {
      const data = await workspaceApi({ action: "list", tenantSlug, instanceId });
      setFiles(data.files ?? []);
    } catch (err) {
      console.error("Failed to list workspace files:", err);
    } finally {
      setLoadingFiles(false);
    }
  }, [tenantSlug, instanceId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const tree = useMemo(() => buildTree(files), [files]);

  // ---------------------------------------------------------------------------
  // Folder toggle state
  // ---------------------------------------------------------------------------

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Auto-expand all folders on initial load
  useEffect(() => {
    if (files.length > 0) {
      const folders = new Set<string>();
      for (const f of files) {
        const parts = f.split("/");
        for (let i = 1; i < parts.length; i++) {
          folders.add(parts.slice(0, i).join("/"));
        }
      }
      setExpandedFolders(folders);
    }
  }, [files]);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Profile preview (which files would load for a channel)
  // ---------------------------------------------------------------------------

  const [profileFiles] = useState<Set<string> | null>(null);

  // Auto-open CONTEXT.md when navigated from workspaces tab with ?folder=slug
  useEffect(() => {
    if (initialFolder && files.length > 0) {
      const contextPath = `${initialFolder}/CONTEXT.md`;
      if (files.includes(contextPath)) {
        handleOpen(contextPath);
      }
    }
  }, [initialFolder, files]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Generate default files (now includes ROUTER.md + memory/)
  // ---------------------------------------------------------------------------

  const handleGenerate = async () => {
    if (!tenantSlug) return;
    setGenerating(true);
    try {
      const defaults: Record<string, string> = {
        "SOUL.md": "# Soul\n\nEdit this file to define your agent's personality and values.\n",
        "IDENTITY.md": "# Identity\n\nEdit this file to define your agent's name and role.\n",
        "USER.md": "# User Context\n\nEdit this file to describe the users this agent works with.\n",
        "ROUTER.md": DEFAULT_ROUTER,
        "memory/lessons.md": "# Lessons Learned\n\nThings this agent has learned across conversations.\n",
        "memory/preferences.md": "# Preferences\n\nDiscovered user and team preferences.\n",
        "memory/contacts.md": "# Contacts\n\nKey people and their roles.\n",
      };
      for (const [path, content] of Object.entries(defaults)) {
        await workspaceApi({ action: "put", tenantSlug, instanceId, path, content });
      }
      await fetchFiles();
    } catch (err) {
      console.error("Failed to generate workspace files:", err);
    } finally {
      setGenerating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Create file / folder
  // ---------------------------------------------------------------------------

  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [creatingFile, setCreatingFile] = useState(false);

  const handleCreateFile = async () => {
    if (!newFilePath.trim() || !tenantSlug) return;
    setCreatingFile(true);
    try {
      const path = newFilePath.trim();
      const content = path.endsWith(".md")
        ? `# ${path.split("/").pop()?.replace(".md", "")}\n\n`
        : "";
      await workspaceApi({ action: "put", tenantSlug, instanceId, path, content });
      await fetchFiles();
      setShowNewFileDialog(false);
      setNewFilePath("");
    } catch (err) {
      console.error("Failed to create file:", err);
    } finally {
      setCreatingFile(false);
    }
  };

  const handleAddFolder = async (folderKey: string) => {
    if (!tenantSlug) return;
    const template = FOLDER_TEMPLATES[folderKey];
    if (!template) return;
    for (const [path, content] of Object.entries(template.files)) {
      await workspaceApi({ action: "put", tenantSlug, instanceId, path, content });
    }
    await fetchFiles();
  };

  // ---------------------------------------------------------------------------
  // File editor dialog
  // ---------------------------------------------------------------------------

  const [openFile, setOpenFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loadingContent, setLoadingContent] = useState(false);
  // Always in edit mode — no view/edit toggle
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const handleOpen = async (filePath: string) => {
    setOpenFile(filePath);
    if (!tenantSlug) return;
    setLoadingContent(true);
    try {
      const data = await workspaceApi({ action: "get", tenantSlug, instanceId, path: filePath });
      const fileContent = data.content ?? "";
      setContent(fileContent);
      setEditValue(fileContent);
    } catch (err) {
      console.error("Failed to load workspace file:", err);
      setContent("");
      setEditValue("");
    } finally {
      setLoadingContent(false);
    }
  };


  const handleSave = async () => {
    if (!openFile || !tenantSlug) return;
    setSaving(true);
    try {
      await workspaceApi({ action: "put", tenantSlug, instanceId, path: openFile, content: editValue });
      setContent(editValue);
    } catch (err) {
      console.error("Failed to save workspace file:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!openFile || !tenantSlug) return;
    if (!confirm(`Delete ${openFile}?`)) return;
    try {
      await workspaceApi({ action: "delete", tenantSlug, instanceId, path: openFile });
      setOpenFile(null);
      await fetchFiles();
    } catch (err) {
      console.error("Failed to delete file:", err);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (result.fetching && !result.data) return <PageSkeleton />;

  const fileName = openFile?.split("/").pop() ?? openFile;

  return (
    <PageLayout
      header={
        <div className="flex items-center justify-between w-full">
          <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
            Workspace
          </h1>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowNewFileDialog(true)}>
                  <FilePlus className="h-4 w-4 mr-2" />
                  New File
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleAddFolder("docs/")}>
                  <FolderPlus className="h-4 w-4 mr-2" />
                  Add docs/ folder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAddFolder("docs/procedures/")}>
                  <FolderPlus className="h-4 w-4 mr-2" />
                  Add procedures/ folder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAddFolder("templates/")}>
                  <FolderPlus className="h-4 w-4 mr-2" />
                  Add templates/ folder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAddFolder("memory/")}>
                  <FolderPlus className="h-4 w-4 mr-2" />
                  Add memory/ folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating || loadingFiles}>
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Wand2 className="h-3.5 w-3.5 mr-1.5" />
              )}
              Bootstrap
            </Button>
          </div>
        </div>
      }
    >
      {loadingFiles ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Folder className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No workspace files yet. Click Bootstrap to create the default set.
          </p>
        </div>
      ) : (
        /* Split-pane layout: file tree on left, editor on right */
        <div className="flex border rounded-md h-[calc(100vh-8rem)] min-h-[400px]">
          {/* File tree sidebar */}
          <div className="w-56 shrink-0 border-r flex flex-col">
            <div className="h-9 px-3 flex items-center text-xs font-medium text-muted-foreground bg-muted/50 border-b">
              <span>{files.length} files</span>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {tree.map((node) => (
                <TreeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedPath={openFile}
                  expandedFolders={expandedFolders}
                  profileFiles={profileFiles}
                  onSelect={handleOpen}
                  onToggle={toggleFolder}
                />
              ))}
            </div>
          </div>

          {/* Editor pane */}
          <div className="flex-1 flex flex-col min-w-0">
            {openFile ? (
              <>
                {/* Editor toolbar — always shows save/discard/delete */}
                <div className="h-9 px-3 border-b bg-muted/50 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-xs font-medium truncate">{fileName}</span>
                    {openFile.includes("/") && (
                      <span className="text-[10px] text-muted-foreground truncate">{openFile}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!loadingContent && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[11px] px-2 text-muted-foreground"
                          onClick={() => setEditValue(content)}
                          disabled={saving || editValue === content}
                        >
                          Discard
                        </Button>
                        <Button
                          size="sm"
                          className="h-6 text-[11px] px-2"
                          onClick={handleSave}
                          disabled={saving || editValue === content}
                        >
                          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                          Save
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground" onClick={handleDelete}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Editor content — CodeMirror (always editable) */}
                <div className="flex-1 min-h-0 overflow-hidden bg-black [&>div]:h-full">
                  {loadingContent ? (
                    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                    </div>
                  ) : (
                    <CodeMirror
                      value={editValue}
                      onChange={(val) => setEditValue(val)}
                      height="100%"
                      theme={vscodeDark}
                      extensions={[
                        markdown({ base: markdownLanguage, codeLanguages: languages }),
                        EditorView.lineWrapping,
                      ]}
                      style={{ fontSize: "12px", backgroundColor: "black" }}
                      className="[&_.cm-editor]:!bg-black [&_.cm-gutters]:!bg-black [&_.cm-activeLine]:!bg-transparent [&_.cm-activeLineGutter]:!bg-transparent"
                      basicSetup={{
                        lineNumbers: true,
                        foldGutter: true,
                        highlightActiveLine: false,
                        bracketMatching: true,
                      }}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                Select a file
              </div>
            )}
          </div>
        </div>
      )}

      {/* New file dialog */}
      <Dialog open={showNewFileDialog} onOpenChange={setShowNewFileDialog}>
        <DialogContent style={{ maxWidth: 440 }}>
          <DialogHeader>
            <DialogTitle>New File</DialogTitle>
            <DialogDescription>Enter the file path relative to workspace root.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              placeholder="e.g. docs/domain/products.md"
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFile()}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowNewFileDialog(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreateFile} disabled={!newFilePath.trim() || creatingFile}>
                {creatingFile && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
