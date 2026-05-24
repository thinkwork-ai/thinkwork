import { useCallback, useEffect, useMemo, useRef } from "react";
import { FolderIcon, Loader2Icon } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  FileTree,
  FileTreeActions,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree";
import { InheritanceIndicator } from "./InheritanceIndicator";
import type { ComposeSource } from "@/lib/agent-builder-api";
import type { RoutingRow } from "./routing-table";

export type TreeNode = {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
  synthetic?: boolean;
  missing?: boolean;
};

const SUB_AGENTS_NODE_PATH = "__synthetic__/sub-agents";
const RESERVED_ROUTING_FOLDERS = new Set(["memory", "skills"]);

// Reserved root folders that should render in the tree even when empty.
// Per docs/plans/2026-04-27-004 U2 / U8: skills/ should be visible to
// operators as a place to add skills before any are installed; same goes
// for memory/ as a place agents will write notes. Without this, an
// agent with no installed skills shows no skills/ folder at all.
const RESERVED_ROOT_FOLDERS = ["memory", "skills"] as const;

export function buildWorkspaceTree(
  files: string[],
  routingRows: Pick<RoutingRow, "goTo">[] = [],
  options: { reservedRootFolders?: readonly string[] } = {},
): TreeNode[] {
  const root: TreeNode[] = [];

  for (const filePath of [...files].sort()) {
    const parts = filePath.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (part === ".gitkeep" && isLast) continue;
      const pathSoFar = parts.slice(0, i + 1).join("/");

      let existing = current.find((node) => node.name === part);
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

  // Ensure reserved root folders (memory/, skills/) always appear in the
  // tree even when no files exist under them yet. Operators need a stable
  // surface to drop into for adding skills / writing memory notes.
  const reservedRootFolders =
    options.reservedRootFolders ?? RESERVED_ROOT_FOLDERS;
  for (const reserved of reservedRootFolders) {
    if (!root.some((node) => node.path === reserved)) {
      root.push({
        name: reserved,
        path: reserved,
        isFolder: true,
        children: [],
      });
    }
  }

  const routedPaths = routedFolderPaths(routingRows);
  const routedTopFolders = new Set(
    routedPaths
      .filter((path) => !path.includes("/"))
      .map((path) => path.replace(/\/$/, "")),
  );
  const subAgentChildren: TreeNode[] = [];
  const remainingRoot: TreeNode[] = [];

  for (const node of root) {
    if (node.isFolder && routedTopFolders.has(node.path)) {
      subAgentChildren.push(node);
    } else {
      remainingRoot.push(node);
    }
  }

  const existingSubAgentPaths = new Set(
    subAgentChildren.map((node) => node.path),
  );
  for (const path of routedPaths) {
    if (existingSubAgentPaths.has(path)) continue;
    subAgentChildren.push({
      name: path,
      path,
      isFolder: true,
      children: [],
      missing: true,
    });
  }

  return [
    ...(subAgentChildren.length > 0
      ? [
          {
            name: "agents",
            path: SUB_AGENTS_NODE_PATH,
            isFolder: true,
            children: sortNodes(subAgentChildren),
            synthetic: true,
          },
        ]
      : []),
    ...sortNodes(remainingRoot),
  ];
}

function sortNodes(nodes: TreeNode[]) {
  nodes.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.isFolder) sortNodes(node.children);
  }
  return nodes;
}

export interface ClipboardItem {
  path: string;
  kind: "file" | "folder";
}

