/**
 * Composer result tree (Composer plan U2).
 *
 * A live, READ-ONLY preview of the rendered workspace for the Composer's
 * current selection (Agent × Space × perspective user), backed by the
 * `workspacePreview` query — the same `persist:false` render path the
 * runtime uses, so the tree is byte-identical to what a real turn mounts.
 * The preview is profile-invariant: the Profile chip scopes the controls
 * pane only (R4), so no agentProfileId ever reaches these queries.
 *
 * Every node carries a jump-to-cause affordance resolved client-side from
 * `{owner, path, generated}` (KTD-5):
 *
 *   - `skills/<slug>/…`   → in-page focus of the skill's attach/detach row
 *                           (the host resets State/Search tokens and switches
 *                           tabs so the row is visible under any toolbar
 *                           state);
 *   - `Spaces/<slug>/…`   → the Space source editor
 *                           (/settings/spaces/$spaceId?view=workspace);
 *   - `User/…`            → the perspective user's detail page;
 *   - generated files     → the producing layer's SOURCE file in the agent
 *                           workspace editor (KTD-7), and opening a generated
 *                           file in the tree shows the U7 split view: the
 *                           editable source beside the rendered output.
 *
 * File content loads lazily via `workspacePreviewFile` into a read-only
 * viewer (pre-rendered, no put path) — the ProjectedWorkspacePanel pattern,
 * which fits a query-backed tree with less adaptation than the
 * client-backed `WorkspaceFileEditor`. Generated files additionally get an
 * editable source pane (`ComposerSourcePane`) whose saves ride the existing
 * workspace-files put path and refetch the preview (R9).
 *
 * During the post-attach sync-pending window the affected skill folder
 * renders as an explicit ghost node with a "syncing…" badge rather than
 * appearing frozen; the host bumps `refreshToken` when the sync-pending
 * confirmation completes, which refetches the whole preview.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  CornerUpRight,
  FileText,
  Folder,
  FolderTree,
  X,
} from "lucide-react";
import { useQuery } from "urql";
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
  Skeleton,
  cn,
} from "@thinkwork/ui";
import {
  FileEditorPane,
  managedSectionsEdited,
} from "@thinkwork/workspace-editor";
import { useTenant } from "@/context/TenantContext";
import {
  spacesWorkspaceFilesClient,
  type WorkspaceFilesTarget,
} from "@/lib/workspace-files-api";
import {
  SettingsWorkspacePreviewFileQuery,
  SettingsWorkspacePreviewQuery,
} from "@/lib/settings-queries";

export interface ComposerWorkspaceTreeProps {
  tenantId: string;
  /** Selection tokens (the QUERY dimensions — no profile, R4). */
  spaceId: string | null;
  perspectiveUserId: string | null;
  /**
   * Bumped by the host after each mutation confirmation resolves (including
   * sync-pending completion) — triggers a network-only preview refetch.
   */
  refreshToken?: number;
  /**
   * Skill slug inside the post-attach sync-pending window: its folder node
   * renders as a ghost with a "syncing…" badge until the refetch lands.
   */
  pendingSkillSlug?: string | null;
  /**
   * In-page jump-to-cause for skill nodes: the host focuses the skill's
   * attach/detach row (resetting State/Search tokens + switching tabs).
   */
  onFocusCapabilityRow?: (
    capabilityClass: string,
    capabilityId: string,
  ) => void;
}

interface PreviewEntry {
  path: string;
  owner: string;
  generated: boolean;
  size?: number | null;
}

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
  entry?: PreviewEntry;
}

