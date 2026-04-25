import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InheritanceIndicator } from "./InheritanceIndicator";
import type { ComposeSource } from "@/lib/agent-builder-api";

export type TreeNode = {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
};

export function buildWorkspaceTree(files: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const filePath of [...files].sort()) {
    const parts = filePath.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
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

  return sortNodes(root);
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

export interface FolderTreeProps {
  nodes: TreeNode[];
  selectedPath: string | null;
  expandedFolders: Set<string>;
  sourceFor: (path: string) => ComposeSource | undefined;
  updateAvailableFor: (path: string) => boolean;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onAcceptUpdate: (path: string) => void;
  onDelete: (path: string, isFolder: boolean) => void;
}

export function FolderTree(props: FolderTreeProps) {
  if (props.nodes.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        No files
      </div>
    );
  }

  return (
    <div className="py-1">
      {props.nodes.map((node) => (
        <FolderTreeItem key={node.path} node={node} depth={0} {...props} />
      ))}
    </div>
  );
}

function FolderTreeItem({
  node,
  depth,
  selectedPath,
  expandedFolders,
  sourceFor,
  updateAvailableFor,
  onSelect,
  onToggle,
  onAcceptUpdate,
  onDelete,
}: FolderTreeProps & { node: TreeNode; depth: number }) {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedPath === node.path;

  return (
    <>
      <div
        className={`group/tree-row flex cursor-pointer items-center gap-1 px-2 py-1 text-sm hover:bg-accent ${
          isSelected ? "bg-accent" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (node.isFolder) onToggle(node.path);
          else onSelect(node.path);
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
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <span
          className="ml-auto flex items-center gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          {!node.isFolder && sourceFor(node.path) && (
            <>
              <InheritanceIndicator
                source={sourceFor(node.path)}
                updateAvailable={updateAvailableFor(node.path)}
              />
              {updateAvailableFor(node.path) && (
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
              )}
            </>
          )}
          <span
            className={`opacity-0 transition-opacity group-hover/tree-row:opacity-100 ${
              isSelected ? "opacity-100" : ""
            }`}
          >
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Delete ${node.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(node.path, node.isFolder);
              }}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </span>
        </span>
      </div>
      {node.isFolder && isExpanded && (
        <>
          {node.children.map((child) => (
            <FolderTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedFolders={expandedFolders}
              sourceFor={sourceFor}
              updateAvailableFor={updateAvailableFor}
              onSelect={onSelect}
              onToggle={onToggle}
              onAcceptUpdate={onAcceptUpdate}
              onDelete={onDelete}
              nodes={[]}
            />
          ))}
          {node.children.length === 0 && (
            <div
              className="px-2 py-1 text-xs italic text-muted-foreground"
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
