import { gql, useQuery } from "urql";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FilePlus,
  Folder,
  FolderPlus,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { AcceptTemplateUpdateDialog } from "@/components/AcceptTemplateUpdateDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  agentBuilderApi,
  type ComposeSource,
  type Target,
} from "@/lib/agent-builder-api";
import { cn } from "@/lib/utils";
import { FileEditorPane } from "./FileEditorPane";
import { FolderTree, buildWorkspaceTree } from "./FolderTree";
import { parseRoutingTable, type RoutingRow } from "./routing-table";

const AgentPinStatusQuery = gql`
  query AgentPinStatus($agentId: ID!) {
    agentPinStatus(agentId: $agentId, includeNested: true) {
      path
      folderPath
      filename
      pinnedSha
      latestSha
      updateAvailable
      pinnedContent
      latestContent
    }
  }
`;

type PinStatusEntry = {
  path: string;
  folderPath: string | null;
  filename: string;
  pinnedSha: string | null;
  latestSha: string | null;
  updateAvailable: boolean;
  pinnedContent: string | null;
  latestContent: string | null;
};

export type WorkspaceEditorMode =
  | "agent"
  | "template"
  | "computer"
  | "defaults";

export type WorkspaceEditorAction = "new-file" | "new-folder";

export interface WorkspaceEditorCapabilities {
  canReviewTemplateUpdates: boolean;
}

export function workspaceEditorCapabilities(
  mode: WorkspaceEditorMode,
): WorkspaceEditorCapabilities {
  return {
    canReviewTemplateUpdates: mode === "agent",
  };
}

export function workspaceEditorActions(
  _mode: WorkspaceEditorMode,
): WorkspaceEditorAction[] {
  return ["new-file", "new-folder"];
}

export interface WorkspaceEditorProps {
  target: Target;
  mode: WorkspaceEditorMode;
  agentId?: string;
  agentSlug?: string;
  templateSlug?: string;
  initialFolder?: string;
  className?: string;
}

function isAgentOverride(source: ComposeSource | undefined): boolean {
  return source === "agent-override" || source === "agent-override-pinned";
}

export function workspaceEditorTargetKey(target: Target): string {
  if ("agentId" in target) return `agent:${target.agentId}`;
  if ("templateId" in target) return `template:${target.templateId}`;
  if ("computerId" in target) return `computer:${target.computerId}`;
  return "defaults";
}

