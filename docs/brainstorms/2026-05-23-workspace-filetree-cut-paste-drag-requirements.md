---
date: 2026-05-23
topic: workspace-filetree-cut-paste-drag
---

# Workspace Filetree: Loading States, Clipboard, and Drag-and-Drop

## Summary

Add five UX capabilities to the shared workspace file tree (used in every workspace editor — agent, sub-agents, space, computer, user knowledge, human personalization): per-node loading icons during mutations, paste in the right-click menu plus Cmd+V, Cmd+X cut with muted/dashed visual state, intra-tree drag-and-drop between folders, and a new atomic server `move` action that backs both paste and drag.

---

## Problem Frame

The workspace tree is now the primary surface for operators to reorganize agent context — capabilities, identity, memory, skills, sub-agent folders. The current tree supports create, rename, and delete via right-click but has no way to move a file or folder once it exists. Reorganizing a sub-tree means recreating every file at the new path and deleting the originals one at a time. Deletion also has no visual feedback during the network round-trip, so users double-click or assume failure.

Six tree instances all render the same `FolderTree` wrapper, so any gap shows up six times. With 248+ files in mature workspaces (per the screenshot context) and pinned/inherited files that complicate naive moves, "just live without it" has become real friction.

---

## Requirements

**Per-node loading state**
- R1. When a file or folder is being deleted, its icon is replaced with a spinning loader. The node label remains visible. The node remains in the tree until the delete resolves; it is not optimistically removed.
- R2. When a file or folder is being moved (paste, drop, or cut+paste), its icon is replaced with a spinning loader on the source node until the server returns success. On success the node disappears from its old location and appears at the new location.
- R3. Loading state is per-node, not global — other tree interactions remain responsive while one node is mutating.

**Clipboard (cut + paste)**
- R4. Cmd+X (or right-click → Cut) marks the focused file or folder as cut. The cut item renders with reduced opacity and a dashed border on the row.
- R5. Cmd+V (or right-click → Paste) on a folder pastes the cut item as a child of that folder. Cmd+V with no folder selected pastes at the workspace root.
- R6. Paste appears in the folder context menu only when the clipboard is non-empty. It also appears in the root context menu (empty-area right-click) with the same condition.
- R7. The clipboard lives in per-tree React state. Navigating away from the tree, closing the workspace editor, or refreshing clears it.
- R8. Only one item can be cut at a time. Cutting a second item replaces the first in the clipboard.
- R9. After a successful paste, the clipboard clears and the cut visual state ends. After a failed paste (network error, conflict that cannot resolve, blocked node), the clipboard retains the item and the cut visual remains.

**Drag-and-drop**
- R10. Files and folders can be dragged onto folders within the same tree. Dropping completes the move atomically.
- R11. Dragging onto a folder shows a clear drop-target indicator (folder row gets a focus ring or background tint). Dragging over the folder for ~600ms expands it so the user can drop deeper.
- R12. Dropping outside any folder (e.g., onto the empty area below the tree) treats the workspace root as the target.
- R13. Drag is intra-tree only. Files dragged from the desktop are not handled by this work (a drop from outside the browser is a no-op for v1).

**Server `move` action**
- R14. A new `move` action is added to `/api/workspaces/files` that copies the source object(s) to the destination prefix and deletes the source in a single Lambda invocation.
- R15. Folder moves are atomic at the Lambda level: the handler walks the source prefix, copies every object to the destination prefix, then deletes the source prefix. A failure mid-walk surfaces an error and leaves either the full source or the full destination present — never both as a partial duplicate.
- R16. The action accepts a single source path and a single destination folder path. The new key is `{destFolder}/{sourceBasename}`. The action returns the final destination path so the client can refresh tree state.

**Name conflict resolution**
- R17. When the destination already contains an item with the same name, the moved item is renamed by appending ` (2)`, ` (3)`, … until the name is unique. No prompt. The server returns the actual final name.
- R18. Auto-rename applies to both files and folders. For folders, only the folder's own name receives the suffix; children inside the folder retain their names.

