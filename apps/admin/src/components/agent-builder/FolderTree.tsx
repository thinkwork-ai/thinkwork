import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
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
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onAcceptUpdate: (path: string) => void;
  onDelete: (path: string, isFolder: boolean) => void;
  onCreateSkill?: () => void;
  onAddSkillFromCatalog?: () => void;
  preferRunbookSkills?: boolean;
}

export function FolderTree(props: FolderTreeProps) {
  const {
    nodes,
    selectedPath,
    expandedFolders,
    onSelect,
    onToggle,
    onCreateSkill,
    onAddSkillFromCatalog,
    onDelete,
    preferRunbookSkills,
  } = props;

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

  // Collect the set of folder paths so the AI Elements onSelect callback
  // can route folder-name clicks into onToggle (matching the existing UX
  // where clicking a folder row expands/collapses it).
  const folderPaths = useMemo(() => collectFolderPaths(nodes), [nodes]);

  if (nodes.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        No files
      </div>
    );
  }

  const openSkillsMenu = (event: MouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSkillsMenu({ x: event.clientX, y: event.clientY, path });
  };

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
    <>
      <FileTree
        expanded={expandedFolders}
        onExpandedChange={handleExpandedChange}
        selectedPath={selectedPath ?? undefined}
        onSelect={handleSelect}
        className="rounded-none border-0 bg-transparent text-xs"
      >
        {nodes.map((node) => (
          <FolderTreeItem
            key={node.path}
            node={node}
            onOpenSkillsMenu={openSkillsMenu}
            {...props}
          />
        ))}
      </FileTree>
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
              onCreateSkill?.();
            }}
          >
            <Plus className="h-4 w-4" />
            {preferRunbookSkills ? "New Runbook Skill" : "New Skill"}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              setSkillsMenu(null);
              onAddSkillFromCatalog?.();
            }}
          >
            <Plus className="h-4 w-4" />
            {preferRunbookSkills ? "Add Runbook Skill" : "Add from catalog"}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-accent"
            onClick={() => {
              setSkillsMenu(null);
              onDelete(skillsMenu.path, true);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      ) : null}
    </>
  );
}

function FolderTreeItem({
  node,
  selectedPath,
  expandedFolders,
  sourceFor,
  updateAvailableFor,
  onAcceptUpdate,
  onDelete,
  onOpenSkillsMenu,
}: FolderTreeProps & {
  node: TreeNode;
  onOpenSkillsMenu: (event: MouseEvent, path: string) => void;
}) {
  if (node.isFolder) {
    return (
      <FileTreeFolder
        path={node.path}
        name={renderFolderLabel(node)}
        onContextMenu={(event) => {
          if (isSkillsFolderPath(node.path)) {
            onOpenSkillsMenu(event, node.path);
          }
        }}
      >
        {node.children.map((child) => (
          <FolderTreeItem
            key={child.path}
            node={child}
            selectedPath={selectedPath}
            expandedFolders={expandedFolders}
            sourceFor={sourceFor}
            updateAvailableFor={updateAvailableFor}
            onSelect={() => {}}
            onToggle={() => {}}
            onAcceptUpdate={onAcceptUpdate}
            onDelete={onDelete}
            nodes={[]}
            onOpenSkillsMenu={onOpenSkillsMenu}
          />
        ))}
        {node.synthetic && node.children.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            Route specialist folders from AGENTS.md.
          </div>
        ) : node.children.length === 0 ? (
          <div className="px-2 py-1 text-xs italic text-muted-foreground">
            Empty folder
          </div>
        ) : null}
      </FileTreeFolder>
    );
  }

  // File row. Only renders custom children (including FileTreeActions) when
  // the file shows an inherited-template Review affordance; otherwise we let
  // the AI Elements primitive render the default file row.
  const updateAvailable = updateAvailableFor(node.path);

  if (!updateAvailable) {
    return <FileTreeFile path={node.path} name={node.name} />;
  }

  return (
    <FileTreeFile path={node.path} name={node.name}>
      <span className="size-4 shrink-0" />
      <FileGlyph />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
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

function FileGlyph() {
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
