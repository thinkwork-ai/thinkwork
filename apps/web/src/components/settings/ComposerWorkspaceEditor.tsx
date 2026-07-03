/**
 * Composer workspace editor (Composer plan U2; v1.1 feedback items 1, 3, 4).
 *
 * v1.1 turns the Composer's result pane into a NORMAL editor shell — the same
 * anchored full-height left-tree + CodeMirror layout as Settings → Workspace —
 * instead of the old disclosure list with a small bottom viewer. The TREE is
 * drawn from the read-only `createComposerPreviewClient` adapter over
 * `workspacePreview` (`listFiles` via `getManifest`).
 *
 * The editor pane is LIVE (v1.1 live-save). EVERY file — generated or not —
 * opens as ONE full-width editor on its producing SOURCE file, edited in place
 * and saved through the owning layer's existing workspace-files client (resolved
 * from the node's owner + path), then refetches the preview so the tree stays
 * truthful. Operator-gated. A GENERATED file (AGENTS.md, CONTEXT.md,
 * `generated:true`) additionally carries the `generated` header badge and the
 * shared computed-sections banner + locked managed regions, so recomposed
 * bodies are marked and edits inside them warn on save. Files with no editable
 * owning layer (thread-scoped) fall back to the read-only rendered preview.
 * The preview adapter itself is read-only (its `putFile` rejects) — edits ride
 * the source client, never the derived preview.
 *
 * Three things layer on top of the plain shell:
 *
 *   - decoration (item 3): skill-folder nodes carry their capability state from
 *     the inspector — active folders render normally, gated folders (trust_gate
 *     etc.) render dimmed with a small badge whose reason string is verbatim.
 *     Clicking the badge opens the capability Side Sheet at that row with the
 *     State filter cleared;
 *   - jump-to-cause (item 2): non-skill nodes resolve to their owning surface —
 *     skill folders focus the capability row in the Side Sheet in-page; Spaces /
 *     User / generated agent files navigate to the owning editor;
 *   - direct manipulation (item 4): right-clicking a `skills/<slug>/` folder
 *     offers "Detach skill…"; right-clicking the `skills/` folder offers
 *     "Add skill…". Both route through the host's existing grant/detach +
 *     confirm + sync-pending machinery — the context menu is a second client of
 *     those actions, not a new write path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useClient } from "urql";
import {
  ChevronRight,
  ClipboardPaste,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Pencil,
  Plus,
  Scissors,
  SlidersHorizontal,
  Trash2,
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
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Skeleton,
  cn,
} from "@thinkwork/ui";
import { toast } from "sonner";
import {
  DEFAULT_MANAGED_SECTION_HEADINGS,
  FileEditorPane,
  editTouchesManagedSection,
} from "@thinkwork/workspace-editor";
import {
  createComposerPreviewClient,
  type ComposerPreviewEntry,
  type ComposerPreviewFilePayload,
  type ComposerPreviewManifest,
} from "@/lib/composer-preview-client";
import {
  spacesWorkspaceFilesClient,
  type WorkspaceFilesTarget,
} from "@/lib/workspace-files-api";
import { useTenant } from "@/context/TenantContext";

/** Per-skill capability state (from the inspector) used to decorate folders. */
export interface SkillNodeState {
  active: boolean;
  reason: string | null;
}

export interface ComposerWorkspaceEditorProps {
  tenantId: string;
  /** Selection tokens (the QUERY dimensions — no profile, R4). */
  spaceId: string | null;
  perspectiveUserId: string | null;
  /**
   * Bumped by the host after each mutation confirmation resolves (including
   * sync-pending completion) — triggers a network-only manifest refetch.
   */
  refreshToken?: number;
  /**
   * Skill slug inside the post-attach sync-pending window: its folder node
   * renders as a ghost with a "syncing…" badge until the refetch lands.
   */
  pendingSkillSlug?: string | null;
  /**
   * Skill slug whose detach is in flight: its folder renders dimmed with a
   * "removing…" badge until the manifest refetch drops it.
   */
  removingSkillSlug?: string | null;
  /**
   * In-page jump-to-cause for skill nodes: the host focuses the skill's row in
   * the capability Side Sheet (opening it, resetting State/Search, switching
   * tabs).
   */
  onFocusCapabilityRow?: (
    capabilityClass: string,
    capabilityId: string,
  ) => void;
  /** Capability state per installed skill slug for tree decoration (item 3). */
  skillStateBySlug?: Map<string, SkillNodeState>;
  /** Whether skill attach/detach is offered on this selection (write scope). */
  canManageSkills?: boolean;
  /** Open the Add-skill picker (context menu on the `skills/` folder). */
  onAddSkill?: () => void;
  /** Open the destructive detach confirm for a `skills/<slug>/` folder. */
  onDetachSkill?: (slug: string) => void;
  /**
   * MCP mirror of the skill affordances (Composer plan U9c): `mcp/<slug>/`
   * folders carry capability state from the inspector's mcp_server rows, the
   * `mcp/` root offers "Add MCP server…", and `mcp/<slug>/` offers
   * "Detach MCP server…" — the same picker/confirm/sync machinery, second class.
   */
  mcpStateBySlug?: Map<string, SkillNodeState>;
  /** MCP-server slug inside the post-attach sync-pending window (ghost node). */
  pendingMcpSlug?: string | null;
  /** MCP-server slug whose detach is in flight ("removing…" affordance). */
  removingMcpSlug?: string | null;
  /** Open the Add-MCP-server picker (context menu on the `mcp/` folder). */
  onAddMcpServer?: () => void;
  /** Open the destructive detach confirm for an `mcp/<slug>/` folder. */
  onDetachMcpServer?: (slug: string) => void;
  /**
   * Profile treatment for `agents/<slug>.md` files (Agent page merge U2):
   * "Configure Agent Profile" opens the Profiles sheet at that profile's
   * detail, replacing the generic agent-source navigation for these files.
   */
  onConfigureAgentProfile?: (slug: string) => void;
  /**
   * Selected profile's display name (Agent page merge U6): when set,
   * attach/detach menu labels carry the profile scope so a profile-scoped
   * write never masquerades as an agent-level one.
   */
  profileScopeName?: string | null;
  /**
   * Select this file once the manifest loads (Agent page merge U7): carries
   * the legacy `?view=workspace&file=…` deep links into a tree selection.
   */
  initialSelectedPath?: string | null;
}

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
  entry?: ComposerPreviewEntry;
}

