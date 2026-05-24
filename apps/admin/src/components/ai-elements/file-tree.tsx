"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  Loader2Icon,
} from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

interface FileTreeContextType {
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
}

const noop = () => {};

const FileTreeContext = createContext<FileTreeContextType>({
  expandedPaths: new Set(),
  togglePath: noop,
});

export type FileTreeProps = Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> & {
  expanded?: Set<string>;
  defaultExpanded?: Set<string>;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onExpandedChange?: (expanded: Set<string>) => void;
};

export const FileTree = ({
  expanded: controlledExpanded,
  defaultExpanded = new Set(),
  selectedPath,
  onSelect,
  onExpandedChange,
  className,
  children,
  ...props
}: FileTreeProps) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expandedPaths = controlledExpanded ?? internalExpanded;

  const togglePath = useCallback(
    (path: string) => {
      const newExpanded = new Set(expandedPaths);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }
      setInternalExpanded(newExpanded);
      onExpandedChange?.(newExpanded);
    },
    [expandedPaths, onExpandedChange],
  );

  const contextValue = useMemo(
    () => ({ expandedPaths, onSelect, selectedPath, togglePath }),
    [expandedPaths, onSelect, selectedPath, togglePath],
  );

  return (
    <FileTreeContext.Provider value={contextValue}>
      <div
        className={cn(
          "rounded-lg border bg-background font-mono text-sm",
          className,
        )}
        role="tree"
        {...props}
      >
        <div className="p-2">{children}</div>
      </div>
    </FileTreeContext.Provider>
  );
};

export type FileTreeIconProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeIcon = ({
  className,
  children,
  ...props
}: FileTreeIconProps) => (
  <span className={cn("shrink-0", className)} {...props}>
    {children}
  </span>
);

export type FileTreeNameProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeName = ({
  className,
  children,
  ...props
}: FileTreeNameProps) => (
  <span className={cn("truncate", className)} {...props}>
    {children}
  </span>
);

interface FileTreeFolderContextType {
  path: string;
  name: ReactNode;
  isExpanded: boolean;
}

const FileTreeFolderContext = createContext<FileTreeFolderContextType>({
  isExpanded: false,
  name: "",
  path: "",
});

/**
 * Auto-expand a hovered drop target after sustained hover. When `isOver`
 * stays true for `delayMs`, calls `expand()` so the user can drop into
 * nested folders without manually expanding first. Cancels if the
 * pointer leaves before the delay elapses. No-op if `expanded` is
 * already true.
 */
function useAutoExpandOnHover(opts: {
  isOver: boolean;
  expanded: boolean;
  expand: () => void;
  delayMs?: number;
}) {
  const { isOver, expanded, expand, delayMs = 600 } = opts;
  useEffect(() => {
    if (!isOver || expanded) return;
    const t = setTimeout(expand, delayMs);
    return () => clearTimeout(t);
  }, [isOver, expanded, expand, delayMs]);
}

export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  /**
   * Local extension: widened from `string` to `ReactNode` so folder rows can
   * include inline annotations (e.g. an amber "no files" badge for routed
   * sub-agent folders that have no files yet).
   */
  name: ReactNode;
  /**
   * Local extension: optional content rendered inline at the right edge of
   * the folder header row. Use this to host trailing row actions (delete
   * affordance, inheritance indicators, etc.) without collapsing them into
   * the nested-children area.
   */
  trailing?: ReactNode;
  /**
   * Local extension: inline editor rendered in place of the label button
   * content while a row is being renamed.
   */
  editingName?: ReactNode;
  /**
   * Local extension: when true, substitute the folder icon with a spinning
   * loader to signal an in-flight delete or move targeting this node.
   * Other interactions on the rest of the tree remain responsive.
   */
  isMutating?: boolean;
  /**
   * Local extension: when true, render the row with reduced opacity and a
   * dashed border to indicate the node is in the clipboard (cut, not yet
   * pasted). Visual only — selection / expansion / context-menu wiring is
   * unchanged.
   */
  isCut?: boolean;
};

