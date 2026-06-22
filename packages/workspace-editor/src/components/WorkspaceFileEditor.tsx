import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  FilePlus,
  Folder,
  FolderPlus,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  cn,
} from "@thinkwork/ui";
import { FileEditorPane } from "./FileEditorPane.js";
import {
  FolderTree,
  buildWorkspaceTree,
  type InlineEditState,
} from "./FolderTree.js";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts.js";
import {
  basenameOf,
  joinFolderPath,
  parentFolderOf,
  pathIsWithinFolder,
  replacePathPrefix,
  validateInlineBasename,
} from "../lib/workspace-tree-actions.js";
import type {
  WorkspaceFilesClient,
  WorkspaceFileSource,
} from "../lib/workspace-files-client.js";

export interface WorkspaceFileEditorProps<TTarget> {
  target: TTarget;
  targetKey: string;
  client: WorkspaceFilesClient<TTarget>;
  title?: ReactNode;
  description?: ReactNode;
  defaultOpenFile?: string;
  /** Refetch the visible file tree without changing the target or resetting the
   *  currently open file/editor content. Hosts can bump this after external
   *  writes, such as generated catalog evidence. */
  refreshKey?: string | number;
  readOnly?: boolean;
  className?: string;
  /** Draw the outer border + rounded corners around the tree/editor split.
   *  Default true; full-screen hosts can opt out for an edge-to-edge look. */
  bordered?: boolean;
  /** Replaces the default spinner shown while files load. Hosts pass their
   *  app-standard loading treatment (e.g. the monospace shimmer). */
  loadingSlot?: ReactNode;
}

interface ClipboardItem {
  path: string;
  kind: "file" | "folder";
}

interface DeleteConfirmTarget {
  path: string;
  isFolder: boolean;
}