export function WorkspaceEditor({
  target,
  mode,
  agentId,
  initialFolder,
  className,
}: WorkspaceEditorProps) {
  const capabilities = workspaceEditorCapabilities(mode);
  const key = workspaceEditorTargetKey(target);
  const stableTarget = useMemo(() => target, [key]);
  const [files, setFiles] = useState<string[]>([]);
  const [fileSources, setFileSources] = useState<Record<string, ComposeSource>>(
    {},
  );
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [loadedFilesOnce, setLoadedFilesOnce] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [editValue, setEditValue] = useState("");
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [confirmingDeletePath, setConfirmingDeletePath] = useState<
    string | null
  >(null);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [creatingFile, setCreatingFile] = useState(false);
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [routingRows, setRoutingRows] = useState<RoutingRow[]>([]);
  const [acceptDialogPath, setAcceptDialogPath] = useState<string | null>(null);
  const loadRequestId = useRef(0);
  const fileListRequestId = useRef(0);
  const openFileRef = useRef<string | null>(null);
  const lastHandledInitialFolder = useRef<string | undefined>(undefined);

  useEffect(() => {
    openFileRef.current = openFile;
  }, [openFile]);

  const fetchFiles = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      const showLoading = options.showLoading ?? false;
      const requestId = fileListRequestId.current + 1;
      fileListRequestId.current = requestId;
      if (showLoading) setLoadingFiles(true);
      try {
        const data = await agentBuilderApi.listFiles(stableTarget);
        if (fileListRequestId.current !== requestId) return;
        setFiles(data.files.map((file) => file.path));
        const sources: Record<string, ComposeSource> = {};
        for (const file of data.files) sources[file.path] = file.source;
        setFileSources(sources);
      } catch (err) {
        if (fileListRequestId.current !== requestId) return;
        console.error("Failed to list workspace files:", err);
      } finally {
        if (fileListRequestId.current === requestId) {
          setLoadedFilesOnce(true);
          if (showLoading) setLoadingFiles(false);
        }
      }
    },
    [stableTarget],
  );

  const refreshFilesInBackground = useCallback(() => {
    void fetchFiles({ showLoading: false });
  }, [fetchFiles]);

  useEffect(() => {
    if (!files.includes("AGENTS.md")) {
      setRoutingRows([]);
      return;
    }
    let cancelled = false;
    agentBuilderApi
      .getFile(stableTarget, "AGENTS.md")
      .then((data) => {
        if (cancelled) return;
        const parsed = parseRoutingTable(data.content ?? "");
        setRoutingRows(parsed.warning ? [] : parsed.rows);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to parse AGENTS.md routing rows:", err);
        setRoutingRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [files, stableTarget]);

  useEffect(() => {
    loadRequestId.current += 1;
    fileListRequestId.current += 1;
    lastHandledInitialFolder.current = undefined;
    setFiles([]);
    setFileSources({});
    setExpandedFolders(new Set());
    setOpenFile(null);
    setContent("");
    setEditValue("");
    setLoadingContent(false);
    setLoadingFiles(true);
    setLoadedFilesOnce(false);
    setRoutingRows([]);
  }, [key]);

  useEffect(() => {
    fetchFiles({ showLoading: true });
  }, [fetchFiles]);

  const tree = useMemo(
    () => buildWorkspaceTree(files, routingRows),
    [files, routingRows],
  );

  const [pinStatusResult, refetchPinStatus] = useQuery({
    query: AgentPinStatusQuery,
    variables: { agentId: agentId ?? "" },
    pause: !capabilities.canReviewTemplateUpdates || !agentId,
  });

  const pinStatus = useMemo(() => {
    const out: Record<string, PinStatusEntry> = {};
    const list = (
      pinStatusResult.data as { agentPinStatus?: PinStatusEntry[] } | undefined
    )?.agentPinStatus;
    if (list) {
      for (const entry of list) out[entry.path] = entry;
    }
    return out;
  }, [pinStatusResult.data]);

  const openWorkspaceFile = useCallback(
    async (filePath: string) => {
      const requestId = loadRequestId.current + 1;
      loadRequestId.current = requestId;
      const previousOpenFile = openFileRef.current;
      setOpenFile(filePath);
      setLoadingContent(true);
      if (previousOpenFile !== filePath) {
        setContent("");
        setEditValue("");
      }
      try {
        const data = await agentBuilderApi.getFile(stableTarget, filePath);
        if (loadRequestId.current !== requestId) return;
        const fileContent = data.content ?? "";
        setContent(fileContent);
        setEditValue(fileContent);
      } catch (err) {
        if (loadRequestId.current !== requestId) return;
        console.error("Failed to load workspace file:", err);
        setContent("");
        setEditValue("");
      } finally {
        if (loadRequestId.current === requestId) {
          setLoadingContent(false);
        }
      }
    },
    [stableTarget],
  );

  useEffect(() => {
    if (
      !initialFolder ||
      files.length === 0 ||
      lastHandledInitialFolder.current === initialFolder
    ) {
      return;
    }
    const contextPath = `${initialFolder}/CONTEXT.md`;
    if (files.includes(contextPath)) {
      lastHandledInitialFolder.current = initialFolder;
      openWorkspaceFile(contextPath);
    }
  }, [initialFolder, files, openWorkspaceFile]);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleCreateFile = async () => {
    if (!newFilePath.trim()) return;
    setCreatingFile(true);
    try {
      const path = newFilePath.trim();
      await agentBuilderApi.putFile(stableTarget, path, "");
      await fetchFiles();
      await openWorkspaceFile(path);
      setShowNewFileDialog(false);
      setNewFilePath("");
    } catch (err) {
      console.error("Failed to create file:", err);
    } finally {
      setCreatingFile(false);
    }
  };

  const handleCreateFolder = async () => {
    const raw = newFolderPath.trim().replace(/^\/+|\/+$/g, "");
    if (!raw) return;
    if (raw.includes("..") || raw.includes("\\")) return;
    setCreatingFolder(true);
    try {
      await agentBuilderApi.putFile(stableTarget, `${raw}/.gitkeep`, "");
      await fetchFiles();
      setShowNewFolderDialog(false);
      setNewFolderPath("");
    } catch (err) {
      console.error("Failed to create folder:", err);
    } finally {
      setCreatingFolder(false);
    }
  };

  const openNewFileDialog = (parentPath?: string) => {
    setNewFilePath(parentPath ? `${parentPath.replace(/\/$/, "")}/` : "");
    setShowNewFileDialog(true);
  };

  const openNewFolderDialog = (parentPath?: string) => {
    setNewFolderPath(parentPath ? `${parentPath.replace(/\/$/, "")}/` : "");
    setShowNewFolderDialog(true);
  };

  const handleSave = async () => {
    if (!openFile) return;
    const savedPath = openFile;
    const savedValue = editValue;
    setSaving(true);
    try {
      await agentBuilderApi.putFile(stableTarget, savedPath, savedValue);
      if (openFileRef.current === savedPath) {
        setContent(savedValue);
        setEditValue(savedValue);
      }
      await fetchFiles({ showLoading: false });
    } catch (err) {
      console.error("Failed to save workspace file:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!openFile) return;
    await handleDeletePath(openFile, false);
  };

  const handleDeletePath = async (path: string, isFolder: boolean) => {
    const allPaths = isFolder
      ? files.filter((file) => file === path || file.startsWith(`${path}/`))
      : [path];
    const paths =
      mode === "agent"
        ? allPaths.filter((filePath) => isAgentOverride(fileSources[filePath]))
        : allPaths;
    if (allPaths.length === 0) return;

    if (paths.length < allPaths.length) {
      const inheritedCount = allPaths.length - paths.length;
      if (!isFolder) {
        toast.info(
          "Inherited files stay visible until overridden; only agent overrides can be deleted.",
        );
        return;
      }
      if (paths.length > 0) {
        toast.info(
          `${inheritedCount} inherited file${inheritedCount === 1 ? "" : "s"} will remain visible.`,
        );
      }
    }
    if (paths.length === 0) return;

    setConfirmingDeletePath(null);
    setDeletingPath(path);
    try {
      for (const filePath of paths) {
        await agentBuilderApi.deleteFile(stableTarget, filePath);
      }
      setFiles((current) => current.filter((file) => !paths.includes(file)));
      setFileSources((current) => {
        const next = { ...current };
        for (const file of paths) delete next[file];
        return next;
      });
      if (openFile && paths.includes(openFile)) {
        setOpenFile(null);
        setContent("");
        setEditValue("");
      }
      refreshFilesInBackground();
    } catch (err) {
      console.error("Failed to delete workspace path:", err);
    } finally {
      setDeletingPath(null);
    }
  };

  const handleConfirmDelete = (path: string) => {
    setConfirmingDeletePath(path);
  };

  const handleCancelDeleteConfirm = (path: string) => {
    setConfirmingDeletePath((current) => (current === path ? null : current));
  };

  const handleAccepted = useCallback(async () => {
    const acceptedPath = acceptDialogPath;
    setAcceptDialogPath(null);
    refetchPinStatus({ requestPolicy: "network-only" });
    await fetchFiles();
    if (acceptedPath && openFileRef.current === acceptedPath) {
      await openWorkspaceFile(acceptedPath);
    }
  }, [acceptDialogPath, fetchFiles, openWorkspaceFile, refetchPinStatus]);

  const sourceFor = useCallback(
    (path: string) => fileSources[path],
    [fileSources],
  );
  const updateAvailableFor = useCallback(
    (path: string) =>
      capabilities.canReviewTemplateUpdates &&
      Boolean(pinStatus[path]?.updateAvailable),
    [capabilities.canReviewTemplateUpdates, pinStatus],
  );

  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Workspace actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem
          className="whitespace-nowrap"
          onClick={() => openNewFileDialog()}
        >
          <FilePlus className="mr-2 h-4 w-4" />
          New File
        </DropdownMenuItem>
        <DropdownMenuItem
          className="whitespace-nowrap"
          onClick={() => openNewFolderDialog()}
        >
          <FolderPlus className="mr-2 h-4 w-4" />
          New Folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      {loadingFiles && !loadedFilesOnce ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : (
        <div
          className={cn(
            "flex h-full min-h-[400px] rounded-md border",
            className,
          )}
        >
          <div className="flex w-64 shrink-0 flex-col border-r">
            <div className="flex h-9 items-center justify-between border-b bg-muted/50 px-3 text-xs font-medium text-muted-foreground">
              <span>{files.length} files</span>
              <div className="flex items-center gap-1.5">{addMenu}</div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <FolderTree
                nodes={tree}
                selectedPath={openFile}
                expandedFolders={expandedFolders}
                sourceFor={sourceFor}
                updateAvailableFor={updateAvailableFor}
                onSelect={openWorkspaceFile}
                onToggle={toggleFolder}
                onAcceptUpdate={
                  capabilities.canReviewTemplateUpdates
                    ? setAcceptDialogPath
                    : () => {}
                }
                onNewFile={openNewFileDialog}
                onNewFolder={openNewFolderDialog}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {files.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <Folder className="h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No workspace files yet.
                </p>
              </div>
            ) : (
              <FileEditorPane
                openFile={openFile}
                content={content}
                value={editValue}
                loading={loadingContent}
                saving={saving}
                deleting={deletingPath === openFile}
                confirmingDelete={confirmingDeletePath === openFile}
                onChange={setEditValue}
                onSave={handleSave}
                onDiscard={() => setEditValue(content)}
                onDelete={handleDelete}
                onConfirmDelete={() =>
                  openFile && handleConfirmDelete(openFile)
                }
                onCancelDeleteConfirm={() =>
                  openFile && handleCancelDeleteConfirm(openFile)
                }
              />
            )}
          </div>
        </div>
      )}

      <Dialog open={showNewFileDialog} onOpenChange={setShowNewFileDialog}>
        <DialogContent style={{ maxWidth: 440 }}>
          <DialogHeader>
            <DialogTitle>New File</DialogTitle>
            <DialogDescription>
              Enter the file path relative to workspace root.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              placeholder="e.g. docs/domain/products.md"
              value={newFilePath}
              onChange={(event) => setNewFilePath(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleCreateFile()}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowNewFileDialog(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreateFile}
                disabled={!newFilePath.trim() || creatingFile}
              >
                {creatingFile && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewFolderDialog} onOpenChange={setShowNewFolderDialog}>
        <DialogContent style={{ maxWidth: 440 }}>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
            <DialogDescription>
              Enter the folder path relative to workspace root.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              placeholder="e.g. docs/notes"
              value={newFolderPath}
              onChange={(event) => setNewFolderPath(event.target.value)}
              onKeyDown={(event) =>
                event.key === "Enter" && handleCreateFolder()
              }
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowNewFolderDialog(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreateFolder}
                disabled={!newFolderPath.trim() || creatingFolder}
              >
                {creatingFolder && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {acceptDialogPath && agentId && (
        <AcceptTemplateUpdateDialog
          open={Boolean(acceptDialogPath)}
          onOpenChange={(open) => {
            if (!open) setAcceptDialogPath(null);
          }}
          agentId={agentId}
          filename={acceptDialogPath}
          folderPath={pinStatus[acceptDialogPath]?.folderPath ?? null}
          pinnedContent={pinStatus[acceptDialogPath]?.pinnedContent ?? null}
          latestContent={pinStatus[acceptDialogPath]?.latestContent ?? null}
          onAccepted={handleAccepted}
        />
      )}
    </>
  );
}