export interface FolderTreeProps {
  nodes: TreeNode[];
  selectedPath: string | null;
  expandedFolders: Set<string>;
  /**
   * Paths currently undergoing a mutation (delete, move). Nodes in this
   * set render with a spinner in place of their icon. Per-node, not
   * global — other tree interactions stay responsive.
   */
  mutatingPaths?: Set<string>;
  /**
   * Single item currently cut. The matching node renders with a dashed
   * border + reduced opacity, and folder/root context menus offer
   * "Paste" while it is set. Pass `null` (or omit) when nothing is cut.
   */
  clipboardItem?: ClipboardItem | null;
  sourceFor: (path: string) => ComposeSource | undefined;
  updateAvailableFor: (path: string) => boolean;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onAcceptUpdate: (path: string) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onDelete: (path: string, isFolder: boolean) => void;
  onRename?: (path: string, kind: "file" | "folder") => void;
  onRegenerateMap?: (path: string) => void;
  onGenerateFolderStructure?: (path: string) => void;
  inlineEdit?: InlineEditState | null;
  onInlineEditChange?: (value: string) => void;
  onInlineEditCommit?: () => void;
  onInlineEditCancel?: () => void;
  /**
   * Optional clipboard wiring. When provided, file + folder context
   * menus show a "Cut" item, and folder + root context menus show
   * "Paste" while `clipboardItem` is set.
   */
  onCut?: (path: string, kind: "file" | "folder") => void;
  onPaste?: (toFolder: string) => void;
  onClearClipboard?: () => void;
  /**
   * Called when a drag completes on a valid drop target. `sourcePath`
   * is the dragged item; `toFolder` is the destination folder path
   * (or `""` for the workspace root). The parent dispatches the actual
   * move via the server `move` action. Optional — when omitted,
   * drag-and-drop is functionally disabled even though the visual
   * affordances still render.
   */
  onDropMove?: (sourcePath: string, toFolder: string) => void;
}

export type InlineEditState =
  | {
      mode: "rename";
      path: string;
      kind: "file" | "folder";
      value: string;
      error?: string;
      committing?: boolean;
    }
  | {
      mode: "new-file" | "new-folder";
      parentPath: string;
      value: string;
      error?: string;
      committing?: boolean;
    };

const ROOT_DROPPABLE_ID = "__root__";

export function FolderTree(props: FolderTreeProps) {
  const {
    nodes,
    selectedPath,
    expandedFolders,
    clipboardItem,
    onSelect,
    onToggle,
    onPaste,
    onClearClipboard,
    onNewFile,
    onNewFolder,
    onDropMove,
    inlineEdit,
  } = props;

  // Collect the set of folder paths so the AI Elements onSelect callback
  // can route folder-name clicks into onToggle (matching the existing UX
  // where clicking a folder row expands/collapses it).
  const folderPaths = useMemo(() => collectFolderPaths(nodes), [nodes]);

  // dnd-kit sensors. Distance-4 activation prevents simple click events
  // on the row from being interpreted as drags (the row's CollapsibleTrigger
  // and selection button stay functional). KeyboardSensor gives the tree
  // accessible drag-and-drop out of the box.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !onDropMove) return;
      const sourcePath = String(active.id);
      const overId = String(over.id);
      const toFolder = overId === ROOT_DROPPABLE_ID ? "" : overId;
      // Drop onto self is a no-op.
      if (sourcePath === toFolder) return;
      onDropMove(sourcePath, toFolder);
    },
    [onDropMove],
  );

  const rootPendingItem =
    inlineEdit?.mode === "new-file" && inlineEdit.parentPath === "" ? (
      <PendingInlineFile key="__pending-root-file" {...props} />
    ) : inlineEdit?.mode === "new-folder" && inlineEdit.parentPath === "" ? (
      <PendingInlineFolder key="__pending-root-folder" {...props} />
    ) : null;

  if (nodes.length === 0 && !rootPendingItem) {
    // Render the empty state inside a context-menu trigger too so the
    // operator can paste / create at the workspace root even when the
    // tree is currently empty. Wrap in DndContext so dropping onto the
    // root drop zone still works.
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <RootDropZone>
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No files
              </div>
            </RootDropZone>
          </ContextMenuTrigger>
          <RootContextMenu
            clipboardItem={clipboardItem}
            onPaste={onPaste}
            onClearClipboard={onClearClipboard}
            onNewFile={onNewFile}
            onNewFolder={onNewFolder}
          />
        </ContextMenu>
      </DndContext>
    );
  }

  const handleExpandedChange = (next: Set<string>) => {
    // Diff against current to translate Set updates into single-path toggle
    // calls — the parent owns expandedFolders state and expects per-path
    // notifications.
    for (const path of next) {
      if (!expandedFolders.has(path)) onToggle(path);
    }
    for (const path of expandedFolders) {
      if (!next.has(path)) onToggle(path);
    }
  };

  const handleSelect = (path: string) => {
    if (folderPaths.has(path)) {
      onToggle(path);
    } else {
      onSelect(path);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <RootDropZone>
            <FileTree
              expanded={expandedFolders}
              onExpandedChange={handleExpandedChange}
              selectedPath={selectedPath ?? undefined}
              onSelect={handleSelect}
              className="rounded-none border-0 bg-transparent text-xs"
            >
              {nodes.map((node) => (
                <FolderTreeItem key={node.path} node={node} {...props} />
              ))}
              {rootPendingItem}
            </FileTree>
          </RootDropZone>
        </ContextMenuTrigger>
        <RootContextMenu
          clipboardItem={clipboardItem}
          onPaste={onPaste}
          onClearClipboard={onClearClipboard}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
        />
      </ContextMenu>
    </DndContext>
  );
}

