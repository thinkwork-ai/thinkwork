---
date: 2026-05-30
topic: desktop-local-workspace-view
---

# Desktop Local Workspace View

## Summary

Add a **Local Workspace** item to the desktop Settings menu that opens a
full-screen, read-only file inspector. It renders the local sidecar workspace
cache as a nested file tree (left pane) with file contents (right pane), in the
same visual language as the thread goal-folder viewer, plus a manual Refresh.
Born as a dogfooding/debugging surface, it is built as a real feature that can
mature toward an end-user-facing workspace browser.

## Problem Frame

The desktop app is moving toward a local agent posture. The in-flight Desktop
Local Pi Sidecar (`docs/plans/2026-05-28-003-feat-desktop-local-pi-sidecar-plan.md`)
syncs each rendered S3 workspace into an app-owned cache under Electron
`userData`, partitioned by stage/tenant/agent/Space/user. Today that cache is a
black box: the only way to confirm what the sidecar actually pulled down — which
files, what AGENTS.md routing, which skills materialized — is to dig through a
deep hidden directory in Finder by hand. As the local runtime becomes the
primary execution path, "what does my agent actually see on disk right now?"
becomes a routine question for both engineers debugging the sidecar and, later,
users who want transparency into their agent's working context. There is no
in-app answer.

## Key Decisions

- **In-app viewer only — no OS shell-out.** Clicking the menu item opens the
  full-screen two-pane viewer inside the app. No "Reveal in Finder," no
  `shell.openPath`. Keeps the experience contained and consistent with the rest
  of the desktop UI.
- **Read-only inspection.** View and copy file contents; no editing. The
  sidecar owns this cache and overwrites it on every sync, so local edits would
  silently vanish and could corrupt the sidecar's view. S3 remains the source of
  truth. Write-back to S3 is a separate, larger feature (see Scope Boundaries).
- **Show the whole cache root as one nested tree.** All synced tuples are
  visible, expandable by folder — maximum transparency into what the sidecar has
  materialized. This is richer than the flat file list of the thread goal-folder
  viewer; the left pane must support folder nesting, not just a flat list.
- **Build it as a real feature, not a throwaway debug panel.** Empty, loading,
  and error states are first-class. Raw tuple path segments are acceptable for
  v1 but human-friendly labeling is a planned refinement (see R8), so the surface
  can graduate to end-user use without a rebuild.

## Actors

- A1. Desktop user / platform engineer: opens Local Workspace from Settings to
  inspect what the sidecar has synced locally.
- A2. Electron main process: resolves the cache root path and serves read-only
  filesystem operations to the renderer over a narrow IPC bridge.
- A3. Local Pi sidecar: the upstream writer that populates and overwrites the
  cache. This feature only reads what the sidecar produces; it never writes.

## Requirements

**Entry point and surface**

- R1. A **Local Workspace** item appears in the desktop Settings menu. It is
  present only in the desktop build (`__DESKTOP_BUILD__`) and absent from the
  web `apps/spaces` build, where no local cache exists.
- R2. Selecting it opens a full-screen view styled to match the existing
  thread goal-folder file viewer: a left file/folder pane and a right
  content pane, dark theme, monospaced content with line numbers.

**Tree and content**

- R3. The left pane renders the entire sidecar cache root as a **nested,
  expandable tree** (folders and files), reflecting the
  stage/tenant/agent/Space/user partitioning on disk.
- R4. Selecting a file shows its contents in the right pane with line numbers
  and syntax highlighting consistent with the existing viewer.
- R5. A user can copy a file's contents from the content pane.
- R6. The view shows a clear **empty state** when the cache root does not exist
  or contains no files yet (e.g., the sidecar has not synced), explaining that
  files appear once a workspace syncs locally — not an error.

**Refresh and freshness**

- R7. A manual **Refresh** control re-reads the cache root and updates both the
  tree and the currently-open file. Live file-watching auto-refresh is out of
  scope for v1.

**Maturation toward end-user use**

- R8. Tree nodes for tuple segments should be presentable with human-friendly
  labels (e.g., Agent name, Space name) rather than raw slugs as a planned
  refinement; v1 may show raw path segments but must not preclude friendly
  labeling.

**Safety**

- R9. Filesystem reads are confined to the resolved cache root with a
  path-traversal guard; no path outside the cache root is readable through the
  bridge.

## Key Flows

- F1. Inspect the local workspace
  - **Trigger:** User opens Settings and selects Local Workspace.
  - **Actors:** A1, A2
  - **Steps:** The renderer requests the cache root tree from the main process;
    the main process resolves the cache root (honoring the
    `THINKWORK_DESKTOP_USER_DATA_DIR` override in dev), lists the tree under it,
    and returns it; the renderer renders the nested tree; selecting a file
    requests and displays its contents.
  - **Outcome:** The user sees exactly what the sidecar has materialized on disk.

