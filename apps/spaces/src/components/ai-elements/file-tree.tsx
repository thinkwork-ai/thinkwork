"use client";

// Read-only adaptation of apps/admin/src/components/ai-elements/file-tree.tsx.
// The admin original is a read/write workspace editor wired with @dnd-kit drag
// /drop and a Radix Collapsible. The Local Workspace inspector never mutates the
// tree, so this copy drops the dnd-kit + Collapsible dependencies and keeps only
// nested expand/collapse + selection. Keep the visual language in sync with the
// admin tree when either changes.

import { cn } from "@/lib/utils";
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { createContext, useContext, useState } from "react";

interface FileTreeContextType {
  selectedPath?: string;
  onSelect?: (path: string) => void;
}

const FileTreeContext = createContext<FileTreeContextType>({});

export type FileTreeProps = Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> & {
  selectedPath?: string;
  onSelect?: (path: string) => void;
};

export const FileTree = ({
  selectedPath,
  onSelect,
  className,
  children,
  ...props
}: FileTreeProps) => (
  <FileTreeContext.Provider value={{ selectedPath, onSelect }}>
    {/* w-max + min-w-full lets rows grow past the pane so the scroll container
        scrolls horizontally instead of truncating deep paths. */}
    <div
      className={cn("w-max min-w-full font-mono text-sm", className)}
      role="tree"
      {...props}
    >
      {children}
    </div>
  </FileTreeContext.Provider>
);

export type FileTreeFolderProps = {
  path: string;
  name: ReactNode;
  defaultExpanded?: boolean;
  children?: ReactNode;
};

export const FileTreeFolder = ({
  path: _path,
  name,
  defaultExpanded = false,
  children,
}: FileTreeFolderProps) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div role="treeitem" aria-expanded={expanded}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50"
      >
        <ChevronRightIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        {expanded ? (
          <FolderOpenIcon className="size-4 shrink-0 text-blue-500" />
        ) : (
          <FolderIcon className="size-4 shrink-0 text-blue-500" />
        )}
        <span className="whitespace-nowrap">{name}</span>
      </button>
      {expanded ? <div className="ml-4 border-l pl-2">{children}</div> : null}
    </div>
  );
};

export type FileTreeFileProps = {
  path: string;
  name: ReactNode;
  icon?: ReactNode;
};

export const FileTreeFile = ({ path, name, icon }: FileTreeFileProps) => {
  const { selectedPath, onSelect } = useContext(FileTreeContext);
  const isSelected = selectedPath === path;
  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={isSelected}
      onClick={() => onSelect?.(path)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50",
        isSelected && "bg-muted",
      )}
    >
      <span className="size-4 shrink-0" />
      <span className="shrink-0">
        {icon ?? <FileIcon className="size-4 text-muted-foreground" />}
      </span>
      <span className="whitespace-nowrap">{name}</span>
    </button>
  );
};