/**
 * Workspace-root drop zone. Wraps the tree's content so dragging
 * something onto empty space below the rows (or onto a non-folder
 * region) drops it at the workspace root.
 */
function RootDropZone({ children }: { children: React.ReactNode }) {
  const drop = useDroppable({
    id: ROOT_DROPPABLE_ID,
    data: { kind: "root" as const },
  });
  return (
    <div
      ref={drop.setNodeRef}
      data-over={drop.isOver || undefined}
      className="min-h-full"
      // Native drag-over from the desktop is treated as a no-op so we
      // don't accept arbitrary OS file drops — R13 says intra-tree only.
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </div>
  );
}

interface RootContextMenuProps {
  clipboardItem?: ClipboardItem | null;
  onPaste?: (toFolder: string) => void;
  onClearClipboard?: () => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
}

function RootContextMenu({
  clipboardItem,
  onPaste,
  onClearClipboard,
  onNewFile,
  onNewFolder,
}: RootContextMenuProps) {
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => onNewFile("")}>New File</ContextMenuItem>
      <ContextMenuItem onSelect={() => onNewFolder("")}>
        New Folder
      </ContextMenuItem>
      {clipboardItem && onPaste ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onPaste("")}>Paste</ContextMenuItem>
          {onClearClipboard ? (
            <ContextMenuItem onSelect={onClearClipboard}>
              Clear clipboard
            </ContextMenuItem>
          ) : null}
        </>
      ) : null}
    </ContextMenuContent>
  );
}