/** Builds a nested tree from the flat rendered-workspace path list. */
export function buildPreviewTree(entries: ComposerPreviewEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of sorted) {
    const parts = entry.path.split("/").filter(Boolean);
    let current = root;
    for (let index = 0; index < parts.length; index++) {
      const name = parts[index];
      const isLast = index === parts.length - 1;
      const pathSoFar = parts.slice(0, index + 1).join("/");
      let node = current.find((candidate) => candidate.name === name);
      if (!node) {
        node = { name, path: pathSoFar, isFolder: !isLast, children: [] };
        current.push(node);
      }
      if (isLast) {
        node.entry = entry;
      } else {
        node.isFolder = true;
        current = node.children;
      }
    }
  }
  const orderLevel = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.isFolder === b.isFolder
        ? a.name.localeCompare(b.name)
        : a.isFolder
          ? -1
          : 1,
    );
    for (const node of nodes) orderLevel(node.children);
  };
  orderLevel(root);
  return root;
}

/**
 * Jump-to-cause resolution (KTD-5), derived purely from the manifest entry.
 * `null` = no owning surface to link (e.g. thread-scoped files).
 */
export type JumpCause =
  | { kind: "skill"; slug: string }
  | { kind: "space"; file: string | null }
  | { kind: "user" }
  | { kind: "agent_source"; file: string }
  | null;

export function causeOf(entry: ComposerPreviewEntry): JumpCause {
  const segments = entry.path.split("/");
  if (segments[0] === "skills" && segments.length > 1) {
    return { kind: "skill", slug: segments[1] };
  }
  if (entry.owner === "space" || segments[0] === "Spaces") {
    const file =
      segments[0] === "Spaces" && segments.length > 2
        ? segments.slice(2).join("/")
        : null;
    return { kind: "space", file };
  }
  if (
    entry.owner === "user" ||
    segments[0] === "User" ||
    segments[0] === "Users"
  ) {
    return { kind: "user" };
  }
  if (entry.owner === "agent") {
    return { kind: "agent_source", file: entry.path };
  }
  return null;
}

export interface SourcePaneResolution {
  target: WorkspaceFilesTarget;
  targetKey: string;
  sourceFile: string;
  layer: "agent" | "space" | "user";
}

/**
 * Resolve the editable SOURCE behind a preview node (v1.1 live-save): the owning
 * layer's write target + the path relative to that layer's tree. Works for both
 * generated files (whose editable source is the producing template — used by the
 * U7 split) and plain source files (agent/space/user-owned — edited in place).
 * Returns null when the node has no editable owning layer (thread files) or the
 * owning id isn't resolvable.
 */
