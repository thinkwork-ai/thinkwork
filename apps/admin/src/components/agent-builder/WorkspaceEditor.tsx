import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FilePlus,
  Folder,
  FolderPlus,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  agentBuilderApi,
  type ComposeSource,
  type MoveResult,
  type Target,
} from "@/lib/agent-builder-api";
import { cn } from "@/lib/utils";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { toast } from "sonner";
import { FileEditorPane } from "./FileEditorPane";
import {
  FolderTree,
  buildWorkspaceTree,
  type InlineEditState,
} from "./FolderTree";
import {
  basenameOf,
  joinFolderPath,
  parentFolderOf,
  pathIsWithinFolder,
  replacePathPrefix,
  shouldEmitDetachToast,
  validateInlineBasename,
} from "@/lib/workspace-tree-actions";
import { parseRoutingTable, type RoutingRow } from "./routing-table";

export interface ClipboardItem {
  path: string;
  kind: "file" | "folder";
}

export type WorkspaceEditorMode =
  | "agent"
  | "template"
  | "computer"
  | "context"
  | "defaults";

export type WorkspaceEditorAction = "new-file" | "new-folder";

export interface WorkspaceEditorCapabilities {
  canReviewTemplateUpdates: boolean;
}

export function workspaceEditorCapabilities(
  mode: WorkspaceEditorMode,
): WorkspaceEditorCapabilities {
  return {
    canReviewTemplateUpdates: false,
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

export function workspaceEditorTargetKey(target: Target): string {
  if ("agentId" in target) return `agent:${target.agentId}`;
  if ("templateId" in target) return `template:${target.templateId}`;
  if ("spaceId" in target) return `space:${target.spaceId}`;
  if ("computerId" in target) return `computer:${target.computerId}`;
  if ("userId" in target) return `user:${target.userId}`;
  return "defaults";
}

export function WorkspaceEditor({
  target,
  mode,
  initialFolder,
  className,
}: WorkspaceEditorProps) {
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
  // Per-node mutation tracking — paths in this set render with a spinner
  // in place of their icon. Replaces the prior single-path `deletingPath`
  // so concurrent deletes / moves can show their own per-row state.
  const [mutatingPaths, setMutatingPaths] = useState<Set<string>>(new Set());
  const beginMutation = useCallback((path: string) => {
    setMutatingPaths((current) => {
      const next = new Set(current);
      next.add(path);
      return next;
    });
  }, []);
  const endMutation = useCallback((path: string) => {
    setMutatingPaths((current) => {
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }, []);

  // Clipboard for cut/paste. Per the brainstorm: per-tree state, cleared
  // on WorkspaceEditor remount (the `key`-based reset effect below
  // already covers it implicitly because `clipboardItem` is local
  // state).
  const [clipboardItem, setClipboardItem] = useState<ClipboardItem | null>(
    null,
  );

  // Tracks the most-recently-interacted tree row (file or folder) so
  // keyboard shortcuts (Cmd+X / Cmd+V / Backspace) know what to act on
  // without the user having to explicitly "select" a row.
  const [focusedTreePath, setFocusedTreePath] = useState<string | null>(null);

  // Tree scope ref — `useKeyboardShortcuts` reads `document.activeElement`
  // and fires only when the active element is this ref's tree element or
  // a descendant. Without scoping, Cmd+V would hijack paste globally.
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [confirmingDeletePath, setConfirmingDeletePath] = useState<
    string | null
  >(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    path: string;
    isFolder: boolean;
  } | null>(null);
  const [routingRows, setRoutingRows] = useState<RoutingRow[]>([]);
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
    setInlineEdit(null);
  }, [key]);

  useEffect(() => {
    fetchFiles({ showLoading: true });
  }, [fetchFiles]);

  const tree = useMemo(
    () =>
      buildWorkspaceTree(files, routingRows, {
        reservedRootFolders: mode === "context" ? ["memory"] : undefined,
      }),
    [files, mode, routingRows],
  );

  const openWorkspaceFile = useCallback(
    async (filePath: string) => {
      const requestId = loadRequestId.current + 1;
      loadRequestId.current = requestId;
      const previousOpenFile = openFileRef.current;
      setOpenFile(filePath);
      setFocusedTreePath(filePath);
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
    setFocusedTreePath(path);
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // ─── Clipboard handlers (cut / paste) ──────────────────────────────────

  const folderPaths = useMemo(
    () => collectFolderPathsFromFiles(files),
    [files],
  );
  const isFolderPath = useCallback(
    (path: string) => folderPaths.has(path),
    [folderPaths],
  );

  const handleCut = useCallback(
    (path: string, kindHint?: "file" | "folder") => {
      const kind: "file" | "folder" =
        kindHint ?? (isFolderPath(path) ? "folder" : "file");
      setClipboardItem({ path, kind });
    },
    [isFolderPath],
  );

  const clearClipboard = useCallback(() => setClipboardItem(null), []);

  const performMove = useCallback(
    async (sourcePath: string, toFolder: string) => {
      beginMutation(sourcePath);
      let result: MoveResult;
      try {
        result = await agentBuilderApi.moveFile(
          stableTarget,
          sourcePath,
          toFolder,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Failed to move workspace path:", err);
        toast.error(`Move failed: ${message}`);
        endMutation(sourcePath);
        return null;
      }
      endMutation(sourcePath);
      await fetchFiles({ showLoading: false });
      if (openFileRef.current === sourcePath) {
        setOpenFile(result.destPath);
        setFocusedTreePath(result.destPath);
      }
      const toastText = shouldEmitDetachToast({
        movedCount: result.movedCount,
        detachedPinnedCount: result.detachedPinnedCount,
      });
      if (toastText) toast.success(toastText);
      return result;
    },
    [beginMutation, endMutation, stableTarget, fetchFiles],
  );

  const handlePaste = useCallback(
    async (toFolder: string) => {
      if (!clipboardItem) return;
      const sourcePath = clipboardItem.path;
      const result = await performMove(sourcePath, toFolder);
      if (result) {
        // R5/R9: success clears the clipboard; failure preserves it.
        setClipboardItem(null);
      }
    },
    [clipboardItem, performMove],
  );

  const handleDropMove = useCallback(
    (sourcePath: string, toFolder: string) => {
      // Drag-and-drop bypasses the clipboard but uses the same server
      // action. Don't touch clipboardItem here — drag is its own
      // gesture.
      void performMove(sourcePath, toFolder);
    },
    [performMove],
  );

  const pasteIntoSelectedScope = useCallback(() => {
    if (!clipboardItem) return;
    // Determine target folder per the brainstorm:
    //   - If a folder is focused: paste into it.
    //   - If a file is focused: paste at the workspace root (AE7).
    //   - If nothing focused: root.
    const toFolder =
      focusedTreePath && isFolderPath(focusedTreePath) ? focusedTreePath : "";
    void handlePaste(toFolder);
  }, [clipboardItem, focusedTreePath, isFolderPath, handlePaste]);

  const cutFocused = useCallback(() => {
    if (!focusedTreePath) return;
    handleCut(focusedTreePath);
  }, [focusedTreePath, handleCut]);

  const deleteFocused = useCallback(() => {
    if (!focusedTreePath) return;
    const isFolder = isFolderPath(focusedTreePath);
    setDeleteConfirmTarget({ path: focusedTreePath, isFolder });
  }, [focusedTreePath, isFolderPath]);

  const startNewFile = (parentPath?: string) => {
    const parent = parentPath?.replace(/\/$/, "") ?? "";
    if (parent) {
      setExpandedFolders((current) => new Set(current).add(parent));
    }
    setFocusedTreePath(parent || null);
    setInlineEdit({ mode: "new-file", parentPath: parent, value: "" });
  };

  const startNewFolder = (parentPath?: string) => {
    const parent = parentPath?.replace(/\/$/, "") ?? "";
    if (parent) {
      setExpandedFolders((current) => new Set(current).add(parent));
    }
    setFocusedTreePath(parent || null);
    setInlineEdit({ mode: "new-folder", parentPath: parent, value: "" });
  };

  const startRename = useCallback((path: string, kind: "file" | "folder") => {
    if (kind === "folder") {
      setExpandedFolders((current) => new Set(current).add(path));
    }
    setFocusedTreePath(path);
    setInlineEdit({
      mode: "rename",
      path,
      kind,
      value: basenameOf(path),
    });
  }, []);

  const startRenameFocused = useCallback(() => {
    if (!focusedTreePath || inlineEdit) return;
    const pathExists =
      files.includes(focusedTreePath) || folderPaths.has(focusedTreePath);
    if (!pathExists) return;
    const kind = folderPaths.has(focusedTreePath) ? "folder" : "file";
    startRename(focusedTreePath, kind);
  }, [files, focusedTreePath, folderPaths, inlineEdit, startRename]);

  useKeyboardShortcuts(
    useMemo(
      () => [
        { key: "x", mod: true, handler: cutFocused },
        { key: "v", mod: true, handler: pasteIntoSelectedScope },
        { key: "Backspace", handler: deleteFocused },
        { key: "Delete", handler: deleteFocused },
        { key: "F2", handler: startRenameFocused },
      ],
      [cutFocused, pasteIntoSelectedScope, deleteFocused, startRenameFocused],
    ),
    { scopeRef: treeContainerRef },
  );

  const setInlineEditValue = (value: string) => {
    setInlineEdit((current) =>
      current ? { ...current, value, error: undefined } : current,
    );
  };

  const cancelInlineEdit = () => setInlineEdit(null);

  const commitInlineEdit = async () => {
    const current = inlineEdit;
    if (!current || current.committing) return;
    const raw = current.value.trim();
    if (!raw) {
      setInlineEdit(null);
      return;
    }
    const validation = validateInlineBasename(raw);
    if (!validation.valid) {
      setInlineEdit({ ...current, error: validation.error });
      return;
    }

    if (current.mode === "new-file" || current.mode === "new-folder") {
      const path = joinFolderPath(current.parentPath, validation.basename);
      if (files.includes(path) || folderPaths.has(path)) {
        setInlineEdit({
          ...current,
          error: `A file or folder named ${validation.basename} already exists.`,
        });
        return;
      }
      setInlineEdit({ ...current, committing: true });
      beginMutation(path);
      try {
        if (current.mode === "new-folder") {
          await agentBuilderApi.putFile(stableTarget, `${path}/.gitkeep`, "");
        } else {
          await agentBuilderApi.putFile(stableTarget, path, "");
        }
        await fetchFiles({ showLoading: false });
        if (current.mode === "new-file") {
          await openWorkspaceFile(path);
        } else {
          setExpandedFolders((folders) => new Set(folders).add(path));
          setFocusedTreePath(path);
        }
        setInlineEdit(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Failed to create workspace path:", err);
        toast.error(
          `${current.mode === "new-folder" ? "Create folder" : "Create file"} failed: ${message}`,
        );
        setInlineEdit({ ...current, error: message });
      } finally {
        endMutation(path);
      }
      return;
    }

    const toPath = joinFolderPath(
      parentFolderOf(current.path),
      validation.basename,
    );
    if (toPath === current.path) {
      setInlineEdit(null);
      return;
    }
    if (files.includes(toPath) || folderPaths.has(toPath)) {
      setInlineEdit({
        ...current,
        error: `A file or folder named ${validation.basename} already exists.`,
      });
      return;
    }

    beginMutation(current.path);
    setInlineEdit({ ...current, committing: true });
    try {
      const result = await agentBuilderApi.renamePath(
        stableTarget,
        current.path,
        toPath,
      );
      await fetchFiles({ showLoading: false });
      const activeOpenFile = openFileRef.current;
      if (activeOpenFile) {
        const nextOpen =
          current.kind === "folder"
            ? replacePathPrefix(activeOpenFile, current.path, result.destPath)
            : activeOpenFile === current.path
              ? result.destPath
              : activeOpenFile;
        if (nextOpen !== activeOpenFile) {
          openFileRef.current = nextOpen;
          setOpenFile(nextOpen);
          setFocusedTreePath(nextOpen);
        }
      }
      if (
        clipboardItem &&
        (clipboardItem.path === current.path ||
          pathIsWithinFolder(clipboardItem.path, current.path))
      ) {
        setClipboardItem(null);
      }
      setInlineEdit(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to rename workspace path:", err);
      toast.error(`Rename failed: ${message}`);
      setInlineEdit({ ...current, error: message });
    } finally {
      endMutation(current.path);
    }
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
    const paths = isFolder
      ? files.filter((file) => file === path || file.startsWith(`${path}/`))
      : [path];
    if (paths.length === 0) return;

    setConfirmingDeletePath(null);
    beginMutation(path);
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
      endMutation(path);
    }
  };

  const handleRegenerateMap = useCallback(
    async (path: string) => {
      if (path !== "AGENTS.md" || !("agentId" in stableTarget)) return;
      beginMutation(path);
      try {
        if (openFileRef.current === path && editValue !== content) {
          await agentBuilderApi.putFile(stableTarget, path, editValue);
        }
        await agentBuilderApi.regenerateMap(stableTarget.agentId);
        await fetchFiles({ showLoading: false });
        if (openFileRef.current === path) {
          await openWorkspaceFile(path);
        }
        toast.success("Regenerated AGENTS.md map.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Failed to regenerate AGENTS.md map:", err);
        toast.error(`Regenerate map failed: ${message}`);
      } finally {
        endMutation(path);
      }
    },
    [
      beginMutation,
      content,
      editValue,
      endMutation,
      fetchFiles,
      openWorkspaceFile,
      stableTarget,
    ],
  );

  const handleConfirmDelete = (path: string) => {
    setConfirmingDeletePath(path);
  };

  const handleCancelDeleteConfirm = (path: string) => {
    setConfirmingDeletePath((current) => (current === path ? null : current));
  };

  const sourceFor = useCallback(
    (path: string) => fileSources[path],
    [fileSources],
  );
  const updateAvailableFor = useCallback((_path: string) => false, []);

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
          onClick={() => startNewFile()}
        >
          <FilePlus className="mr-2 h-4 w-4" />
          New File
        </DropdownMenuItem>
        <DropdownMenuItem
          className="whitespace-nowrap"
          onClick={() => startNewFolder()}
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
            <div
              className="flex-1 overflow-y-auto outline-none"
              ref={treeContainerRef}
              tabIndex={-1}
            >
              <FolderTree
                nodes={tree}
                selectedPath={openFile}
                expandedFolders={expandedFolders}
                mutatingPaths={mutatingPaths}
                clipboardItem={clipboardItem}
                sourceFor={sourceFor}
                updateAvailableFor={updateAvailableFor}
                onSelect={openWorkspaceFile}
                onToggle={toggleFolder}
                onAcceptUpdate={() => {}}
                onNewFile={startNewFile}
                onNewFolder={startNewFolder}
                onDelete={(path, isFolder) =>
                  setDeleteConfirmTarget({ path, isFolder })
                }
                onRename={startRename}
                onRegenerateMap={
                  "agentId" in stableTarget ? handleRegenerateMap : undefined
                }
                inlineEdit={inlineEdit}
                onInlineEditChange={setInlineEditValue}
                onInlineEditCommit={commitInlineEdit}
                onInlineEditCancel={cancelInlineEdit}
                onCut={handleCut}
                onPaste={handlePaste}
                onClearClipboard={clearClipboard}
                onDropMove={handleDropMove}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {files.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <Folder className="h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No {mode === "context" ? "context" : "workspace"} files yet.
                </p>
              </div>
            ) : (
              <FileEditorPane
                openFile={openFile}
                content={content}
                value={editValue}
                loading={loadingContent}
                saving={saving}
                deleting={openFile !== null && mutatingPaths.has(openFile)}
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

      <DeleteConfirmDialog
        target={deleteConfirmTarget}
        files={files}
        deleting={
          deleteConfirmTarget !== null &&
          mutatingPaths.has(deleteConfirmTarget.path)
        }
        onCancel={() => setDeleteConfirmTarget(null)}
        onConfirm={() => {
          if (!deleteConfirmTarget) return;
          const { path, isFolder } = deleteConfirmTarget;
          setDeleteConfirmTarget(null);
          void handleDeletePath(path, isFolder);
        }}
      />
    </>
  );
}

interface DeleteConfirmDialogProps {
  target: { path: string; isFolder: boolean } | null;
  files: string[];
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Derive the set of folder paths from a flat file list. Each file at
 * `a/b/c.md` contributes `a` and `a/b` as folder paths. Used to
 * classify a focused tree node as folder vs file without depending on
 * the rendered tree state.
 */
function collectFolderPathsFromFiles(files: string[]): Set<string> {
  const out = new Set<string>();
  for (const file of files) {
    const parts = file.split("/").filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      out.add(parts.slice(0, i + 1).join("/"));
    }
  }
  return out;
}

function DeleteConfirmDialog({
  target,
  files,
  deleting,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const open = target !== null;
  const folderFileCount = target?.isFolder
    ? files.filter(
        (file) => file === target.path || file.startsWith(`${target.path}/`),
      ).length
    : 0;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !deleting) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {target?.isFolder ? "Delete folder?" : "Delete file?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target?.isFolder ? (
              <>
                Delete <code className="font-mono">{target.path}/</code> and all{" "}
                {folderFileCount} file{folderFileCount === 1 ? "" : "s"} inside
                it. This cannot be undone.
              </>
            ) : target ? (
              <>
                Delete <code className="font-mono">{target.path}</code>. This
                cannot be undone.
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