function FolderTreeItem(
  props: FolderTreeProps & {
    node: TreeNode;
  },
) {
  const {
    node,
    selectedPath,
    expandedFolders,
    mutatingPaths,
    clipboardItem,
    sourceFor,
    updateAvailableFor,
    onAcceptUpdate,
    onNewFile,
    onNewFolder,
    onDelete,
    onRename,
    onRegenerateMap,
    onGenerateFolderStructure,
    onCut,
    onPaste,
    onClearClipboard,
    inlineEdit,
  } = props;
  const isMutating = mutatingPaths?.has(node.path) ?? false;
  const isCut = clipboardItem?.path === node.path;
  const clipboardActive = Boolean(clipboardItem);
  const isRenaming =
    inlineEdit?.mode === "rename" && inlineEdit.path === node.path;

  if (node.isFolder) {
    // Synthetic agents/ group is a virtual UI grouping, not a real folder —
    // its path is __synthetic__/sub-agents which can't host files. Treat
    // creates from its context menu as workspace-root creates, and don't
    // offer Delete / Cut / Paste on the grouping or on routed-but-empty
    // entries (they have no real S3 prefix to act on).
    const contextParent = node.synthetic ? "" : node.path;
    const canMutate = !node.synthetic && !node.missing;

    const hasPendingNewItem =
      (inlineEdit?.mode === "new-file" || inlineEdit?.mode === "new-folder") &&
      inlineEdit.parentPath === node.path;

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <FileTreeFolder
            path={node.path}
            name={renderFolderLabel(node)}
            editingName={
              isRenaming ? <InlineNameInput {...props} /> : undefined
            }
            isMutating={isMutating}
            isCut={isCut}
          >
            {node.children.map((child) => (
              <FolderTreeItem
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                expandedFolders={expandedFolders}
                mutatingPaths={mutatingPaths}
                clipboardItem={clipboardItem}
                sourceFor={sourceFor}
                updateAvailableFor={updateAvailableFor}
                onSelect={() => {}}
                onToggle={() => {}}
                onAcceptUpdate={onAcceptUpdate}
                onNewFile={onNewFile}
                onNewFolder={onNewFolder}
                onDelete={onDelete}
                onRename={onRename}
                onRegenerateMap={onRegenerateMap}
                onGenerateFolderStructure={onGenerateFolderStructure}
                onCut={onCut}
                onPaste={onPaste}
                onClearClipboard={onClearClipboard}
                inlineEdit={props.inlineEdit}
                onInlineEditChange={props.onInlineEditChange}
                onInlineEditCommit={props.onInlineEditCommit}
                onInlineEditCancel={props.onInlineEditCancel}
                nodes={[]}
              />
            ))}
            {inlineEdit?.mode === "new-folder" &&
            inlineEdit.parentPath === node.path ? (
              <PendingInlineFolder {...props} />
            ) : null}
            {inlineEdit?.mode === "new-file" &&
            inlineEdit.parentPath === node.path ? (
              <PendingInlineFile {...props} />
            ) : null}
            {node.synthetic && node.children.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                Route specialist folders from AGENTS.md.
              </div>
            ) : node.children.length === 0 && !hasPendingNewItem ? (
              <div className="px-2 py-1 text-xs italic text-muted-foreground">
                Empty folder
              </div>
            ) : null}
          </FileTreeFolder>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onNewFile(contextParent)}>
            New File
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onNewFolder(contextParent)}>
            New Folder
          </ContextMenuItem>
          {canMutate && (onRename || onCut) ? (
            <>
              <ContextMenuSeparator />
              {onRename ? (
                <ContextMenuItem onSelect={() => onRename(node.path, "folder")}>
                  Rename
                </ContextMenuItem>
              ) : null}
              {onCut ? (
                <ContextMenuItem onSelect={() => onCut(node.path, "folder")}>
                  Cut
                </ContextMenuItem>
              ) : null}
            </>
          ) : null}
          {clipboardActive && onPaste && !node.synthetic ? (
            <ContextMenuItem onSelect={() => onPaste(node.path)}>
              Paste
            </ContextMenuItem>
          ) : null}
          {clipboardActive && onClearClipboard ? (
            <ContextMenuItem onSelect={onClearClipboard}>
              Clear clipboard
            </ContextMenuItem>
          ) : null}
          {canMutate ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={() => onDelete(node.path, true)}
              >
                Delete
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // File row. Wrap in a ContextMenu so right-click offers Delete. The
  // primitive renders the default file row unless we need a Review
  // affordance for an inherited-template update.
  const updateAvailable = updateAvailableFor(node.path);
  const fileLabel = isRenaming ? <InlineNameInput {...props} /> : node.name;
  const canRegenerateMap = node.path === "AGENTS.md" && onRegenerateMap;
  const canGenerateFolderStructure =
    node.name === "CONTEXT.md" && onGenerateFolderStructure;

  const fileRow =
    updateAvailable && !isRenaming ? (
      <FileTreeFile
        path={node.path}
        name={node.name}
        isMutating={isMutating}
        isCut={isCut}
      >
        <span className="size-4 shrink-0" />
        <FileGlyph isMutating={isMutating} />
        <span className="min-w-0 flex-1 truncate">{fileLabel}</span>
        <FileTreeActions>
          <InheritanceIndicator
            source={sourceFor(node.path)}
            updateAvailable={updateAvailable}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-amber-500"
            onClick={(event) => {
              event.stopPropagation();
              onAcceptUpdate(node.path);
            }}
          >
            Review
          </Button>
        </FileTreeActions>
      </FileTreeFile>
    ) : (
      <FileTreeFile
        path={node.path}
        name={fileLabel}
        isMutating={isMutating}
        isCut={isCut}
      />
    );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{fileRow}</ContextMenuTrigger>
      <ContextMenuContent>
        {canRegenerateMap || canGenerateFolderStructure ? (
          <>
            {canRegenerateMap ? (
              <ContextMenuItem onSelect={() => canRegenerateMap(node.path)}>
                Regenerate Map
              </ContextMenuItem>
            ) : null}
            {canGenerateFolderStructure ? (
              <ContextMenuItem
                onSelect={() => canGenerateFolderStructure(node.path)}
              >
                Generate Folder Structure
              </ContextMenuItem>
            ) : null}
            <ContextMenuSeparator />
          </>
        ) : null}
        {onCut ? (
          <ContextMenuItem onSelect={() => onCut(node.path, "file")}>
            Cut
          </ContextMenuItem>
        ) : null}
        {onRename ? (
          <ContextMenuItem onSelect={() => onRename(node.path, "file")}>
            Rename
          </ContextMenuItem>
        ) : null}
        {clipboardActive && onClearClipboard ? (
          <ContextMenuItem onSelect={onClearClipboard}>
            Clear clipboard
          </ContextMenuItem>
        ) : null}
        {onCut ? <ContextMenuSeparator /> : null}
        <ContextMenuItem
          variant="destructive"
          onSelect={() => onDelete(node.path, false)}
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PendingInlineFile(props: FolderTreeProps) {
  const parent =
    props.inlineEdit?.mode === "new-file" ? props.inlineEdit.parentPath : "";
  return (
    <FileTreeFile
      path={`__pending-new-file__/${parent || "root"}`}
      name={<InlineNameInput {...props} />}
      isMutating={props.inlineEdit?.committing}
    />
  );
}

function PendingInlineFolder(props: FolderTreeProps) {
  const parent =
    props.inlineEdit?.mode === "new-folder" ? props.inlineEdit.parentPath : "";
  return (
    <FileTreeFile
      path={`__pending-new-folder__/${parent || "root"}`}
      name={<InlineNameInput {...props} />}
      icon={<FolderIcon className="size-4 text-blue-500" />}
      isMutating={props.inlineEdit?.committing}
    />
  );
}

function InlineNameInput({
  inlineEdit,
  onInlineEditChange,
  onInlineEditCommit,
  onInlineEditCancel,
}: FolderTreeProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const suppressBlurCommitRef = useRef(false);
  const editKey =
    inlineEdit?.mode === "rename"
      ? inlineEdit.path
      : inlineEdit?.mode === "new-file" || inlineEdit?.mode === "new-folder"
        ? inlineEdit.parentPath
        : "";

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (inlineEdit?.mode === "rename") {
      input.select();
    } else {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, [inlineEdit?.mode, editKey]);

  if (!inlineEdit) return null;

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <input
        ref={inputRef}
        className="h-6 min-w-0 rounded-sm border border-ring bg-background px-1.5 py-0 text-xs text-foreground outline-none"
        value={inlineEdit.value}
        disabled={inlineEdit.committing}
        onChange={(event) => onInlineEditChange?.(event.target.value)}
        onBlur={() => {
          if (suppressBlurCommitRef.current) return;
          onInlineEditCommit?.();
        }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            suppressBlurCommitRef.current = false;
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            suppressBlurCommitRef.current = true;
            onInlineEditCancel?.();
          }
        }}
      />
      {inlineEdit.error ? (
        <span className="truncate text-[10px] text-destructive">
          {inlineEdit.error}
        </span>
      ) : null}
    </span>
  );
}

