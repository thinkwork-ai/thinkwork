import { useState, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { EditorView } from "@codemirror/view";
import {
  Loader2,
  Save,
  Trash2,
  File,
  Folder,
  FolderOpen,
  FilePlus,
  ChevronRight,
  ChevronDown,
  Wand2,
} from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import {
  deleteWorkspaceFile,
  getWorkspaceFile,
  listWorkspaceFiles,
  putWorkspaceFile,
} from "@/lib/workspace-files-api";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authed/_tenant/agent-templates/defaults")({
  component: DefaultWorkspacePage,
});

// ---------------------------------------------------------------------------
// Default file content
// ---------------------------------------------------------------------------

const DEFAULT_ROUTER = `# Workspace Router

## default
- load: SOUL.md, IDENTITY.md, USER.md

## chat
- load: docs/tone.md, memory/preferences.md

## email
- load: docs/procedures/

## heartbeat
- load: docs/procedures/
- skip: IDENTITY.md, USER.md
`;

const DEFAULT_FILES: Record<string, string> = {
  "SOUL.md": "# Soul\n\nEdit this file to define your agent's personality and values.\n",
  "IDENTITY.md": "# Identity\n\nEdit this file to define your agent's name and role.\n",
  "USER.md": "# User Context\n\nEdit this file to describe the users this agent works with.\n",
  "ROUTER.md": DEFAULT_ROUTER,
  "memory/lessons.md": "# Lessons Learned\n\nThings this agent has learned across conversations.\n",
  "memory/preferences.md": "# Preferences\n\nDiscovered user and team preferences.\n",
  "memory/contacts.md": "# Contacts\n\nKey people and their roles.\n",
};

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

