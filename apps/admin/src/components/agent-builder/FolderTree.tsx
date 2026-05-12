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
import { useEffect, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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
const TREE_ROW_INDENT_PX = 16;
const TREE_ROW_LEFT_PADDING_PX = 8;
const TREE_ROW_ICON_COLUMN_PX = 38;

// Reserved root folders that should render in the tree even when empty.
// Per docs/plans/2026-04-27-004 U2 / U8: skills/ should be visible to
// operators as a place to add skills before any are installed; same goes
// for memory/ as a place agents will write notes. Without this, an
// agent with no installed skills shows no skills/ folder at all.
const RESERVED_ROOT_FOLDERS = ["memory", "skills"] as const;

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
  for (const reserved of RESERVED_ROOT_FOLDERS) {
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
  onCreateSkill?: () => void;
  onAddSkillFromCatalog?: () => void;
  preferRunbookSkills?: boolean;
}

export function FolderTree(props: FolderTreeProps) {
  const [skillsMenu, setSkillsMenu] = useState<{
    x: number;
    y: number;
    path: string;
  } | null>(null);

  useEffect(() => {
    if (!skillsMenu) return;
    const close = () => setSkillsMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [skillsMenu]);

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
          <FolderTreeItem
            key={node.path}
            node={node}
            depth={0}
            onOpenSkillsMenu={(event, path) => {
              event.preventDefault();
              event.stopPropagation();
              setSkillsMenu({ x: event.clientX, y: event.clientY, path });
            }}
            {...props}
          />
        ))}
        {skillsMenu ? (
          <div
            className="fixed z-50 min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            style={{ left: skillsMenu.x, top: skillsMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => {
                setSkillsMenu(null);
                props.onCreateSkill?.();
              }}
            >
              <Plus className="h-4 w-4" />
              {props.preferRunbookSkills ? "New Runbook Skill" : "New Skill"}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => {
                setSkillsMenu(null);
                props.onAddSkillFromCatalog?.();
              }}
            >
              <Plus className="h-4 w-4" />
              {props.preferRunbookSkills
                ? "Add Runbook Skill"
                : "Add from catalog"}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-accent"
              onClick={() => {
                setSkillsMenu(null);
                props.onConfirmDelete(skillsMenu.path);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        ) : null}
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
  onOpenSkillsMenu,
}: FolderTreeProps & {
  node: TreeNode;
  depth: number;
  onOpenSkillsMenu: (event: MouseEvent, path: string) => void;
}) {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedPath === node.path;
  const isDeleting = deletingPath === node.path;
  const isConfirmingDelete = confirmingDeletePath === node.path;

  return (
    <>
      <div
        className={cn(
          "group/tree-row mx-1 flex cursor-pointer items-center gap-1 rounded-md border-[0.5px] border-transparent px-2 py-0.5 text-sm transition-colors hover:bg-accent",
          isSelected && "border-sky-500 bg-accent dark:border-sky-400",
        )}
        style={{
          paddingLeft: `${depth * TREE_ROW_INDENT_PX + TREE_ROW_LEFT_PADDING_PX}px`,
        }}
        onClick={() => {
          if (node.isFolder) onToggle(node.path);
          else onSelect(node.path);
        }}
        onContextMenu={(event) => {
          if (node.isFolder && isSkillsFolderPath(node.path)) {
            onOpenSkillsMenu(event, node.path);
          }
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
              nodes={[]}
              onOpenSkillsMenu={onOpenSkillsMenu}
            />
          ))}
          {node.synthetic && node.children.length === 0 ? (
            <div
              className="px-2 py-2 text-xs text-muted-foreground"
              style={{
                paddingLeft: `${(depth + 1) * TREE_ROW_INDENT_PX + TREE_ROW_LEFT_PADDING_PX}px`,
              }}
            >
              Route specialist folders from AGENTS.md.
            </div>
          ) : node.children.length === 0 ? (
            <div
              className="px-2 py-1 text-xs italic text-muted-foreground"
              style={{
                paddingLeft: `${
                  depth * TREE_ROW_INDENT_PX +
                  TREE_ROW_LEFT_PADDING_PX +
                  TREE_ROW_ICON_COLUMN_PX
                }px`,
              }}
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

function isSkillsFolderPath(path: string): boolean {
  return path === "skills" || path.endsWith("/skills");
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