function renderFolderLabel(node: TreeNode) {
  if (node.missing) {
    return (
      <>
        {node.name}
        <span className="ml-1 text-[10px] text-amber-500">no files</span>
      </>
    );
  }
  return node.name;
}

function FileGlyph({ isMutating = false }: { isMutating?: boolean }) {
  if (isMutating) {
    return (
      <span className="shrink-0 text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="shrink-0 text-muted-foreground">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
        aria-hidden="true"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    </span>
  );
}

function collectFolderPaths(nodes: TreeNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.isFolder) {
        out.add(node.path);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

export function subAgentsNodePath(): string {
  return SUB_AGENTS_NODE_PATH;
}

function routedFolderPaths(routingRows: Pick<RoutingRow, "goTo">[]): string[] {
  const out = new Set<string>();
  for (const row of routingRows) {
    const path = normalizeRoutingPath(row.goTo);
    if (!path) continue;
    const first = path.split("/")[0];
    if (!first || RESERVED_ROUTING_FOLDERS.has(first)) continue;
    out.add(path);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function normalizeRoutingPath(goTo: string): string | null {
  const clean = goTo.trim().replace(/^`|`$/g, "");
  if (!clean || clean === "." || clean === "./") return null;
  if (clean.startsWith("/") || clean.includes("..") || clean.includes("\\")) {
    return null;
  }
  return clean.replace(/^\.\//, "").replace(/\/+$/, "");
}