/** Builds a nested tree from the flat rendered-workspace path list. */
export function buildPreviewTree(entries: PreviewEntry[]): TreeNode[] {
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
        node = {
          name,
          path: pathSoFar,
          isFolder: !isLast,
          children: [],
        };
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
  // Folders first at every level, then files, alphabetical within each.
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

export function causeOf(entry: PreviewEntry): JumpCause {
  const segments = entry.path.split("/");
  if (segments[0] === "skills" && segments.length > 1) {
    return { kind: "skill", slug: segments[1] };
  }
  if (entry.owner === "space" || segments[0] === "Spaces") {
    // Strip the `Spaces/<slug>/` mount prefix: the Space editor takes a
    // path relative to the Space source tree. A generated space file links
    // to the same source file that produced it (pre-U7).
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
    // Generated agent files (AGENTS.md, gated CONTEXT.md) point at the
    // producing layer's source file — same relative path in the agent
    // source tree (KTD-7); plain agent source files open themselves.
    return { kind: "agent_source", file: entry.path };
  }
  return null;
}

/**
 * The producing layer's SOURCE file for a generated entry (U7): agent-owned
 * generated files map to the same relative path in the agent source tree;
 * `Spaces/<slug>/…` generated files map to the space source tree. User-owned
 * generated files (USER.md is server-managed) have no editable source.
 */
export function sourceBindingFor(
  entry: PreviewEntry,
  resolved: { agentId?: string | null; spaceId?: string | null },
): { target: WorkspaceFilesTarget; targetKey: string; path: string } | null {
  if (!entry.generated) return null;
  const segments = entry.path.split("/");
  if (segments[0] === "Spaces" && segments.length > 2) {
    if (!resolved.spaceId) return null;
    return {
      target: { spaceId: resolved.spaceId },
      targetKey: `space:${resolved.spaceId}`,
      path: segments.slice(2).join("/"),
    };
  }
  if (entry.owner === "agent") {
    if (!resolved.agentId) return null;
    return {
      target: { agentId: resolved.agentId },
      targetKey: `agent:${resolved.agentId}`,
      path: entry.path,
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

export function ComposerWorkspaceTree({
  tenantId,
  spaceId,
  perspectiveUserId,
  refreshToken = 0,
  pendingSkillSlug = null,
  onFocusCapabilityRow,
}: ComposerWorkspaceTreeProps) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const [preview, refetchPreview] = useQuery({
    query: SettingsWorkspacePreviewQuery,
    variables: {
      tenantId,
      agentId: null,
      spaceId,
      perspectiveUserId,
    },
    pause: !tenantId,
    requestPolicy: "network-only",
  });

  const [fileResult, refetchFile] = useQuery({
    query: SettingsWorkspacePreviewFileQuery,
    variables: {
      tenantId,
      agentId: null,
      spaceId,
      perspectiveUserId,
      path: selectedPath ?? "",
    },
    pause: !tenantId || !selectedPath,
    requestPolicy: "network-only",
  });

  // Mutation confirmations bump the token — refetch the whole preview (and
  // the open file, whose rendered content may have changed).
  const lastToken = useRef(refreshToken);
  useEffect(() => {
    if (refreshToken === lastToken.current) return;
    lastToken.current = refreshToken;
    refetchPreview({ requestPolicy: "network-only" });
    if (selectedPath) refetchFile({ requestPolicy: "network-only" });
  }, [refreshToken, refetchPreview, refetchFile, selectedPath]);

  const result = preview.data?.workspacePreview;
  const entries = useMemo(
    () => (result?.files ?? []) as PreviewEntry[],
    [result?.files],
  );
  const entryByPath = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry])),
    [entries],
  );

  // Post-attach sync window: make the affected skill folder visible as an
  // explicit pending node even before the preview refetch lands.
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

  function jumpToCause(entry: PreviewEntry) {
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

  /** Jump affordance for a node: folder rows jump via their first file. */
  function jumpEntryFor(node: TreeNode): PreviewEntry | null {
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
    const jumpEntry = jumpEntryFor(node);
    const causeKind = jumpEntry ? (causeOf(jumpEntry)?.kind ?? null) : null;
    // A user jump needs a resolvable user id; hide the affordance otherwise.
    const canJump =
      causeKind !== null &&
      (causeKind !== "user" ||
        Boolean(result?.perspectiveUserId ?? perspectiveUserId)) &&
      (causeKind !== "skill" || Boolean(onFocusCapabilityRow));
    return (
      <div key={node.path}>
        <div
          className={cn(
            "group flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5",
            isPending && "opacity-60",
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
          {isPending ? (
            <Badge
              variant="outline"
              className="shrink-0 border-sky-500/40 bg-sky-500/10 px-1.5 py-0 text-[10px] text-sky-700 dark:text-sky-400"
              data-testid={`tree-pending-${node.path}`}
            >
              syncing…
            </Badge>
          ) : null}
          {canJump && jumpEntry ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              aria-label={`Jump to cause of ${node.path}`}
              data-testid={`tree-jump-${node.path}`}
              onClick={() => jumpToCause(jumpEntry)}
            >
              <CornerUpRight className="size-3.5" />
            </Button>
          ) : null}
        </div>
        {node.isFolder && !isCollapsed
          ? node.children.map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    );
  }

  const selectedEntry = selectedPath
    ? (entryByPath.get(selectedPath) ?? null)
    : null;

  return (
    <div className="flex flex-col gap-3" data-testid="composer-tree">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <FolderTree className="size-4" />
        <span>Rendered workspace</span>
        {result?.noUserBaseline ? (
          <Badge
            variant="outline"
            className="px-1.5 py-0 text-[10px] text-muted-foreground"
          >
            no-user baseline
          </Badge>
        ) : null}
      </div>

      {preview.fetching ? (
        <div className="space-y-2" data-testid="preview-loading">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-4/5" />
        </div>
      ) : preview.error ? (
        <p className="text-sm text-destructive" data-testid="preview-error">
          Couldn&apos;t load the rendered workspace: {preview.error.message}
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
      ) : result ? (
        <>
          <div className="rounded-md border border-border p-2">
            {tree.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">
                Nothing rendered for the current selection.
              </p>
            ) : (
              tree.map((node) => renderNode(node, 0))
            )}
          </div>
          {selectedPath ? (
            (() => {
              const binding = selectedEntry
                ? sourceBindingFor(selectedEntry, {
                    agentId: result?.agentId,
                    spaceId: result?.spaceId ?? spaceId,
                  })
                : null;
              const viewer = (
                <ComposerFileViewer
                  path={selectedPath}
                  entry={selectedEntry}
                  fetching={fileResult.fetching}
                  errorMessage={fileResult.error?.message ?? null}
                  payload={
                    (fileResult.data?.workspacePreviewFile ?? null) as {
                      state: string;
                      stateDetail?: string | null;
                      content?: string | null;
                    } | null
                  }
                  onClose={() => setSelectedPath(null)}
                />
              );
              // Generated files open split: the producing layer's editable
              // source beside the rendered output (R9, F3). Everything else
              // stays single-pane read-only.
              return binding ? (
                <div
                  className="grid gap-3 xl:grid-cols-2"
                  data-testid="composer-split-view"
                >
                  <ComposerSourcePane
                    target={binding.target}
                    targetKey={binding.targetKey}
                    path={binding.path}
                    onSaved={() => {
                      refetchPreview({ requestPolicy: "network-only" });
                      refetchFile({ requestPolicy: "network-only" });
                    }}
                  />
                  {viewer}
                </div>
              ) : (
                viewer
              );
            })()
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * Editable source pane for the Composer split view (U7): the producing
 * layer's real source file, written through the existing workspace-files
 * put path (no new write API). Managed-section bodies render locked in the
 * embedded editor (via the shared FileEditorPane affordance) and an edit
 * inside one warns before saving — the same guard WorkspaceFileEditor
 * applies, because both write the same recomposed files.
 */
export function ComposerSourcePane({
  target,
  targetKey,
  path,
  onSaved,
}: {
  target: WorkspaceFilesTarget;
  targetKey: string;
  path: string;
  onSaved: () => void;
}) {
  const { isOperator, roleResolved } = useTenant();
  const [content, setContent] = useState("");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnHeadings, setWarnHeadings] = useState<string[] | null>(null);
  const loadRequestId = useRef(0);

  useEffect(() => {
    const requestId = loadRequestId.current + 1;
    loadRequestId.current = requestId;
    setLoading(true);
    setError(null);
    spacesWorkspaceFilesClient
      .getFile(target, path)
      .then((data) => {
        if (loadRequestId.current !== requestId) return;
        const fileContent = data.content ?? "";
        setContent(fileContent);
        setValue(fileContent);
      })
      .catch((err: unknown) => {
        if (loadRequestId.current !== requestId) return;
        setError(err instanceof Error ? err.message : String(err));
        setContent("");
        setValue("");
      })
      .finally(() => {
        if (loadRequestId.current === requestId) setLoading(false);
      });
    // targetKey stands in for the target object's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, path]);

  const performSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await spacesWorkspaceFilesClient.putFile(target, path, value);
      setContent(value);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, path, value, onSaved]);

  const handleSave = useCallback(() => {
    const touched = managedSectionsEdited(path, content, value);
    if (touched.length > 0) {
      setWarnHeadings(touched);
      return;
    }
    void performSave();
  }, [content, path, performSave, value]);

  return (
    <div
      className="flex flex-col rounded-md border border-border"
      data-testid="composer-source-pane"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 truncate font-mono text-xs text-foreground">
          {path}
        </span>
        <Badge
          variant="outline"
          className="shrink-0 px-1.5 py-0 text-[10px] text-muted-foreground"
        >
          source
        </Badge>
      </div>
      {error ? (
        <p
          className="px-3 py-2 text-xs text-destructive"
          data-testid="composer-source-error"
        >
          {error}
        </p>
      ) : null}
      <div className="flex min-h-80 flex-1 flex-col">
        <FileEditorPane
          openFile={path}
          content={content}
          value={value}
          loading={loading}
          saving={saving}
          readOnly={!(isOperator && roleResolved)}
          onChange={setValue}
          onSave={handleSave}
          onDiscard={() => setValue(content)}
        />
      </div>
      <AlertDialog
        open={warnHeadings !== null}
        onOpenChange={(open) => !open && setWarnHeadings(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit inside a computed section</AlertDialogTitle>
            <AlertDialogDescription>
              {`Your change touches ${
                warnHeadings && warnHeadings.length > 1
                  ? "computed sections"
                  : "the computed section"
              } ${(warnHeadings ?? [])
                .map((heading) => `"${heading}"`)
                .join(
                  ", ",
                )}. These bodies are regenerated from the capability set, so this edit will be overwritten the next time they recompute. Save anyway?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                setWarnHeadings(null);
                void performSave();
              }}
            >
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Read-only file-content viewer for the preview tree. Renders the lazily
 * fetched `workspacePreviewFile` payload as plain preformatted text — there
 * is deliberately NO edit or save path here (R2): the rendered workspace is
 * derived; changes belong to the owning surface behind jump-to-cause.
 */
export function ComposerFileViewer({
  path,
  entry,
  fetching,
  errorMessage,
  payload,
  onClose,
}: {
  path: string;
  entry: PreviewEntry | null;
  fetching: boolean;
  errorMessage: string | null;
  payload: {
    state: string;
    stateDetail?: string | null;
    content?: string | null;
  } | null;
  onClose: () => void;
}) {
  return (
    <div
      className="rounded-md border border-border"
      data-testid="composer-file-viewer"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
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
          size="icon-sm"
          className="ml-auto size-6 shrink-0"
          aria-label="Close file view"
          data-testid="composer-file-close"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="p-3">
        {fetching ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="composer-file-loading"
          >
            Loading…
          </p>
        ) : errorMessage ? (
          <p
            className="text-xs text-destructive"
            data-testid="composer-file-error"
          >
            Couldn&apos;t load this file: {errorMessage}
          </p>
        ) : payload && payload.state !== "ok" ? (
          <p
            className="text-xs text-destructive"
            data-testid="composer-file-error"
          >
            {payload.state === "not_found"
              ? "This file is no longer part of the rendered workspace"
              : payload.state === "invalid_selection"
                ? "Invalid selection"
                : "Resolution fault — this selection could not be composed"}
            {payload.stateDetail ? `: ${payload.stateDetail}` : ""}
          </p>
        ) : (
          <pre
            className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 font-mono text-xs leading-5"
            data-testid="composer-file-content"
          >
            {payload?.content ?? ""}
          </pre>
        )}
      </div>
    </div>
  );
}