function TreeItem({
  node,
  selectedFile,
  deletingPath,
  confirmingDeletePath,
  onSelect,
  onDelete,
  onConfirmDelete,
  onCancelDeleteConfirm,
  depth = 0,
}: {
  node: TreeNode;
  selectedFile: string | null;
  deletingPath: string | null;
  confirmingDeletePath: string | null;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  onConfirmDelete: (path: string) => void;
  onCancelDeleteConfirm: (path: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = selectedFile === node.path;
  const isDeleting = deletingPath === node.path;
  const isConfirmingDelete = confirmingDeletePath === node.path;

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
          <TreeItem
            key={child.path}
            node={child}
            selectedFile={selectedFile}
            deletingPath={deletingPath}
            confirmingDeletePath={confirmingDeletePath}
            onSelect={onSelect}
            onDelete={onDelete}
            onConfirmDelete={onConfirmDelete}
            onCancelDeleteConfirm={onCancelDeleteConfirm}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-between group rounded cursor-pointer text-sm hover:bg-accent ${isActive ? "bg-accent" : ""}`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onSelect(node.path)}
      onMouseLeave={() => onCancelDeleteConfirm(node.path)}
    >
      <div className="flex items-center gap-1.5 py-1 truncate">
        <File className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className={`h-5 mr-1 text-muted-foreground hover:text-destructive ${
          isConfirmingDelete ? "w-14 px-1.5 text-[11px] text-destructive opacity-100" : "w-5"
        } ${
          isDeleting || isConfirmingDelete ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
        disabled={isDeleting}
        onClick={(e) => {
          e.stopPropagation();
          if (isConfirmingDelete) onDelete(node.path);
          else onConfirmDelete(node.path);
        }}
      >
        {isDeleting ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isConfirmingDelete ? (
          "Confirm"
        ) : (
          <Trash2 className="h-3 w-3" />
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function DefaultWorkspacePage() {
  useBreadcrumbs([
    { label: "Agent Templates", href: "/agent-templates" },
    { label: "Default Workspace" },
  ]);

  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [confirmingDeletePath, setConfirmingDeletePath] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [newFileDialogOpen, setNewFileDialogOpen] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);

  // The handler's `defaults: true` target resolves to the caller's tenant
  // server-side — no tenant slug round-trip.
  const target = { defaults: true as const };

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listWorkspaceFiles(target);
      const fileList = res.files.map((f) => f.path);
      setFiles(fileList);
      return fileList;
    } catch (err) {
      console.error("Failed to list files:", err);
      setFiles([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-bootstrap on first visit
  useEffect(() => {
    (async () => {
      const fileList = await fetchFiles();
      if (fileList && fileList.length === 0) {
        setBootstrapping(true);
        try {
          for (const [path, fileContent] of Object.entries(DEFAULT_FILES)) {
            await putWorkspaceFile(target, path, fileContent);
          }
          await fetchFiles();
        } catch (err) {
          console.error("Failed to bootstrap defaults:", err);
        } finally {
          setBootstrapping(false);
        }
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFile = async (path: string) => {
    setSelectedFile(path);
    try {
      const res = await getWorkspaceFile(target, path);
      const c = res.content || "";
      setContent(c);
      setOriginalContent(c);
    } catch (err) {
      console.error("Failed to load file:", err);
      setContent("");
      setOriginalContent("");
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await putWorkspaceFile(target, selectedFile, content);
      setOriginalContent(content);
    } catch (err) {
      console.error("Failed to save file:", err);
    } finally {
      setSaving(false);
    }
  };

  const createFile = async () => {
    if (!newFileName) return;
    try {
      await putWorkspaceFile(target, newFileName, "");
      setNewFileDialogOpen(false);
      setNewFileName("");
      await fetchFiles();
      await loadFile(newFileName);
    } catch (err) {
      console.error("Failed to create file:", err);
    }
  };

  const deleteFile = async (path: string) => {
    setConfirmingDeletePath(null);
    setDeletingPath(path);
    try {
      await deleteWorkspaceFile(target, path);
      setFiles((current) => current.filter((file) => file !== path));
      if (selectedFile === path) {
        setSelectedFile(null);
        setContent("");
        setOriginalContent("");
      }
      await fetchFiles();
    } catch (err) {
      console.error("Failed to delete file:", err);
    } finally {
      setDeletingPath(null);
    }
  };

  const confirmDelete = (path: string) => {
    setConfirmingDeletePath(path);
  };

  const cancelDeleteConfirm = (path: string) => {
    setConfirmingDeletePath((current) => (current === path ? null : current));
  };

  const handleRebootstrap = async () => {
    setBootstrapping(true);
    try {
      for (const [path, fileContent] of Object.entries(DEFAULT_FILES)) {
        await putWorkspaceFile(target, path, fileContent);
      }
      await fetchFiles();
      setSelectedFile(null);
      setContent("");
      setOriginalContent("");
    } catch (err) {
      console.error("Failed to bootstrap:", err);
    } finally {
      setBootstrapping(false);
    }
  };

  const isDirty = content !== originalContent;
  const tree = buildTree(files);

  if (loading && files.length === 0) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Default Workspace</h1>
            <p className="text-xs text-muted-foreground">
              Default files for new agent templates
            </p>
          </div>
          <div className="flex items-center gap-2">
            {files.length === 0 && (
              <Button
                variant="outline"
                onClick={handleRebootstrap}
                disabled={bootstrapping}
              >
                {bootstrapping ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                Bootstrap
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setNewFileName("");
                setNewFileDialogOpen(true);
              }}
            >
              <FilePlus className="h-4 w-4" />
              Add File
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-[250px_1fr] gap-0 h-[calc(100vh-160px)] border rounded-md overflow-hidden">
        {/* File Tree */}
        <div className="border-r bg-background overflow-y-auto">
          <div className="px-3 py-2 text-sm text-muted-foreground border-b">
            {files.length} file{files.length !== 1 ? "s" : ""}
          </div>
          <div className="py-1">
            {tree.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                selectedFile={selectedFile}
                deletingPath={deletingPath}
                confirmingDeletePath={confirmingDeletePath}
                onSelect={loadFile}
                onDelete={deleteFile}
                onConfirmDelete={confirmDelete}
                onCancelDeleteConfirm={cancelDeleteConfirm}
              />
            ))}
          </div>
        </div>

        {/* Editor */}
        <div className="flex flex-col bg-background">
          {selectedFile ? (
            <>
              <div className="flex items-center justify-between px-3 py-1.5 border-b">
                <div className="flex items-center gap-2 min-w-0">
                  <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-xs font-medium truncate">{selectedFile}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isDirty && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] px-2 text-muted-foreground"
                      onClick={() => setContent(originalContent)}
                    >
                      Discard
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={saveFile}
                    disabled={saving || !isDirty}
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-6 p-0 text-muted-foreground ${
                      confirmingDeletePath === selectedFile
                        ? "w-16 px-2 text-[11px] text-destructive"
                        : "w-6"
                    }`}
                    disabled={deletingPath === selectedFile}
                    onMouseLeave={() => cancelDeleteConfirm(selectedFile)}
                    onClick={() => {
                      if (confirmingDeletePath === selectedFile) deleteFile(selectedFile);
                      else confirmDelete(selectedFile);
                    }}
                  >
                    {deletingPath === selectedFile ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : confirmingDeletePath === selectedFile ? (
                      "Confirm"
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden bg-black [&>div]:h-full">
                <CodeMirror
                  value={content}
                  onChange={setContent}
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
      <Dialog open={newFileDialogOpen} onOpenChange={setNewFileDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create File</DialogTitle>
            <DialogDescription>
              Add a new file to the default workspace. Use / for nested paths.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>File Path</Label>
              <Input
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder="docs/tone.md"
                onKeyDown={(e) => e.key === "Enter" && createFile()}
              />
            </div>
            <Button onClick={createFile} disabled={!newFileName} className="w-full">
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
