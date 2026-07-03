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
  FileText,
  Folder,
  FolderTree,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
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

/** Skill slug for a `skills/<slug>` folder node, else null. */
function skillSlugForFolder(node: TreeNode): string | null {
  if (!node.isFolder) return null;
  const match = /^skills\/([^/]+)$/.exec(node.path);
  return match ? match[1] : null;
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
  const entryByPath = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry])),
    [entries],
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

  const pendingFolderPath = pendingSkillSlug
    ? `skills/${pendingSkillSlug}`
    : null;
  const tree = useMemo(() => {
    const nodes = buildPreviewTree(entries);
    if (
      pendingFolderPath &&
      !entries.some((entry) => entry.path.startsWith(`${pendingFolderPath}/`))
    ) {
      const skillsFolder = nodes.find(
        (node) => node.path === "skills" && node.isFolder,
      );
      const ghost: TreeNode = {
        name: pendingFolderPath.split("/")[1],
        path: pendingFolderPath,
        isFolder: true,
        children: [],
      };
      if (skillsFolder) {
        skillsFolder.children.unshift(ghost);
      } else {
        nodes.unshift({
          name: "skills",
          path: "skills",
          isFolder: true,
          children: [ghost],
        });
      }
    }
    return nodes;
  }, [entries, pendingFolderPath]);

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
        void navigate({
          to: "/settings/agents",
          search: { view: "workspace", file: cause.file },
        });
        return;
    }
  }

  function jumpEntryFor(node: TreeNode): ComposerPreviewEntry | null {
    if (node.entry) return node.entry;
    if (node.path === pendingFolderPath) return null;
    let cursor: TreeNode | undefined = node;
    while (cursor && !cursor.entry) {
      cursor = cursor.children[0];
    }
    return cursor?.entry ?? null;
  }

  function renderNode(node: TreeNode, depth: number): React.ReactNode {
    const isCollapsed = collapsed.has(node.path);
    const isPending = node.path === pendingFolderPath;
    const skillSlug = skillSlugForFolder(node);
    const skillState = skillSlug ? skillStateBySlug?.get(skillSlug) : undefined;
    const isGated = Boolean(skillState && !skillState.active);
    const isRemoving = Boolean(skillSlug && skillSlug === removingSkillSlug);
    const jumpEntry = jumpEntryFor(node);
    const causeKind = jumpEntry ? (causeOf(jumpEntry)?.kind ?? null) : null;
    const canJump =
      causeKind !== null &&
      (causeKind !== "user" ||
        Boolean(result?.perspectiveUserId ?? perspectiveUserId)) &&
      (causeKind !== "skill" || Boolean(onFocusCapabilityRow));
    const isSkillsRoot = node.isFolder && node.path === "skills";
    const canDetachThis = Boolean(
      skillSlug && canManageSkills && onDetachSkill && !isRemoving,
    );
    const canAddHere = Boolean(isSkillsRoot && canManageSkills && onAddSkill);
    const hasMenu =
      canDetachThis || canAddHere || (canJump && Boolean(jumpEntry));

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
            <Folder className="size-3.5 shrink-0" />
            <span className="truncate">{node.name}</span>
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
        {isGated && skillState?.reason ? (
          <button
            type="button"
            onClick={() =>
              skillSlug && onFocusCapabilityRow?.("skill", skillSlug)
            }
            data-testid={`tree-gate-${node.path}`}
            title="Open this capability in the list"
          >
            {/* Reason renders verbatim from the backend taxonomy (R6). */}
            <Badge
              variant="outline"
              className="shrink-0 cursor-pointer border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
            >
              {skillState.reason}
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
          {canAddHere ? (
            <ContextMenuItem
              onSelect={() => onAddSkill?.()}
              data-testid="menu-add-skill"
            >
              <Plus className="mr-2 size-4" /> Add skill…
            </ContextMenuItem>
          ) : null}
          {canDetachThis ? (
            <ContextMenuItem
              variant="destructive"
              onSelect={() => skillSlug && onDetachSkill?.(skillSlug)}
              data-testid={`menu-detach-skill-${skillSlug}`}
            >
              <Trash2 className="mr-2 size-4" /> Detach skill…
            </ContextMenuItem>
          ) : null}
          {(canAddHere || canDetachThis) && canJump && jumpEntry ? (
            <ContextMenuSeparator />
          ) : null}
          {canJump && jumpEntry ? (
            <ContextMenuItem
              onSelect={() => jumpToCause(jumpEntry)}
              data-testid={`menu-open-source-${node.path}`}
            >
              {causeKind === "skill" ? "Open in capabilities" : "Open source"}
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
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
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
    </div>
  );

  return (
    <div
      className="flex h-full w-full min-h-0 overflow-hidden rounded-md border"
      data-testid="composer-editor"
    >
      <div className="flex w-[20rem] min-w-0 shrink-0 flex-col border-r">
        {treePanel}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
      </div>
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

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="composer-file-viewer"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/50 px-3">
        <span className="min-w-0 truncate font-mono text-xs text-foreground">
          {path}
        </span>
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
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-[11px] text-muted-foreground"
          data-testid="composer-file-close"
          onClick={onClose}
        >
          Close
        </Button>
      </div>
      {failed ? (
        <p
          className="p-3 text-xs text-destructive"
          data-testid="composer-file-error"
        >
          {errorText}
        </p>
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

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="composer-editable-pane"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/50 px-3">
        <span className="min-w-0 truncate font-mono text-xs text-foreground">
          {entry?.path ?? source.sourceFile}
        </span>
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
        {onClose ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2 text-[11px] text-muted-foreground"
            data-testid="composer-file-close"
            onClick={onClose}
          >
            Close
          </Button>
        ) : null}
      </div>
      {error ? (
        <p
          className="p-3 text-xs text-destructive"
          data-testid="composer-file-error"
        >
          Couldn&apos;t load this file: {error}
        </p>
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
            onChange={setValue}
            onSave={() => void handleSave()}
            onDiscard={() => setValue(content)}
          />
        </div>
      )}
    </div>
  );
}