export function WorkspaceFileEditor<TTarget>({
  target,
  targetKey,
  client,
  title,
  description,
  defaultOpenFile,
  refreshKey,
  readOnly = false,
  className,
  bordered = true,
  loadingSlot,
}: WorkspaceFileEditorProps<TTarget>) {
  const stableTarget = useMemo(() => target, [targetKey, target]);
  const [files, setFiles] = useState<string[]>([]);
  const [fileSources, setFileSources] = useState<
    Record<string, WorkspaceFileSource>
  >({});
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
  const [error, setError] = useState<string | null>(null);
  const [mutatingPaths, setMutatingPaths] = useState<Set<string>>(new Set());
  const [clipboardItem, setClipboardItem] = useState<ClipboardItem | null>(
    null,
  );
  const [focusedTreePath, setFocusedTreePath] = useState<string | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] =
    useState<DeleteConfirmTarget | null>(null);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const openFileRef = useRef<string | null>(null);
  const fileListRequestId = useRef(0);
  const loadRequestId = useRef(0);
  const lastRefreshKeyRef = useRef<typeof refreshKey>(refreshKey);
  // Expand the top-level source roots once per target, the first time files
  // load. A ref (not state) so a user collapsing a root afterwards sticks.
  const didAutoExpandRef = useRef(false);

  useEffect(() => {
    openFileRef.current = openFile;
  }, [openFile]);

  const beginMutation = useCallback((path: string) => {
    setMutatingPaths((current) => new Set(current).add(path));
  }, []);

  const endMutation = useCallback((path: string) => {
    setMutatingPaths((current) => {
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }, []);

  const fetchFiles = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      const requestId = fileListRequestId.current + 1;
      fileListRequestId.current = requestId;
      if (options.showLoading ?? false) setLoadingFiles(true);
      setError(null);
      try {
        const data = await client.listFiles(stableTarget);
        if (fileListRequestId.current !== requestId) return;
        setFiles(data.files.map((file) => file.path));
        const sources: Record<string, WorkspaceFileSource> = {};
        for (const file of data.files) {
          if (file.source) sources[file.path] = file.source;
        }
        setFileSources(sources);
      } catch (err) {
        if (fileListRequestId.current !== requestId) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        if (fileListRequestId.current === requestId) {
          setLoadedFilesOnce(true);
          setLoadingFiles(false);
        }
      }
    },
    [client, stableTarget],
  );

  useEffect(() => {
    loadRequestId.current += 1;
    fileListRequestId.current += 1;
    didAutoExpandRef.current = false;
    setFiles([]);
    setFileSources({});
    setExpandedFolders(new Set());
    setOpenFile(null);
    setContent("");
    setEditValue("");
    setInlineEdit(null);
    setClipboardItem(null);
    setFocusedTreePath(null);
    setLoadedFilesOnce(false);
    setLoadingFiles(true);
  }, [targetKey]);

  useEffect(() => {
    void fetchFiles({ showLoading: true });
  }, [fetchFiles]);

  useEffect(() => {
    if (refreshKey === undefined) return;
    if (lastRefreshKeyRef.current === refreshKey) {
      lastRefreshKeyRef.current = refreshKey;
      return;
    }
    lastRefreshKeyRef.current = refreshKey;
    void fetchFiles({ showLoading: false });
  }, [fetchFiles, refreshKey]);

  const tree = useMemo(() => buildWorkspaceTree(files), [files]);
  const folderPaths = useMemo(
    () => collectFolderPathsFromFiles(files),
    [files],
  );
  const isFolderPath = useCallback(
    (path: string) => folderPaths.has(path),
    [folderPaths],
  );

  // Default the tree to all root folders expanded so the source roots
  // (Agent / Spaces / User) are visible without a click.
  useEffect(() => {
    if (didAutoExpandRef.current || files.length === 0) return;
    const roots = new Set<string>();
    for (const file of files) {
      const top = file.split("/")[0];
      if (top && folderPaths.has(top)) roots.add(top);
    }
    if (roots.size === 0) return;
    didAutoExpandRef.current = true;
    setExpandedFolders((current) => {
      const next = new Set(current);
      for (const root of roots) next.add(root);
      return next;
    });
  }, [files, folderPaths]);

  const openWorkspaceFile = useCallback(
    async (filePath: string) => {
      const requestId = loadRequestId.current + 1;
      loadRequestId.current = requestId;
      const previousOpenFile = openFileRef.current;
      openFileRef.current = filePath;
      setOpenFile(filePath);
      setFocusedTreePath(filePath);
      setLoadingContent(true);
      setError(null);
      if (previousOpenFile !== filePath) {
        setContent("");
        setEditValue("");
      }
      try {
        const data = await client.getFile(stableTarget, filePath);
        if (loadRequestId.current !== requestId) return;
        const fileContent = data.content ?? "";
        setContent(fileContent);
        setEditValue(fileContent);
      } catch (err) {
        if (loadRequestId.current !== requestId) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setContent("");
        setEditValue("");
      } finally {
        if (loadRequestId.current === requestId) setLoadingContent(false);
      }
    },
    [client, stableTarget],
  );

  useEffect(() => {
    if (
      !defaultOpenFile ||
      files.length === 0 ||
      openFileRef.current !== null ||
      !files.includes(defaultOpenFile)
    ) {
      return;
    }
    void openWorkspaceFile(defaultOpenFile);
  }, [defaultOpenFile, files, openWorkspaceFile]);

  const toggleFolder = (path: string) => {
    setFocusedTreePath(path);
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const requestOpenWorkspaceFile = (filePath: string) => {
    if (openFileRef.current === filePath) {
      setFocusedTreePath(filePath);
      return;
    }
    if (editValue !== content && !loadingContent) {
      toast.warning("Save or discard changes before opening another file.");
      return;
    }
    void openWorkspaceFile(filePath);
  };

  const startNewFile = (parentPath = "") => {
    if (readOnly) return;
    const parent = parentPath.replace(/\/$/, "");
    if (parent) setExpandedFolders((current) => new Set(current).add(parent));
    setFocusedTreePath(parent || null);
    setInlineEdit({ mode: "new-file", parentPath: parent, value: "" });
  };

  const startNewFolder = (parentPath = "") => {
    if (readOnly) return;
    const parent = parentPath.replace(/\/$/, "");
    if (parent) setExpandedFolders((current) => new Set(current).add(parent));
    setFocusedTreePath(parent || null);
    setInlineEdit({ mode: "new-folder", parentPath: parent, value: "" });
  };

  const startRename = (path: string, kind: "file" | "folder") => {
    if (readOnly) return;
    if (kind === "folder")
      setExpandedFolders((current) => new Set(current).add(path));
    setFocusedTreePath(path);
    setInlineEdit({ mode: "rename", path, kind, value: basenameOf(path) });
  };

  const handleCut = (path: string, kindHint?: "file" | "folder") => {
    if (readOnly) return;
    setClipboardItem({
      path,
      kind: kindHint ?? (isFolderPath(path) ? "folder" : "file"),
    });
  };

  const clearClipboard = () => setClipboardItem(null);

  const performMove = useCallback(
    async (sourcePath: string, toFolder: string) => {
      if (readOnly || !client.movePath) return null;
      beginMutation(sourcePath);
      try {
        const result = await client.movePath(
          stableTarget,
          sourcePath,
          toFolder,
        );
        await fetchFiles({ showLoading: false });
        if (openFileRef.current === sourcePath) {
          openFileRef.current = result.destPath;
          setOpenFile(result.destPath);
          setFocusedTreePath(result.destPath);
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Move failed: ${message}`);
        return null;
      } finally {
        endMutation(sourcePath);
      }
    },
    [beginMutation, client, endMutation, fetchFiles, readOnly, stableTarget],
  );

  const handlePaste = async (toFolder: string) => {
    if (!clipboardItem) return;
    const result = await performMove(clipboardItem.path, toFolder);
    if (result) setClipboardItem(null);
  };

  const commitInlineEdit = async () => {
    if (readOnly || !inlineEdit) return;
    const current = inlineEdit;
    const validation = validateInlineBasename(current.value);
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
        await client.putFile(
          stableTarget,
          current.mode === "new-folder" ? `${path}/.gitkeep` : path,
          "",
        );
        await fetchFiles({ showLoading: false });
        if (current.mode === "new-file") await openWorkspaceFile(path);
        else {
          setExpandedFolders((folders) => new Set(folders).add(path));
          setFocusedTreePath(path);
        }
        setInlineEdit(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Create failed: ${message}`);
        setInlineEdit({ ...current, committing: false, error: message });
      } finally {
        endMutation(path);
      }
      return;
    }

    if (current.mode !== "rename" || !client.renamePath) return;
    const renameEdit = current;
    const toPath = joinFolderPath(
      parentFolderOf(renameEdit.path),
      validation.basename,
    );
    if (toPath === renameEdit.path) {
      setInlineEdit(null);
      return;
    }
    if (files.includes(toPath) || folderPaths.has(toPath)) {
      setInlineEdit({
        ...renameEdit,
        error: `A file or folder named ${validation.basename} already exists.`,
      });
      return;
    }
    beginMutation(renameEdit.path);
    setInlineEdit({ ...renameEdit, committing: true });
    try {
      const result = await client.renamePath(
        stableTarget,
        renameEdit.path,
        toPath,
      );
      await fetchFiles({ showLoading: false });
      const activeOpenFile = openFileRef.current;
      if (activeOpenFile) {
        const nextOpen =
          renameEdit.kind === "folder"
            ? replacePathPrefix(
                activeOpenFile,
                renameEdit.path,
                result.destPath,
              )
            : activeOpenFile === renameEdit.path
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
        (clipboardItem.path === renameEdit.path ||
          pathIsWithinFolder(clipboardItem.path, renameEdit.path))
      ) {
        setClipboardItem(null);
      }
      setInlineEdit(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Rename failed: ${message}`);
      setInlineEdit({ ...renameEdit, committing: false, error: message });
    } finally {
      endMutation(renameEdit.path);
    }
  };

  const handleSave = useCallback(async () => {
    if (!openFile || readOnly) return;
    const savedPath = openFile;
    const savedValue = editValue;
    setSaving(true);
    setError(null);
    try {
      await client.putFile(stableTarget, savedPath, savedValue);
      if (openFileRef.current === savedPath) {
        setContent(savedValue);
        setEditValue(savedValue);
      }
      await fetchFiles({ showLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`Save failed: ${message}`);
    } finally {
      setSaving(false);
    }
  }, [client, editValue, fetchFiles, openFile, readOnly, stableTarget]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isSaveShortcut =
        event.key.toLowerCase() === "s" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey;
      if (!isSaveShortcut || readOnly) return;
      if (
        !openFileRef.current ||
        saving ||
        loadingContent ||
        editValue === content
      ) {
        return;
      }
      event.preventDefault();
      void handleSave();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [content, editValue, handleSave, loadingContent, readOnly, saving]);

  const handleDeletePath = async (path: string, isFolder: boolean) => {
    if (readOnly) return;
    const paths = isFolder
      ? files.filter((file) => file === path || file.startsWith(`${path}/`))
      : [path];
    if (paths.length === 0) return;
    beginMutation(path);
    try {
      for (const filePath of paths) {
        await client.deleteFile(stableTarget, filePath);
      }
      setFiles((current) => current.filter((file) => !paths.includes(file)));
      if (openFile && paths.includes(openFile)) {
        setOpenFile(null);
        setContent("");
        setEditValue("");
      }
      void fetchFiles({ showLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Delete failed: ${message}`);
    } finally {
      endMutation(path);
    }
  };

  const pasteIntoSelectedScope = useCallback(() => {
    if (!clipboardItem) return;
    const toFolder =
      focusedTreePath && isFolderPath(focusedTreePath) ? focusedTreePath : "";
    void handlePaste(toFolder);
  }, [clipboardItem, focusedTreePath, isFolderPath]);

  const cutFocused = useCallback(() => {
    if (!focusedTreePath) return;
    handleCut(focusedTreePath);
  }, [focusedTreePath]);

  const deleteFocused = useCallback(() => {
    if (!focusedTreePath || readOnly) return;
    setDeleteConfirmTarget({
      path: focusedTreePath,
      isFolder: isFolderPath(focusedTreePath),
    });
  }, [focusedTreePath, isFolderPath, readOnly]);

  useKeyboardShortcuts(
    useMemo(
      () => [
        { key: "x", mod: true, handler: cutFocused },
        { key: "v", mod: true, handler: pasteIntoSelectedScope },
        { key: "Backspace", handler: deleteFocused },
        { key: "Delete", handler: deleteFocused },
      ],
      [cutFocused, deleteFocused, pasteIntoSelectedScope],
    ),
    { scopeRef: treeContainerRef },
  );

  const addMenu = readOnly ? null : (
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
      <DropdownMenuContent side="bottom" align="start" className="min-w-56">
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
    <div className={cn("flex h-full min-h-[400px] flex-col gap-3", className)}>
      {title || description ? (
        <div className="shrink-0">
          {title ? <div className="text-sm font-medium">{title}</div> : null}
          {description ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      {loadingFiles && !loadedFilesOnce ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          {loadingSlot ?? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Loading files...
            </>
          )}
        </div>
      ) : (
        <div
          className={cn(
            "flex min-h-0 flex-1 overflow-hidden",
            bordered && "rounded-md border",
          )}
        >
          <ResizablePanelGroup
            orientation="horizontal"
            className="min-h-0 flex-1"
          >
            <ResizablePanel
              defaultSize="28%"
              minSize="15%"
              className="flex min-h-0 flex-col border-r"
            >
              <div className="flex h-9 items-center justify-between border-b bg-muted/50 px-3 text-xs font-medium text-muted-foreground">
                <span>{files.length} files</span>
                {addMenu}
              </div>
              <div
                className="min-h-0 flex-1 overflow-y-auto outline-none"
                ref={treeContainerRef}
                tabIndex={-1}
              >
                <FolderTree
                  nodes={tree}
                  selectedPath={openFile}
                  expandedFolders={expandedFolders}
                  mutatingPaths={mutatingPaths}
                  clipboardItem={readOnly ? null : clipboardItem}
                  sourceFor={(path) => fileSources[path]}
                  updateAvailableFor={() => false}
                  onSelect={requestOpenWorkspaceFile}
                  onToggle={toggleFolder}
                  onAcceptUpdate={() => {}}
                  onNewFile={startNewFile}
                  onNewFolder={startNewFolder}
                  onDelete={(path, isFolder) =>
                    setDeleteConfirmTarget({ path, isFolder })
                  }
                  onRename={startRename}
                  inlineEdit={inlineEdit}
                  onInlineEditChange={(value) =>
                    setInlineEdit((current) =>
                      current
                        ? { ...current, value, error: undefined }
                        : current,
                    )
                  }
                  onInlineEditCommit={commitInlineEdit}
                  onInlineEditCancel={() => setInlineEdit(null)}
                  onCut={readOnly ? undefined : handleCut}
                  onPaste={readOnly ? undefined : handlePaste}
                  onClearClipboard={readOnly ? undefined : clearClipboard}
                  onDropMove={
                    readOnly
                      ? undefined
                      : (sourcePath, toFolder) =>
                          void performMove(sourcePath, toFolder)
                  }
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              defaultSize="72%"
              className="flex min-h-0 min-w-0 flex-col"
            >
              {files.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  <Folder className="h-12 w-12 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No files yet.</p>
                </div>
              ) : (
                <FileEditorPane
                  openFile={openFile}
                  content={content}
                  value={editValue}
                  loading={loadingContent}
                  saving={saving}
                  readOnly={readOnly}
                  onChange={setEditValue}
                  onSave={handleSave}
                  onDiscard={() => setEditValue(content)}
                />
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}
      <DeleteConfirmDialog
        target={deleteConfirmTarget}
        deleting={
          deleteConfirmTarget !== null &&
          mutatingPaths.has(deleteConfirmTarget.path)
        }
        onCancel={() => setDeleteConfirmTarget(null)}
        onConfirm={() => {
          if (!deleteConfirmTarget) return;
          const target = deleteConfirmTarget;
          setDeleteConfirmTarget(null);
          void handleDeletePath(target.path, target.isFolder);
        }}
      />
    </div>
  );
}

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
  deleting,
  onCancel,
  onConfirm,
}: {
  target: DeleteConfirmTarget | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => !open && onCancel()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {target?.isFolder ? "folder" : "file"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target
              ? `This will delete ${target.path}${target.isFolder ? " and everything inside it" : ""}.`
              : "This path will be deleted."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {deleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