- F2. Refresh after a sync
  - **Trigger:** User clicks Refresh after the sidecar has run.
  - **Actors:** A1, A2
  - **Steps:** The renderer re-requests the tree and the open file's contents;
    the view updates in place, preserving the current selection if it still
    exists.
  - **Outcome:** Newly synced or changed files are visible without reopening.

- F3. Open before any sync
  - **Trigger:** User opens Local Workspace before the sidecar has synced
    anything (or before the sidecar ships).
  - **Actors:** A1, A2
  - **Steps:** The main process finds the cache root missing or empty and
    returns an empty result; the renderer shows the empty state.
  - **Outcome:** The user understands nothing has synced yet, not that something
    broke.

## Acceptance Examples

- AE1. **Covers R3, R4.** Given a cache root containing
  `dev/acme/onboarding-agent/alpha-fuel-space/eric/` with `AGENTS.md`,
  `GOAL.md`, and a `skills/` folder, when the user opens Local Workspace, then
  the left pane shows the nested tree with `skills/` collapsible, and selecting
  `GOAL.md` renders its contents with line numbers.
- AE2. **Covers R6, R7.** Given an empty cache root, when the user opens Local
  Workspace, then the empty state is shown; when the sidecar later syncs a
  workspace and the user clicks Refresh, then the tree populates without a
  restart.
- AE3. **Covers R1.** Given the web `apps/spaces` build, when the user opens
  Settings, then no Local Workspace item is present.
- AE4. **Covers R9.** Given a request that attempts to escape the cache root
  (e.g., `../../`), when the renderer issues it, then the main process rejects
  it and reads nothing outside the cache root.

## Scope Boundaries

**Deferred for later**
- Live file-watching / auto-refresh (R7 is manual only for v1).
- Human-friendly tuple labeling (R8 acknowledged, may land post-v1).
- Search / filter within the tree or file contents.

**Outside this feature**
- Editing files (read-only by decision).
- Writing changes back to S3 or the platform — that requires upload IPC,
  conflict handling, and permissions, and is a separate feature.
- "Reveal in Finder" / OS file-manager integration (in-app only by decision).
- Any management of the sidecar itself (start/stop/status) — this view only
  reads the cache the sidecar produces.

## Dependencies / Assumptions

- **Depends on the Desktop Local Pi Sidecar** (`docs/plans/2026-05-28-003-feat-desktop-local-pi-sidecar-plan.md`)
  to populate the cache under Electron `userData`. This view can ship before the
  sidecar lands but shows only the empty state until a sync occurs.
- The cache root path is derived from the same Electron `userData` resolution
  used elsewhere (`apps/desktop/src/main/user-data.ts`), including the
  `THINKWORK_DESKTOP_USER_DATA_DIR` dev override.
- The desktop renderer is the shared `apps/spaces` app; the Settings menu lives
  in `apps/spaces/src/components/shell/ChatSidebar.tsx`, and desktop-only
  behavior is gated via `__DESKTOP_BUILD__` / `isDesktopBuild()`.
- No read-only filesystem IPC exists yet in the desktop preload bridge
  (`apps/desktop/src/preload/index.ts`); list-directory and read-file channels
  are net-new.

## Outstanding Questions

**Deferred to Planning**
- Exact IPC channel/schema shape for list-directory and read-file (and how the
  tree is transferred — eagerly vs. lazily per folder).
- Whether to reuse the thread goal-folder viewer component directly or factor a
  shared file-viewer primitive, given the flat-vs-nested difference.
- Handling of binary/large files in the content pane (e.g., size cap, "preview
  not available" affordance).
- Where exactly the cache root sits relative to `userData` once the sidecar
  finalizes its partitioning layout.

## Sources / Research

- `docs/brainstorms/2026-05-28-desktop-local-pi-sidecar-requirements.md` and
  `docs/plans/2026-05-28-003-feat-desktop-local-pi-sidecar-plan.md` — define the
  cache root, tuple partitioning, and sync behavior this view inspects.
- `docs/brainstorms/2026-05-27-thread-goal-folder-file-editor-requirements.md`
  (plan 005) — the existing two-pane file viewer this view's UI mirrors.
- `apps/spaces/src/components/shell/ChatSidebar.tsx` — Settings menu where the
  entry point is added.
- `apps/desktop/src/preload/index.ts` and `apps/desktop/src/main/ipc-handlers.ts`
  — the bridge where read-only filesystem IPC would be added.
- `apps/desktop/src/main/user-data.ts` — `userData` path resolution and the
  `THINKWORK_DESKTOP_USER_DATA_DIR` override.