export const FileTreeFolder = ({
  path,
  name,
  className,
  children,
  trailing,
  editingName,
  isMutating,
  isCut,
  ...props
}: FileTreeFolderProps) => {
  const { expandedPaths, togglePath, selectedPath, onSelect } =
    useContext(FileTreeContext);
  const isExpanded = expandedPaths.has(path);
  const isSelected = selectedPath === path;

  // dnd-kit wiring. The folder row is BOTH a draggable (the operator
  // can pick it up and drop it elsewhere) AND a droppable (other rows
  // can be dropped onto it). When no DndContext ancestor exists, the
  // hooks return inert defaults — no behavior change for non-dnd
  // callers.
  const drag = useDraggable({
    id: path,
    data: { kind: "folder" as const, path },
  });
  const drop = useDroppable({
    id: path,
    data: { kind: "folder" as const, path },
  });

  const expandCallback = useCallback(
    () => togglePath(path),
    [togglePath, path],
  );
  useAutoExpandOnHover({
    isOver: drop.isOver,
    expanded: isExpanded,
    expand: expandCallback,
  });

  const handleOpenChange = useCallback(() => {
    togglePath(path);
  }, [togglePath, path]);

  const handleSelect = useCallback(() => {
    onSelect?.(path);
  }, [onSelect, path]);

  const folderContextValue = useMemo(
    () => ({ isExpanded, name, path }),
    [isExpanded, name, path],
  );

  const setRowRef = useCallback(
    (el: HTMLDivElement | null) => {
      drag.setNodeRef(el);
      drop.setNodeRef(el);
    },
    [drag.setNodeRef, drop.setNodeRef],
  );

  const dragStyle = drag.transform
    ? { transform: CSS.Translate.toString(drag.transform) }
    : undefined;

  return (
    <FileTreeFolderContext.Provider value={folderContextValue}>
      <Collapsible onOpenChange={handleOpenChange} open={isExpanded}>
        <div
          className={cn("group/file-tree-folder", className)}
          role="treeitem"
          tabIndex={0}
          {...props}
        >
          <div
            ref={setRowRef}
            style={dragStyle}
            data-over={drop.isOver || undefined}
            data-dragging={drag.isDragging || undefined}
            {...drag.attributes}
            {...drag.listeners}
            className={cn(
              "flex w-full items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50",
              isSelected && "bg-muted",
              isCut &&
                "border border-dashed border-muted-foreground/40 opacity-50",
              drop.isOver && "ring-2 ring-blue-500",
              drag.isDragging && "opacity-50",
            )}
          >
            <CollapsibleTrigger asChild>
              <button
                className="flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0"
                type="button"
              >
                <ChevronRightIcon
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    isExpanded && "rotate-90",
                  )}
                />
              </button>
            </CollapsibleTrigger>
            {editingName ? (
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <FileTreeIcon>
                  {isMutating ? (
                    <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                  ) : isExpanded ? (
                    <FolderOpenIcon className="size-4 text-blue-500" />
                  ) : (
                    <FolderIcon className="size-4 text-blue-500" />
                  )}
                </FileTreeIcon>
                {editingName}
              </div>
            ) : (
              <button
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-left"
                onClick={handleSelect}
                type="button"
              >
                <FileTreeIcon>
                  {isMutating ? (
                    <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                  ) : isExpanded ? (
                    <FolderOpenIcon className="size-4 text-blue-500" />
                  ) : (
                    <FolderIcon className="size-4 text-blue-500" />
                  )}
                </FileTreeIcon>
                <FileTreeName>{name}</FileTreeName>
              </button>
            )}
            {trailing ? trailing : null}
          </div>
          <CollapsibleContent>
            <div className="ml-4 border-l pl-2">{children}</div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </FileTreeFolderContext.Provider>
  );
};

interface FileTreeFileContextType {
  path: string;
  name: ReactNode;
}

const FileTreeFileContext = createContext<FileTreeFileContextType>({
  name: "",
  path: "",
});

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  /**
   * Local extension: widened from `string` to `ReactNode` for consistency
   * with FileTreeFolder. Most file rows pass a plain string; rows that
   * need inline annotations next to the name can pass a fragment.
   */
  name: ReactNode;
  icon?: ReactNode;
  /**
   * Local extension: when true, substitute the file icon with a spinning
   * loader to signal an in-flight delete or move targeting this node.
   */
  isMutating?: boolean;
  /**
   * Local extension: when true, render the row with reduced opacity and a
   * dashed border to indicate the node is in the clipboard (cut, not yet
   * pasted).
   */
  isCut?: boolean;
};

export const FileTreeFile = ({
  path,
  name,
  icon,
  className,
  children,
  isMutating,
  isCut,
  ...props
}: FileTreeFileProps) => {
  const { selectedPath, onSelect } = useContext(FileTreeContext);
  const isSelected = selectedPath === path;

  const drag = useDraggable({
    id: path,
    data: { kind: "file" as const, path },
  });

  const handleClick = useCallback(() => {
    onSelect?.(path);
  }, [onSelect, path]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        onSelect?.(path);
      }
    },
    [onSelect, path],
  );

  const fileContextValue = useMemo(() => ({ name, path }), [name, path]);

  const resolvedIcon = isMutating ? (
    <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
  ) : (
    (icon ?? <FileIcon className="size-4 text-muted-foreground" />)
  );

  const dragStyle = drag.transform
    ? { transform: CSS.Translate.toString(drag.transform) }
    : undefined;

  // Mirrors FileTreeFolder's two-div structure: outer div hosts the
  // role/tabIndex + any parent slot (ContextMenuTrigger asChild),
  // inner div owns dnd-kit's drag listeners and the click handler.
  // Without this split, a context-menu trigger wrapping the file row
  // merges its pointer-handlers onto the same div as dnd-kit's
  // listeners and the long-press handler swallows pointerdown before
  // dnd-kit can activate a drag — files become un-draggable.
  return (
    <FileTreeFileContext.Provider value={fileContextValue}>
      <div
        className={cn("group/file-tree-file", className)}
        role="treeitem"
        tabIndex={0}
        {...props}
      >
        <div
          ref={drag.setNodeRef}
          style={dragStyle}
          data-dragging={drag.isDragging || undefined}
          {...drag.attributes}
          {...drag.listeners}
          className={cn(
            "flex cursor-pointer items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-muted/50",
            isSelected && "bg-muted",
            isCut &&
              "border border-dashed border-muted-foreground/40 opacity-50",
            drag.isDragging && "opacity-50",
          )}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
        >
          {children ?? (
            <>
              <span className="size-4 shrink-0" />
              <FileTreeIcon>{resolvedIcon}</FileTreeIcon>
              <FileTreeName>{name}</FileTreeName>
            </>
          )}
        </div>
      </div>
    </FileTreeFileContext.Provider>
  );
};

export type FileTreeActionsProps = HTMLAttributes<HTMLDivElement>;

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

export const FileTreeActions = ({
  className,
  children,
  ...props
}: FileTreeActionsProps) => (
  <div
    className={cn("ml-auto flex items-center gap-1", className)}
    onClick={stopPropagation}
    onKeyDown={stopPropagation}
    role="group"
    {...props}
  >
    {children}
  </div>
);
