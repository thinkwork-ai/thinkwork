import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

export function buildWorkspaceTree(
  files: string[],
  routingRows: Pick<RoutingRow, "goTo">[] = [],
): TreeNode[] {
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
    {
      name: "agents",
      path: SUB_AGENTS_NODE_PATH,
      isFolder: true,
      children: sortNodes(subAgentChildren),
      synthetic: true,
    },
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

export interface FolderTreeProps {
  nodes: TreeNode[];
  selectedPath: string | null;
  expandedFolders: Set<string>;
  sourceFor: (path: string) => ComposeSource | undefined;
  updateAvailableFor: (path: string) => boolean;
  deletingPath: string | null;
  confirmingDeletePath: string | null;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onAcceptUpdate: (path: string) => void;
  onDelete: (path: string, isFolder: boolean) => void;
  onConfirmDelete: (path: string) => void;
  onCancelDeleteConfirm: (path: string) => void;
  onAddSubAgent?: () => void;
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
    <TooltipProvider delayDuration={2000} skipDelayDuration={0}>
      <div className="py-1">
        {props.nodes.map((node) => (
          <FolderTreeItem key={node.path} node={node} depth={0} {...props} />
        ))}
      </div>
    </TooltipProvider>
  );
}

function FolderTreeItem({
  node,
  depth,
  selectedPath,
  expandedFolders,
  sourceFor,
  updateAvailableFor,
  deletingPath,
  confirmingDeletePath,
  onSelect,
  onToggle,
  onAcceptUpdate,
  onDelete,
  onConfirmDelete,
  onCancelDeleteConfirm,
  onAddSubAgent,
}: FolderTreeProps & { node: TreeNode; depth: number }) {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedPath === node.path;
  const isDeleting = deletingPath === node.path;
  const isConfirmingDelete = confirmingDeletePath === node.path;

  return (
    <>
      <div
        className={`group/tree-row mx-1 flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-accent ${
          isSelected ? "bg-accent" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (node.isFolder) onToggle(node.path);
          else onSelect(node.path);
        }}
        onMouseLeave={() => onCancelDeleteConfirm(node.path)}
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
        <span className="min-w-0 flex-1 truncate">
          {node.name}
          {node.missing ? (
            <span className="ml-1 text-[10px] text-amber-500">no files</span>
          ) : null}
        </span>
        <span
          className="ml-auto flex items-center gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          {node.synthetic && onAddSubAgent ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Add sub-agent"
              onClick={(event) => {
                event.stopPropagation();
                onAddSubAgent();
              }}
            >
              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          ) : null}
          {!node.isFolder && updateAvailableFor(node.path) && (
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
          {!node.synthetic && (
            <span
              className={`transition-opacity ${
                isSelected || isDeleting || isConfirmingDelete
                  ? "opacity-100"
                  : "opacity-0 group-hover/tree-row:opacity-100"
              }`}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size={isConfirmingDelete ? "sm" : "icon-xs"}
                    className={
                      isConfirmingDelete
                        ? "h-6 rounded-full border border-destructive/45 bg-transparent px-1.5 text-[11px] font-semibold leading-none text-destructive shadow-none transition-none hover:border-destructive/65 hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/25"
                        : "text-muted-foreground/65 transition-none hover:text-foreground"
                    }
                    aria-label={
                      isConfirmingDelete
                        ? `Confirm delete ${node.name}`
                        : `Delete ${node.name}`
                    }
                    disabled={isDeleting}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isConfirmingDelete)
                        onDelete(node.path, node.isFolder);
                      else onConfirmDelete(node.path);
                    }}
                  >
                    {isDeleting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : isConfirmingDelete ? (
                      "Confirm"
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                {!isConfirmingDelete && !isDeleting && (
                  <TooltipContent side="right" sideOffset={6}>
                    Delete
                  </TooltipContent>
                )}
              </Tooltip>
            </span>
          )}
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
              deletingPath={deletingPath}
              confirmingDeletePath={confirmingDeletePath}
              onSelect={onSelect}
              onToggle={onToggle}
              onAcceptUpdate={onAcceptUpdate}
              onDelete={onDelete}
              onConfirmDelete={onConfirmDelete}
              onCancelDeleteConfirm={onCancelDeleteConfirm}
              onAddSubAgent={onAddSubAgent}
              nodes={[]}
            />
          ))}
          {node.synthetic && node.children.length === 0 && onAddSubAgent ? (
            <div
              className="flex items-center justify-between gap-2 px-2 py-2 text-xs text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              <span className="min-w-0">
                Route specialist folders from AGENTS.md.
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 shrink-0 px-2 text-[11px]"
                onClick={onAddSubAgent}
              >
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            </div>
          ) : node.children.length === 0 ? (
            <div
              className="px-2 py-1 text-xs italic text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              Empty folder
            </div>
          ) : null}
        </>
      )}
    </>
  );
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