**Pinned / inherited files**
- R19. Pinned files (those that today require `acceptTemplateUpdate: true` to overwrite) can be moved like any other file. Moving a pinned file silently detaches it from its template (it becomes a local override at the new path). This matches the behavior of editing-then-saving a pinned file today.
- R20. When a folder move detaches one or more pinned files from their templates, a post-move toast summarizes the bulk effect: `"Moved 12 files. 3 lost template inheritance."` The toast is non-blocking and dismissable. No toast fires when zero pinned files are affected. No toast fires for single-file moves (the per-file silent break is consistent with today's edit behavior).

**Canonical workspace files (revised 2026-05-23 at plan time — "filesystem is the agent")**
- R21. _Reversed at plan time._ No files are blocked from move, rename, or delete. The workspace is treated as a raw filesystem; the operator can reorganize anything including `AGENTS.md`, `CAPABILITIES.md`, `IDENTITY.md`, etc. Derivation pipelines (`derive-agent-skills`) handle the new locations or absence gracefully — if `AGENTS.md` is moved or deleted, the agent's routing table reflects whatever the filesystem says.
- R22. _Reversed at plan time._ Context menus and drag affordances are uniform across all files. No special hiding or disabling. Operators see a consistent UI regardless of which file they right-click.
- R23. _Reversed at plan time._ No allowlist constant is added. Filesystem is the source of truth. Consequence to surface: moving or deleting `AGENTS.md` clears routing rows until the file is recreated — recoverable, but worth noting in the move toast or a one-time documentation pointer (planner's call on placement).

**Apply everywhere (revised 2026-05-23 — Computer concept removed from product)**
- R24. All five capabilities ship through the shared `FolderTree` / `FileTree` components, so they appear simultaneously in every instance the tree is used today: agent workspace, agent sub-agents, space workspace, user knowledge, and human personalization. The Computer workspace tab is excluded — the Computer concept has been removed from the product and that tab will be retired as a separate follow-up.

---

## Acceptance Examples

- AE1. **Covers R1, R3.** Given a file `memory/notes.md` in the tree, when the user right-clicks → Delete, then the file's icon is replaced by a spinner, the user can still click and expand other folders, and after ~400ms the file disappears from the tree.
- AE2. **Covers R4, R5, R6, R9.** Given the user has Cmd+X on `notes.md` (now rendered with dashed border + opacity 0.5), when they right-click on the `memory/` folder, the context menu shows a `Paste` item; clicking it moves the file. The dashed style disappears and the clipboard is empty.
- AE3. **Covers R10, R11, R17.** Given a tree with `events/log.md` and `memory/log.md`, when the user drags `events/log.md` onto `memory/`, the destination folder shows a focus ring during hover, and on drop the file is renamed to `log (2).md` inside `memory/`.
- AE4. **Covers R15.** Given a folder `skills/old/` containing 30 files, when the user drags `skills/old/` onto `skills/archive/`, then either every file ends up under `skills/archive/old/` or every file remains under `skills/old/` (never split across both). On partial Lambda failure the client surfaces an error toast and the tree is re-fetched from the server to recover the truth.
- AE5. **Covers R19, R20.** Given a folder `earnest-falcon-947/` containing 12 files of which 3 are pinned from a template, when the user drops that folder into `archive/`, then all 12 files move, no confirmation dialog fires, and after the move a toast reads `"Moved 12 files. 3 lost template inheritance."`
- AE6. **Covers R21, R22 (revised).** Given the workspace root, when the user right-clicks on `AGENTS.md`, the context menu shows `Cut` and `Delete` like any other file. If the user deletes `AGENTS.md`, derivation re-runs and routing rows are cleared; recreating `AGENTS.md` restores routing. No special UI affordance distinguishes canonical files from any other file.
- AE7. **Covers R5.** Given the user has cut a file, when they press Cmd+V with no folder selected and the tree focused, the file is pasted at the workspace root.

---

## Success Criteria

- An operator can reorganize a 248-file workspace into different folders without ever using "create new, copy-paste content, delete original" again.
- Deleting a file or folder gives immediate visible confirmation that the request is in flight — no double-clicks, no perceived hangs.
- All five behaviors appear in every workspace editor (agent, sub-agents, space, computer, knowledge, human) on the same day they ship. No instance lags behind.
- A folder move of 30+ files either fully succeeds or fully fails — there is no observable state where the same content exists in both source and destination.
- Pinned files moved as part of a folder do not surprise the operator by silently losing inheritance — the post-move toast tells them what happened.
- Canonical files cannot be accidentally moved or deleted by even the most aggressive drag, cut, or Backspace flurry. Server enforces this regardless of client state.
- `ce-plan` does not need to invent product behavior: clipboard scope, conflict policy, pinned-file behavior, canonical-file list, drag-and-drop scope, and atomicity guarantees are all decided here.

---

## Scope Boundaries

- Multi-select (Cmd+click / Shift+click for multiple items at once) is deferred. Single-select v1.
- Cross-tree clipboard (cut in agent A, paste in agent B in a different tab) is deferred.
- Drag-to-upload from the desktop is deferred — needs its own brainstorm covering binary support, size caps, MIME handling, and S3 multipart.
- A user-visible "this file was detached from its template" indicator on the moved file (beyond the post-move toast) is deferred.
- Rename via the new operations is unchanged from today's rename UX — this brainstorm does not redesign rename.
- Library swap to `react-arborist` or `react-complex-tree` is rejected for v1. Revisit only when multi-select or >1000-node virtualization becomes urgent.
- Virtualized rendering for very large trees (>1000 visible nodes) is out of scope; the current Radix Collapsible approach is fine at observed scale.
- Undo / "restore deleted" is out of scope. Deletion remains permanent; the loading icon plus existing confirmation dialog is the only safety net.

---

## Key Decisions

- **Build path is extend-in-place, not library swap.** The existing `FolderTree` carries product logic (inherited-update review affordances, missing/no-files badges, pinned-file 403 flow) that would cost more to re-platform than to extend. Drag-and-drop is added via `@dnd-kit/core`; keyboard via the existing `useKeyboardShortcuts` hook (extended with scoped firing) rather than adding `react-hotkeys-hook`; clipboard via per-tree state in `WorkspaceEditor`; loading state via a per-node prop. Each piece composes additively.
- **Filesystem is the agent (2026-05-23 reversal).** Canonical-file blocking was rejected at plan time. The workspace is a raw filesystem the operator can reorganize freely. Derivation pipelines must remain robust to canonical files moving or being absent.
- **Computer tab excluded (2026-05-23 product change).** The Computer concept was removed from the product. The five new capabilities ship on the 5 remaining tree instances. The Computer tab and the `target.kind === "computer"` branches in `packages/api/workspace-files.ts` are flagged for separate removal.
- **Skills folder gets no special treatment (2026-05-23 architectural direction).** The `agent_skills` database table is on the path to removal — skills will be configured entirely in the filesystem. The `skills/` folder is treated as a regular folder by the new operations. Transient orphan `agent_skills` rows from rename/move/delete operations are acceptable.
- **Server gains a `move` action; client does not compose get+put+delete.** Composing on the client risks half-moved state on network failure and turns folder moves into N×3 round-trips. A single Lambda action keeps the operation atomic at the folder level and unlocks future bulk ops.
- **Clipboard is per-tree React state.** Cross-tree and cross-tab persistence add tenant-mismatch and stale-target concerns with no clear user demand.
- **Pinned-file behavior on move is silent detachment** (matches existing edit-then-save). For folder moves, a post-move summary toast catches the bulk case where silent feels wrong.
- **Name conflicts auto-rename with `(2)`, `(3)`, …** like Finder. Avoids dialog fatigue on folder moves and is non-destructive.
- **Canonical files are blocked at both client and server.** AGENTS.md drives `agent_skills` derivation; losing it would silently break agent routing.

---

## Dependencies / Assumptions

- The current `FolderTree` and `FileTree` components are correctly identified as the single shared substrate. Verified during Phase 1.1 scan — all 6 callers go through `apps/admin/src/components/agent-builder/FolderTree.tsx`. If a planner finds a divergent tree implementation (e.g., a stale `SkillFileTree.tsx`), surfacing or consolidating it is part of planning, not a blocker for this brainstorm.
- The S3 storage model supports server-side copy efficiently enough that a 30-file folder move completes within Lambda timeout. Reasonable based on existing list/put/delete patterns; planner should verify under realistic folder sizes.
- The `acceptTemplateUpdate: true` pattern for pinned files is preserved; the new `move` action calls into the same write path with that flag implicitly set, so a moved pinned file becomes an override (consistent with the existing edit-and-save path).
- All workspace files in scope are text files small enough that S3 copy is the right primitive. Binary support is out of scope for v1.
- Workspace tree refreshes after a move via the existing list refetch path (or optimistic update); no new subscription/event plumbing is assumed.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R2][Technical] Whether the per-node loading state hooks into the existing API mutation hooks or needs new wiring on each call site. Likely a thin `useMutatingNodes` hook.
- [Affects R14, R15][Technical] Whether the new `move` action uses S3 server-side copy (`CopyObjectCommand`) per file or a higher-level batch primitive. Planner should benchmark; folder moves of ~30 files are the working assumption.
- [Affects R10, R11][Needs research] Best `dnd-kit` integration pattern for nested folder trees with auto-expand on hover. `dnd-kit/sortable` is the entry point but folder-as-drop-target with row reordering inside the same render is worth a small spike.
- [Affects R21, R22, R23][Technical] Exact home for the canonical-file allowlist (likely `packages/system-workspace` constants imported by both `apps/admin` and `packages/api/workspace-files.ts`).
- [Affects R7, R9][Technical] Whether the clipboard context provider lives at the `WorkspaceEditor` level or at the `FolderTree` level. Either works; choose based on whether the empty-area paste needs to reach the tree's clipboard state.
- [Affects R20][Technical] Whether the post-move toast text and threshold live in the move action's response (server returns `detached_pinned_count: number`) or are computed client-side from the file list returned by the server.