export function resolveSource(
  entry: ComposerPreviewEntry | null,
  result: {
    agentId?: string | null;
    spaceId?: string | null;
    perspectiveUserId?: string | null;
  } | null,
  fallbackSpaceId: string | null,
): SourcePaneResolution | null {
  if (!entry) return null;
  const segments = entry.path.split("/");
  const isSpace = entry.owner === "space" || segments[0] === "Spaces";
  const isUser =
    entry.owner === "user" || segments[0] === "User" || segments[0] === "Users";
  if (isSpace) {
    const spaceId = result?.spaceId ?? fallbackSpaceId;
    const sourceFile =
      segments[0] === "Spaces" && segments.length > 2
        ? segments.slice(2).join("/")
        : entry.path;
    if (!spaceId || !sourceFile) return null;
    return {
      target: { spaceId },
      targetKey: `composer-space:${spaceId}`,
      sourceFile,
      layer: "space",
    };
  }
  if (isUser) {
    const userId = result?.perspectiveUserId ?? null;
    const sourceFile =
      (segments[0] === "User" || segments[0] === "Users") && segments.length > 1
        ? segments.slice(1).join("/")
        : entry.path;
    if (!userId || !sourceFile) return null;
    return {
      target: { userId },
      targetKey: `composer-user:${userId}`,
      sourceFile,
      layer: "user",
    };
  }
  // Agent-owned (AGENTS.md, skills/**, memory/**, CAPABILITIES.md, …).
  if (entry.owner === "agent" || segments[0] === "skills") {
    const agentId = result?.agentId;
    if (!agentId) return null;
    return {
      target: { agentId },
      targetKey: `composer-agent:${agentId}`,
      sourceFile: entry.path,
      layer: "agent",
    };
  }
  return null;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Display-only lowercase aliases for the capitalized mount roots so they sit
 * with the other lowercase roots (skills). The real runtime mount paths
 * (`Spaces/`, `User/`, `Users/`) are unchanged — this is purely the tree label.
 */
const MOUNT_DISPLAY_ALIAS: Record<string, string> = {
  Spaces: "spaces",
  User: "user",
  Users: "users",
};

/** Skill slug for a `skills/<slug>` folder node, else null. */
function skillSlugForFolder(node: TreeNode): string | null {
  if (!node.isFolder) return null;
  const match = /^skills\/([^/]+)$/.exec(node.path);
  return match ? match[1] : null;
}

/** MCP-server slug for an `mcp/<slug>` folder node, else null (U9c). */
function mcpSlugForFolder(node: TreeNode): string | null {
  if (!node.isFolder) return null;
  const match = /^mcp\/([^/]+)$/.exec(node.path);
  return match ? match[1] : null;
}

/** Agent Profile slug for an `agents/<slug>.md` file node, else null (U2). */
function agentProfileSlugForFile(node: TreeNode): string | null {
  if (node.isFolder) return null;
  const match = /^agents\/([^/]+)\.md$/.exec(node.path);
  return match ? match[1] : null;
}

interface PathSource {
  target: WorkspaceFilesTarget;
  /** Path relative to the owning layer's tree (mount prefix stripped). */
  rel: string;
  layer: "agent" | "space" | "user";
}

/**
 * Owner→client resolution for standard file-tree ops (v1.1 standard menu),
 * path-based so it works for folders as well as files — the same owning-layer
 * routing the live-save editor uses. Returns null when the owning id isn't
 * resolvable.
 */
export function resolvePathSource(
  path: string,
  ids: {
    agentId?: string | null;
    spaceId?: string | null;
    perspectiveUserId?: string | null;
  } | null,
): PathSource | null {
  const seg = path.split("/");
  if (seg[0] === "Spaces") {
    const spaceId = ids?.spaceId;
    if (!spaceId) return null;
    return { target: { spaceId }, rel: seg.slice(2).join("/"), layer: "space" };
  }
  if (seg[0] === "User" || seg[0] === "Users") {
    const userId = ids?.perspectiveUserId;
    if (!userId) return null;
    return { target: { userId }, rel: seg.slice(1).join("/"), layer: "user" };
  }
  const agentId = ids?.agentId;
  if (!agentId) return null;
  return { target: { agentId }, rel: path, layer: "agent" };
}

function parentPathOf(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function basenamePathOf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

const INVALID_BASENAME = /[/\\]/;

interface NameDialogState {
  mode: "new-file" | "new-folder" | "rename";
  /** Parent folder path for create; the target path for rename. */
  anchorPath: string;
  value: string;
  busy?: boolean;
  error?: string | null;
}

interface DeleteConfirmState {
  path: string;
  isFolder: boolean;
}

interface ManifestState {
  loading: boolean;
  error: string | null;
  data: ComposerPreviewManifest | null;
}

interface FileState {
  loading: boolean;
  error: string | null;
  data: ComposerPreviewFilePayload | null;
}

export function ComposerWorkspaceEditor({
  tenantId,
  spaceId,
  perspectiveUserId,
  refreshToken = 0,
  pendingSkillSlug = null,
  removingSkillSlug = null,
  onFocusCapabilityRow,
  skillStateBySlug,
  canManageSkills = false,
  onAddSkill,
  onDetachSkill,
  mcpStateBySlug,
  pendingMcpSlug = null,
  removingMcpSlug = null,
  onAddMcpServer,
  onDetachMcpServer,
  onConfigureAgentProfile,
  profileScopeName = null,
  initialSelectedPath = null,
}: ComposerWorkspaceEditorProps) {
  const navigate = useNavigate();
  const { isOperator, roleResolved } = useTenant();
  const canEditSource = isOperator && roleResolved;
  const urqlClient = useClient();
  // Keep the urql client in a ref so the adapter identity is stable across
  // renders (the app's client is stable, but urql's `useClient` isn't
  // contractually referentially stable) — otherwise the manifest-load effect
  // would re-fire on every render and loop.
  const urqlClientRef = useRef(urqlClient);
  urqlClientRef.current = urqlClient;
  const client = useMemo(
    () =>
      createComposerPreviewClient(
        {
          query: (doc, variables, context) =>
            urqlClientRef.current.query(
              doc as Parameters<typeof urqlClient.query>[0],
              variables,
              context as Parameters<typeof urqlClient.query>[2],
            ),
        },
        { tenantId, spaceId, perspectiveUserId },
      ),
    [tenantId, spaceId, perspectiveUserId],
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const appliedInitialPath = useRef(false);
  const [manifest, setManifest] = useState<ManifestState>({
    loading: true,
    error: null,
    data: null,
  });
  const [file, setFile] = useState<FileState>({
    loading: false,
    error: null,
    data: null,
  });
  // Standard file-tree menu (v1.1): create/rename dialog, delete confirm, and a
  // single cut clipboard. All ops write through the owning source layer.
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(
    null,
  );
  const [clipboardPath, setClipboardPath] = useState<string | null>(null);

  // Manifest load: on selection change (client identity) and on each
  // refreshToken bump. A request id guards against out-of-order resolutions.
  const manifestReq = useRef(0);
  const loadManifest = useCallback(async () => {
    const reqId = ++manifestReq.current;
    setManifest((current) => ({ ...current, loading: true }));
    try {
      const data = await client.getManifest();
      if (manifestReq.current !== reqId) return;
      setManifest({ loading: false, error: null, data });
    } catch (err) {
      if (manifestReq.current !== reqId) return;
      const message = err instanceof Error ? err.message : String(err);
      setManifest({ loading: false, error: message, data: null });
    }
  }, [client]);

  useEffect(() => {
    void loadManifest();
  }, [loadManifest]);

  const lastToken = useRef(refreshToken);
  useEffect(() => {
    if (refreshToken === lastToken.current) return;
    lastToken.current = refreshToken;
    void loadManifest();
  }, [refreshToken, loadManifest]);

  // File content load: on selected-path change and on refreshToken (the
  // rendered output may have changed after a source save / mutation).
  const fileReq = useRef(0);
  const loadFile = useCallback(
    async (path: string) => {
      const reqId = ++fileReq.current;
      setFile({ loading: true, error: null, data: null });
      try {
        const data = await client.getFilePayload(path);
        if (fileReq.current !== reqId) return;
        setFile({ loading: false, error: null, data });
      } catch (err) {
        if (fileReq.current !== reqId) return;
        const message = err instanceof Error ? err.message : String(err);
        setFile({ loading: false, error: message, data: null });
      }
    },
    [client],
  );

  const result = manifest.data;
  const entries = useMemo(() => result?.entries ?? [], [result?.entries]);

  // Apply the deep-linked tree selection once the manifest carries the file
  // (U7). One-shot: later selection changes belong to the user.
  useEffect(() => {
    if (appliedInitialPath.current || !initialSelectedPath) return;
    if (!entries.some((entry) => entry.path === initialSelectedPath)) return;
    appliedInitialPath.current = true;
    setSelectedPath(initialSelectedPath);
  }, [entries, initialSelectedPath]);
  const entryByPath = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry])),
    [entries],
  );

  const srcForPath = useCallback(
    (path: string) => resolvePathSource(path, result),
    [result],
  );

  // Standard-menu writes go through the owning source client, then refetch the
  // preview so the tree stays truthful (v1.1). Operator-gated by the caller.
  const submitNameDialog = useCallback(async () => {
    if (!nameDialog) return;
    const name = nameDialog.value.trim();
    if (!name || INVALID_BASENAME.test(name)) {
      setNameDialog({
        ...nameDialog,
        error: "Enter a valid name (no slashes).",
      });
      return;
    }
    setNameDialog({ ...nameDialog, busy: true, error: null });
    try {
      if (nameDialog.mode === "rename") {
        const path = nameDialog.anchorPath;
        const src = srcForPath(path);
        if (!src) throw new Error("This file has no editable source layer.");
        const parentRel = parentPathOf(src.rel);
        const toRel = parentRel ? `${parentRel}/${name}` : name;
        await spacesWorkspaceFilesClient.renamePath?.(
          src.target,
          src.rel,
          toRel,
        );
        const parentTree = parentPathOf(path);
        const toTree = parentTree ? `${parentTree}/${name}` : name;
        await loadManifest();
        if (selectedPath === path) setSelectedPath(toTree);
        else if (selectedPath?.startsWith(`${path}/`)) {
          setSelectedPath(selectedPath.replace(path, toTree));
        }
      } else {
        // Empty anchorPath = the AGENT workspace ROOT (owner=agent, rel "").
        const parent = nameDialog.anchorPath;
        const src = srcForPath(parent);
        if (!src) throw new Error("This folder has no editable source layer.");
        const childTree = parent ? `${parent}/${name}` : name;
        const childRel = src.rel ? `${src.rel}/${name}` : name;
        await spacesWorkspaceFilesClient.putFile(
          src.target,
          nameDialog.mode === "new-folder" ? `${childRel}/.gitkeep` : childRel,
          "",
        );
        await loadManifest();
        if (nameDialog.mode === "new-file") setSelectedPath(childTree);
        else
          setCollapsed((c) => new Set([...c].filter((p) => p !== childTree)));
      }
      setNameDialog(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn't complete: ${message}`);
      setNameDialog((current) =>
        current ? { ...current, busy: false, error: message } : current,
      );
    }
  }, [nameDialog, srcForPath, loadManifest, selectedPath]);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    const { path, isFolder } = deleteConfirm;
    setDeleteConfirm(null);
    try {
      const targets = isFolder
        ? entries
            .filter((e) => e.path === path || e.path.startsWith(`${path}/`))
            .map((e) => e.path)
        : [path];
      for (const t of targets) {
        const src = srcForPath(t);
        if (src)
          await spacesWorkspaceFilesClient.deleteFile(src.target, src.rel);
      }
      await loadManifest();
      if (
        selectedPath &&
        (selectedPath === path || selectedPath.startsWith(`${path}/`))
      ) {
        setSelectedPath(null);
      }
    } catch (err) {
      toast.error(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [deleteConfirm, entries, srcForPath, loadManifest, selectedPath]);

  const pasteInto = useCallback(
    async (folderPath: string) => {
      if (!clipboardPath) return;
      const from = srcForPath(clipboardPath);
      const to = srcForPath(folderPath);
      if (!from || !to) return;
      if (from.layer !== to.layer) {
        toast.error("Moving across layers isn't supported here.");
        return;
      }
      try {
        await spacesWorkspaceFilesClient.movePath?.(
          from.target,
          from.rel,
          to.rel,
        );
        await loadManifest();
        setClipboardPath(null);
      } catch (err) {
        toast.error(
          `Move failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [clipboardPath, srcForPath, loadManifest],
  );

  // Only the READ-ONLY rendered pane (generated files, or non-generated files
  // with no editable owning layer) needs the preview-file payload; editable
  // source files load from their owning client instead — skip the wasted fetch.
  useEffect(() => {
    if (!selectedPath) {
      setFile({ loading: false, error: null, data: null });
      return;
    }
    const entry = entryByPath.get(selectedPath) ?? null;
    // Only the fallback read-only rendered pane (files with no editable owning
    // layer) needs the preview-file payload; everything else edits its source.
    const usesRenderedPane = !resolveSource(entry, result, spaceId);
    if (!usesRenderedPane) {
      setFile({ loading: false, error: null, data: null });
      return;
    }
    void loadFile(selectedPath);
  }, [selectedPath, loadFile, refreshToken, entryByPath, result, spaceId]);

  // Post-attach sync ghosts: one per capability-folder class (skills + mcp).
  const pendingFolderPaths = useMemo(() => {
    const paths: string[] = [];
    if (pendingSkillSlug) paths.push(`skills/${pendingSkillSlug}`);
    if (pendingMcpSlug) paths.push(`mcp/${pendingMcpSlug}`);
    return paths;
  }, [pendingSkillSlug, pendingMcpSlug]);
  const tree = useMemo(() => {
    const nodes = buildPreviewTree(entries);
    for (const pendingPath of pendingFolderPaths) {
      if (entries.some((entry) => entry.path.startsWith(`${pendingPath}/`))) {
        continue;
      }
      const rootName = pendingPath.split("/")[0];
      const rootFolder = nodes.find(
        (node) => node.path === rootName && node.isFolder,
      );
      const ghost: TreeNode = {
        name: pendingPath.split("/")[1],
        path: pendingPath,
        isFolder: true,
        children: [],
      };
      if (rootFolder) {
        rootFolder.children.unshift(ghost);
      } else {
        nodes.unshift({
          name: rootName,
          path: rootName,
          isFolder: true,
          children: [ghost],
        });
      }
    }
    return nodes;
  }, [entries, pendingFolderPaths]);

  // Default state is COLLAPSED at EVERY depth — every folder starts closed, only
  // root files are visible; expanding a folder reveals its immediate children
  // (also collapsed). Deliberate (keeps the tree scannable). Runs once per mount
  // so later expands stick and mutations don't re-collapse the operator's view.
  const didInitCollapse = useRef(false);
  useEffect(() => {
    if (didInitCollapse.current || entries.length === 0) return;
    didInitCollapse.current = true;
    const folders = new Set<string>();
    for (const entry of entries) {
      const parts = entry.path.split("/");
      for (let i = 0; i < parts.length - 1; i++) {
        folders.add(parts.slice(0, i + 1).join("/"));
      }
    }
    setCollapsed(folders);
  }, [entries]);

  function toggleFolder(path: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function jumpToCause(entry: ComposerPreviewEntry) {
    const cause = causeOf(entry);
    if (!cause) return;
    switch (cause.kind) {
      case "skill":
        onFocusCapabilityRow?.("skill", cause.slug);
        return;
      case "space": {
        const targetSpaceId = result?.spaceId ?? spaceId;
        if (!targetSpaceId) return;
        void navigate({
          to: "/settings/spaces/$spaceId",
          params: { spaceId: targetSpaceId },
          search: {
            view: "workspace",
            ...(cause.file ? { file: cause.file } : {}),
          },
        });
        return;
      }
      case "user": {
        const targetUserId = result?.perspectiveUserId ?? perspectiveUserId;
        if (!targetUserId) return;
        void navigate({
          to: "/settings/users/$userId",
          params: { userId: targetUserId },
        });
        return;
      }
      case "agent_source":
        // KTD-7 (U7): this page IS the agent surface — select in place.
        setSelectedPath(cause.file);
        return;
    }
  }

  function jumpEntryFor(node: TreeNode): ComposerPreviewEntry | null {
    if (node.entry) return node.entry;
    if (pendingFolderPaths.includes(node.path)) return null;
    let cursor: TreeNode | undefined = node;
    while (cursor && !cursor.entry) {
      cursor = cursor.children[0];
    }
    return cursor?.entry ?? null;
  }

  function renderNode(node: TreeNode, depth: number): React.ReactNode {
    const isCollapsed = collapsed.has(node.path);
    const isPending = pendingFolderPaths.includes(node.path);
    const skillSlug = skillSlugForFolder(node);
    const skillState = skillSlug ? skillStateBySlug?.get(skillSlug) : undefined;
    // MCP mirror (U9c): `mcp/<slug>/` folders carry the mcp_server row state.
    const mcpSlug = mcpSlugForFolder(node);
    const mcpState = mcpSlug ? mcpStateBySlug?.get(mcpSlug) : undefined;
    // One gate treatment for both capability-folder classes.
    const gateState = skillState ?? mcpState;
    const gateClass = skillSlug ? "skill" : "mcp_server";
    const gateId = skillSlug ?? mcpSlug;
    const isGated = Boolean(gateState && !gateState.active);
    const isRemoving = Boolean(
      (skillSlug && skillSlug === removingSkillSlug) ||
      (mcpSlug && mcpSlug === removingMcpSlug),
    );
    const jumpEntry = jumpEntryFor(node);
    const causeKind = jumpEntry ? (causeOf(jumpEntry)?.kind ?? null) : null;
    // Profile files get the dedicated Configure treatment (U2); the generic
    // "Open agent source" item is suppressed for them by contract (R5).
    const profileSlug = agentProfileSlugForFile(node);
    const canConfigureProfile = Boolean(
      profileSlug && onConfigureAgentProfile,
    );
    // "Open …source" navigation is offered ONLY for nodes that open a real
    // owning editor — Spaces file → space editor, User file → user detail,
    // generated agent file → agent workspace editor. Skill nodes get NO menu
    // entry pointing at the capability sheet (the gate-badge click still does);
    // tree-first interactions win.
    const canOpenSource =
      !canConfigureProfile &&
      Boolean(jumpEntry) &&
      (causeKind === "space" || causeKind === "agent_source"
        ? true
        : causeKind === "user"
          ? Boolean(result?.perspectiveUserId ?? perspectiveUserId)
          : false);
    const openSourceLabel =
      causeKind === "space"
        ? "Open space source"
        : causeKind === "user"
          ? "Open user source"
          : "Open agent source";
    const isSkillsRoot = node.isFolder && node.path === "skills";
    const isMcpRoot = node.isFolder && node.path === "mcp";
    const canDetachThis = Boolean(
      skillSlug && canManageSkills && onDetachSkill && !isRemoving,
    );
    const canAddHere = Boolean(isSkillsRoot && canManageSkills && onAddSkill);
    // MCP mirror (U9c): same write-scope gating, second class.
    const canDetachMcp = Boolean(
      mcpSlug && canManageSkills && onDetachMcpServer && !isRemoving,
    );
    const canAddMcpHere = Boolean(
      isMcpRoot && canManageSkills && onAddMcpServer,
    );

    // Standard file-tree ops (v1.1), routed through the owning SOURCE layer.
    // Generated files, the `skills`/`mcp`/`Spaces` containers, and source roots
    // are derived / structural — no destructive ops there.
    const src = srcForPath(node.path);
    const isSpacesContainer = node.path === "Spaces";
    const isSourceRoot = Boolean(src) && src!.rel === "";
    const stdEligible = Boolean(
      canEditSource && src && !isSpacesContainer && !isSkillsRoot && !isMcpRoot,
    );
    const canNewInside = stdEligible; // create inside any editable folder (incl. skill folder)
    // Capability folders (skills/<slug>, mcp/<slug>) map their destructive
    // action to Detach — never raw Rename/Delete that would bypass the
    // unified mutation.
    const canRename = Boolean(
      stdEligible && !node.isFolder
        ? !node.entry?.generated
        : stdEligible &&
            node.isFolder &&
            !skillSlug &&
            !mcpSlug &&
            !isSourceRoot,
    );
    const canDelete = canRename;
    const canCut = canRename;
    const canPaste = Boolean(
      node.isFolder &&
      stdEligible &&
      clipboardPath &&
      srcForPath(clipboardPath)?.layer === src?.layer,
    );
    const hasStdOps =
      (node.isFolder && canNewInside) || canRename || canDelete || canPaste;

    const hasMenu =
      canDetachThis ||
      canAddHere ||
      canDetachMcp ||
      canAddMcpHere ||
      canConfigureProfile ||
      hasStdOps ||
      canOpenSource;

    const row = (
      <div
        className={cn(
          "group flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5",
          (isPending || isGated || isRemoving) && "opacity-60",
          !node.isFolder &&
            selectedPath === node.path &&
            "bg-muted text-foreground",
        )}
        style={{ paddingLeft: `${depth * 0.875 + 0.25}rem` }}
        data-testid={`tree-node-${node.path}`}
        // Nested Radix ContextMenus: a node with its own menu stops the
        // contextmenu event here so it doesn't ALSO open the root (tree-
        // background) menu. Menu-less rows let it bubble to the root menu.
        onContextMenu={hasMenu ? (event) => event.stopPropagation() : undefined}
      >
        {node.isFolder ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => toggleFolder(node.path)}
            aria-expanded={!isCollapsed}
            data-testid={`tree-toggle-${node.path}`}
          >
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                !isCollapsed && "rotate-90",
              )}
            />
            {isCollapsed ? (
              <Folder className="size-3.5 shrink-0" />
            ) : (
              <FolderOpen
                className="size-3.5 shrink-0"
                data-testid={`tree-folder-open-${node.path}`}
              />
            )}
            {/* Display alias only: the capitalized mount roots (`Spaces/`,
                `User/`, `Users/`) render lowercase to sit with the other
                lowercase roots. The real runtime mount paths are unchanged
                everywhere — do NOT "fix" these into actual renames. */}
            <span className="truncate">
              {MOUNT_DISPLAY_ALIAS[node.path] ?? node.name}
            </span>
          </button>
        ) : (
          <button
            type="button"
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm transition-colors hover:text-foreground",
              selectedPath === node.path
                ? "text-foreground"
                : "text-muted-foreground",
            )}
            onClick={() => setSelectedPath(node.path)}
            data-testid={`tree-file-${node.path}`}
          >
            <FileText className="ml-[1.125rem] size-3.5 shrink-0" />
            <span className="truncate">{node.name}</span>
          </button>
        )}
        {node.entry?.generated ? (
          <Badge
            variant="outline"
            className="shrink-0 px-1.5 py-0 text-[10px] text-muted-foreground"
            data-testid={`tree-generated-${node.path}`}
          >
            generated
          </Badge>
        ) : null}
        {isGated && gateState?.reason ? (
          <button
            type="button"
            onClick={() => gateId && onFocusCapabilityRow?.(gateClass, gateId)}
            data-testid={`tree-gate-${node.path}`}
            title="Open this capability in the list"
          >
            {/* Reason renders verbatim from the backend taxonomy (R6). */}
            <Badge
              variant="outline"
              className="shrink-0 cursor-pointer border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
            >
              {gateState.reason}
            </Badge>
          </button>
        ) : null}
        {isPending ? (
          <Badge
            variant="outline"
            className="shrink-0 border-sky-500/40 bg-sky-500/10 px-1.5 py-0 text-[10px] text-sky-700 dark:text-sky-400"
            data-testid={`tree-pending-${node.path}`}
          >
            syncing…
          </Badge>
        ) : null}
        {isRemoving ? (
          <Badge
            variant="outline"
            className="shrink-0 border-sky-500/40 bg-sky-500/10 px-1.5 py-0 text-[10px] text-sky-700 dark:text-sky-400"
            data-testid={`tree-removing-${node.path}`}
          >
            removing…
          </Badge>
        ) : null}
      </div>
    );

    const wrappedRow = hasMenu ? (
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent data-testid={`tree-menu-${node.path}`}>
          {canConfigureProfile ? (
            <ContextMenuItem
              onSelect={() =>
                profileSlug && onConfigureAgentProfile?.(profileSlug)
              }
              data-testid={`menu-configure-profile-${profileSlug}`}
            >
              <SlidersHorizontal className="mr-2 size-4" /> Configure Agent
              Profile
            </ContextMenuItem>
          ) : null}
          {canAddHere ? (
            <ContextMenuItem
              onSelect={() => onAddSkill?.()}
              data-testid="menu-add-skill"
            >
              <Plus className="mr-2 size-4" />{" "}
              {profileScopeName
                ? `Add skill for ${profileScopeName}…`
                : "Add skill…"}
            </ContextMenuItem>
          ) : null}
          {canDetachThis ? (
            <ContextMenuItem
              variant="destructive"
              onSelect={() => skillSlug && onDetachSkill?.(skillSlug)}
              data-testid={`menu-detach-skill-${skillSlug}`}
            >
              <Trash2 className="mr-2 size-4" />{" "}
              {profileScopeName
                ? `Detach skill for ${profileScopeName}…`
                : "Detach skill…"}
            </ContextMenuItem>
          ) : null}
          {canAddMcpHere ? (
            <ContextMenuItem
              onSelect={() => onAddMcpServer?.()}
              data-testid="menu-add-mcp-server"
            >
              <Plus className="mr-2 size-4" />{" "}
              {profileScopeName
                ? `Add MCP server for ${profileScopeName}…`
                : "Add MCP server…"}
            </ContextMenuItem>
          ) : null}
          {canDetachMcp ? (
            <ContextMenuItem
              variant="destructive"
              onSelect={() => mcpSlug && onDetachMcpServer?.(mcpSlug)}
              data-testid={`menu-detach-mcp-${mcpSlug}`}
            >
              <Trash2 className="mr-2 size-4" />{" "}
              {profileScopeName
                ? `Detach MCP server for ${profileScopeName}…`
                : "Detach MCP server…"}
            </ContextMenuItem>
          ) : null}
          {(canAddHere || canDetachThis || canAddMcpHere || canDetachMcp) &&
          hasStdOps ? (
            <ContextMenuSeparator />
          ) : null}
          {node.isFolder && canNewInside ? (
            <ContextMenuItem
              onSelect={() =>
                setNameDialog({
                  mode: "new-file",
                  anchorPath: node.path,
                  value: "",
                })
              }
              data-testid={`menu-new-file-${node.path}`}
            >
              <FilePlus className="mr-2 size-4" /> New File
            </ContextMenuItem>
          ) : null}
          {node.isFolder && canNewInside ? (
            <ContextMenuItem
              onSelect={() =>
                setNameDialog({
                  mode: "new-folder",
                  anchorPath: node.path,
                  value: "",
                })
              }
              data-testid={`menu-new-folder-${node.path}`}
            >
              <FolderPlus className="mr-2 size-4" /> New Folder
            </ContextMenuItem>
          ) : null}
          {canRename ? (
            <ContextMenuItem
              onSelect={() =>
                setNameDialog({
                  mode: "rename",
                  anchorPath: node.path,
                  value: basenamePathOf(node.path),
                })
              }
              data-testid={`menu-rename-${node.path}`}
            >
              <Pencil className="mr-2 size-4" /> Rename
            </ContextMenuItem>
          ) : null}
          {canCut ? (
            <ContextMenuItem
              onSelect={() => setClipboardPath(node.path)}
              data-testid={`menu-cut-${node.path}`}
            >
              <Scissors className="mr-2 size-4" /> Cut
            </ContextMenuItem>
          ) : null}
          {canPaste ? (
            <ContextMenuItem
              onSelect={() => void pasteInto(node.path)}
              data-testid={`menu-paste-${node.path}`}
            >
              <ClipboardPaste className="mr-2 size-4" /> Paste
            </ContextMenuItem>
          ) : null}
          {canDelete ? (
            <ContextMenuItem
              variant="destructive"
              onSelect={() =>
                setDeleteConfirm({ path: node.path, isFolder: node.isFolder })
              }
              data-testid={`menu-delete-${node.path}`}
            >
              <Trash2 className="mr-2 size-4" /> Delete
            </ContextMenuItem>
          ) : null}
          {(canAddHere ||
            canDetachThis ||
            canAddMcpHere ||
            canDetachMcp ||
            hasStdOps) &&
          canOpenSource ? (
            <ContextMenuSeparator />
          ) : null}
          {canOpenSource && jumpEntry ? (
            <ContextMenuItem
              onSelect={() => jumpToCause(jumpEntry)}
              data-testid={`menu-open-source-${node.path}`}
            >
              {openSourceLabel}
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    ) : (
      row
    );

    return (
      <div key={node.path}>
        {wrappedRow}
        {node.isFolder && !isCollapsed
          ? node.children.map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    );
  }

  const selectedEntry = selectedPath
    ? (entryByPath.get(selectedPath) ?? null)
    : null;

  // Root-level create targets the AGENT workspace root (owner=agent, rel "").
  const canEditRoot = canEditSource && Boolean(result?.agentId);

  const treeBody = (
    <div
      className="min-h-0 flex-1 overflow-y-auto p-2"
      data-testid="composer-tree-scroll"
    >
      {manifest.loading && !result ? (
        <div className="space-y-2" data-testid="preview-loading">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-4/5" />
        </div>
      ) : manifest.error ? (
        <p className="text-sm text-destructive" data-testid="preview-error">
          Couldn&apos;t load the rendered workspace: {manifest.error}
        </p>
      ) : result?.state === "invalid_selection" ? (
        <p
          className="text-sm text-destructive"
          data-testid="preview-invalid-selection"
        >
          Invalid selection: {result.stateDetail}
        </p>
      ) : result?.state === "resolution_fault" ? (
        <p
          className="text-sm text-destructive"
          data-testid="preview-resolution-fault"
        >
          Resolution fault — this selection could not be composed:{" "}
          {result.stateDetail}
        </p>
      ) : result && tree.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">
          Nothing rendered for the current selection.
        </p>
      ) : result ? (
        tree.map((node) => renderNode(node, 0))
      ) : null}
    </div>
  );

  const treePanel = (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/50 px-3 text-xs font-medium text-muted-foreground">
        <FolderTree className="size-3.5" />
        <span data-testid="composer-files-header">
          {entries.length} {entries.length === 1 ? "file" : "files"}
        </span>
        {result?.noUserBaseline ? (
          <Badge
            variant="outline"
            className="ml-auto px-1.5 py-0 text-[10px] text-muted-foreground"
          >
            no-user baseline
          </Badge>
        ) : null}
      </div>
      {canEditRoot ? (
        // Right-click the blank tree background to create at the workspace ROOT.
        <ContextMenu>
          <ContextMenuTrigger asChild>{treeBody}</ContextMenuTrigger>
          <ContextMenuContent data-testid="tree-root-menu">
            <ContextMenuItem
              onSelect={() =>
                setNameDialog({ mode: "new-file", anchorPath: "", value: "" })
              }
              data-testid="menu-root-new-file"
            >
              <FilePlus className="mr-2 size-4" /> New File…
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                setNameDialog({ mode: "new-folder", anchorPath: "", value: "" })
              }
              data-testid="menu-root-new-folder"
            >
              <FolderPlus className="mr-2 size-4" /> New Folder…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        treeBody
      )}
    </div>
  );

  return (
    <div
      className="flex h-full w-full min-h-0 overflow-hidden rounded-md border"
      data-testid="composer-editor"
    >
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          defaultSize="26%"
          minSize="18%"
          className="flex min-h-0 flex-col border-r"
        >
          {treePanel}
        </ResizablePanel>
        {/* Thin draggable divider (col-resize) — no visible grip handle. */}
        <ResizableHandle />
        <ResizablePanel className="flex min-h-0 min-w-0 flex-col">
          {selectedPath ? (
            (() => {
              const source = resolveSource(selectedEntry, result, spaceId);
              // Every file — generated or not — opens as ONE full-width editor on
              // its producing SOURCE file. Generated files (AGENTS.md, CONTEXT.md)
              // carry the generated badge + the computed-sections banner + locked
              // managed regions (from the shared FileEditorPane); their prose edits
              // save the source and refetch the preview. Operator-gated.
              if (source) {
                return (
                  <ComposerEditablePane
                    key={`${source.targetKey}:${source.sourceFile}`}
                    source={source}
                    entry={selectedEntry}
                    readOnly={!canEditSource}
                    onClose={() => setSelectedPath(null)}
                    onSaved={() => void loadManifest()}
                  />
                );
              }
              // No editable owning layer (thread files, unresolved ids) → the
              // read-only rendered preview.
              return (
                <ComposerRenderedPane
                  path={selectedPath}
                  entry={selectedEntry}
                  file={file}
                  onClose={() => setSelectedPath(null)}
                />
              );
            })()
          ) : (
            <div
              className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground"
              data-testid="composer-empty-pane"
            >
              Select a file to preview its rendered output.
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Standard-menu create/rename dialog (v1.1). */}
      <Dialog
        open={nameDialog !== null}
        onOpenChange={(open) => !open && setNameDialog(null)}
      >
        <DialogContent data-testid="composer-name-dialog">
          <DialogHeader>
            <DialogTitle>
              {nameDialog?.mode === "rename"
                ? "Rename"
                : nameDialog?.mode === "new-folder"
                  ? "New folder"
                  : "New file"}
            </DialogTitle>
            <DialogDescription>
              {nameDialog?.mode === "rename"
                ? "Renames the source file/folder in its owning layer."
                : "Creates it in the owning source layer; the rendered tree refreshes after."}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label="Name"
            data-testid="composer-name-input"
            value={nameDialog?.value ?? ""}
            disabled={nameDialog?.busy}
            onChange={(event) =>
              setNameDialog((current) =>
                current
                  ? { ...current, value: event.target.value, error: null }
                  : current,
              )
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitNameDialog();
              }
            }}
          />
          {nameDialog?.error ? (
            <p className="text-xs text-destructive">{nameDialog.error}</p>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={nameDialog?.busy}
              onClick={() => setNameDialog(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={nameDialog?.busy}
              data-testid="composer-name-submit"
              onClick={() => void submitNameDialog()}
            >
              {nameDialog?.mode === "rename" ? "Rename" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Standard-menu delete confirm (v1.1). */}
      <AlertDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteConfirm?.isFolder ? "folder" : "file"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm
                ? `This removes ${deleteConfirm.path}${
                    deleteConfirm.isFolder ? " and everything inside it" : ""
                  } from its source layer.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="composer-delete-confirm"
              onClick={() => void confirmDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Read-only RENDERED pane of the Composer editor. Uses the shared CodeMirror
 * `FileEditorPane` (line numbers, syntax) in `readOnly` mode — never a save
 * path — so the derived rendered workspace reads exactly like the real editor
 * without ever pretending to be editable (R2).
 */
export function ComposerRenderedPane({
  path,
  entry,
  file,
  onClose,
}: {
  path: string;
  entry: ComposerPreviewEntry | null;
  file: FileState;
  onClose: () => void;
}) {
  const payload = file.data;
  const failed =
    file.error !== null || (payload !== null && payload.state !== "ok");
  const errorText = file.error
    ? file.error
    : payload && payload.state !== "ok"
      ? payload.state === "not_found"
        ? `This file is no longer part of the rendered workspace${
            payload.stateDetail ? `: ${payload.stateDetail}` : ""
          }`
        : payload.state === "invalid_selection"
          ? `Invalid selection${payload.stateDetail ? `: ${payload.stateDetail}` : ""}`
          : `Resolution fault — this selection could not be composed${
              payload.stateDetail ? `: ${payload.stateDetail}` : ""
            }`
      : null;

  const headerBadges = (
    <>
      {entry?.generated ? (
        <Badge
          variant="outline"
          className="shrink-0 px-1.5 py-0 text-[10px] text-muted-foreground"
        >
          generated
        </Badge>
      ) : null}
      <Badge
        variant="outline"
        className="shrink-0 px-1.5 py-0 text-[10px] text-muted-foreground"
      >
        read-only
      </Badge>
      {typeof entry?.size === "number" ? (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatBytes(entry.size)}
        </span>
      ) : null}
    </>
  );
  const closeAction = (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-[11px] text-muted-foreground"
      data-testid="composer-file-close"
      onClick={onClose}
    >
      Close
    </Button>
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="composer-file-viewer"
    >
      {failed ? (
        <>
          {/* Error state keeps a minimal header so Close isn't lost. */}
          <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/50 px-3">
            <span className="min-w-0 truncate font-mono text-xs text-foreground">
              {path}
            </span>
            {headerBadges}
            <div className="ml-auto">{closeAction}</div>
          </div>
          <p
            className="p-3 text-xs text-destructive"
            data-testid="composer-file-error"
          >
            {errorText}
          </p>
        </>
      ) : (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <FileEditorPane
            openFile={path}
            content={payload?.content ?? ""}
            value={payload?.content ?? ""}
            loading={file.loading}
            saving={false}
            readOnly
            managedHeadings={[]}
            headerBadges={headerBadges}
            headerActions={closeAction}
            onChange={() => {}}
            onSave={() => {}}
            onDiscard={() => {}}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Live-editable pane for a non-generated SOURCE file (v1.1). Loads and saves
 * the underlying source through the existing workspace-files client resolved
 * from the node's owner + path — exactly the write path the U7 split source
 * pane uses — so editing a `skills/**`, `memory/**`, Space, or User file here
 * writes the real source, then refetches the preview so the tree stays
 * truthful. Reuses the shared `FileEditorPane` (house font/theme, line numbers,
 * managed-section locked regions + warn-on-save). Read-only for non-operators.
 */
export function ComposerEditablePane({
  source,
  entry,
  readOnly,
  onClose,
  onSaved,
}: {
  source: SourcePaneResolution;
  entry: ComposerPreviewEntry | null;
  readOnly: boolean;
  /** When omitted (e.g. the split-view source side) no close button renders. */
  onClose?: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState("");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadReq = useRef(0);

  useEffect(() => {
    const reqId = ++loadReq.current;
    setLoading(true);
    setError(null);
    spacesWorkspaceFilesClient
      .getFile(source.target, source.sourceFile)
      .then((data) => {
        if (loadReq.current !== reqId) return;
        const text = data.content ?? "";
        setContent(text);
        setValue(text);
      })
      .catch((err: unknown) => {
        if (loadReq.current !== reqId) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (loadReq.current === reqId) setLoading(false);
      });
  }, [source.target, source.sourceFile]);

  async function handleSave() {
    if (readOnly || saving) return;
    const saved = value;
    if (
      editTouchesManagedSection(
        content,
        saved,
        DEFAULT_MANAGED_SECTION_HEADINGS,
      )
    ) {
      toast.warning(
        "This edit falls inside a computed section — it is recomposed automatically and your change here will not survive the next update.",
      );
    }
    setSaving(true);
    try {
      await spacesWorkspaceFilesClient.putFile(
        source.target,
        source.sourceFile,
        saved,
      );
      setContent(saved);
      // The rendered workspace derives from this source — refetch so the tree
      // and any generated output stay truthful.
      onSaved();
    } catch (err) {
      toast.error(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  }

  // Folded into the standard FileEditorPane header (one house header, no outer
  // row): the badges sit after the filename, Close sits after Save/Discard.
  const headerBadges = (
    <>
      {entry?.generated ? (
        <Badge
          variant="outline"
          className="shrink-0 px-1.5 py-0 text-[10px] text-muted-foreground"
        >
          generated
        </Badge>
      ) : null}
      <Badge
        variant="outline"
        className="shrink-0 px-1.5 py-0 text-[10px] text-muted-foreground"
      >
        {source.layer} source
      </Badge>
      {readOnly ? (
        <Badge
          variant="outline"
          className="shrink-0 px-1.5 py-0 text-[10px] text-muted-foreground"
        >
          read-only
        </Badge>
      ) : null}
    </>
  );
  const closeAction = onClose ? (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-[11px] text-muted-foreground"
      data-testid="composer-file-close"
      onClick={onClose}
    >
      Close
    </Button>
  ) : null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="composer-editable-pane"
    >
      {error ? (
        <>
          {/* Error state keeps a minimal header so Close isn't lost. */}
          <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/50 px-3">
            <span className="min-w-0 truncate font-mono text-xs text-foreground">
              {source.sourceFile}
            </span>
            {headerBadges}
            {closeAction ? <div className="ml-auto">{closeAction}</div> : null}
          </div>
          <p
            className="p-3 text-xs text-destructive"
            data-testid="composer-file-error"
          >
            Couldn&apos;t load this file: {error}
          </p>
        </>
      ) : (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <FileEditorPane
            openFile={source.sourceFile}
            content={content}
            value={value}
            loading={loading}
            saving={saving}
            readOnly={readOnly}
            managedHeadings={DEFAULT_MANAGED_SECTION_HEADINGS}
            headerBadges={headerBadges}
            headerActions={closeAction}
            onChange={setValue}
            onSave={() => void handleSave()}
            onDiscard={() => setValue(content)}
          />
        </div>
      )}
    </div>
  );
}
