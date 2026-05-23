---
date: 2026-05-23
status: active
type: feat
title: Workspace filetree — loading states, clipboard, drag-and-drop
origin: docs/brainstorms/2026-05-23-workspace-filetree-cut-paste-drag-requirements.md
---

# feat: Workspace filetree — loading states, clipboard, drag-and-drop

## Summary

Add five UX capabilities to the shared workspace file tree (`apps/admin/src/components/agent-builder/FolderTree.tsx` + `apps/admin/src/components/ai-elements/file-tree.tsx`): per-node loading icons during deletes and moves, Cmd+X/Cmd+V clipboard with a cut visual state, intra-tree drag-and-drop via `@dnd-kit/core`, name-conflict auto-rename, and a post-move toast when pinned files detach from their templates. Backed by a new atomic `move` action on `/api/workspaces/files` that performs S3 copy + delete in a single Lambda invocation and walks the prefix for folder moves.

Ships across two PRs: a server-first inert PR that lands the `move` action with full test coverage but no UI wiring, followed by a UI PR that adds `@dnd-kit/core`, the clipboard hook, the per-node loading prop, the scoped keyboard shortcuts, and the post-move toast. All five capabilities then appear simultaneously across the five tree instances that use the shared `WorkspaceEditor` (the Computer tab is excluded — see origin §Apply everywhere).

---

## Problem Frame

The workspace tree is now the primary surface for operators to reorganize agent context — capabilities, identity, memory, skills, sub-agent folders. The current `FolderTree` supports create, rename, and delete via right-click but cannot move a file or folder once it exists; reorganizing a subtree means recreating every file at the new path and deleting the originals one at a time. Deletion has no visual feedback during the network round-trip, so users double-click or assume failure. Six tree instances (now five, with Computer dropped) all render the same `FolderTree`, so any gap shows up everywhere.

The brainstorm (`docs/brainstorms/2026-05-23-workspace-filetree-cut-paste-drag-requirements.md`) resolved the product shape: single-tree React-state clipboard, intra-tree drag only, auto-rename on conflict, silent pinned-file detach on single moves with a bulk toast on folder moves. Three planning-time decisions further sharpened scope: (1) the canonical-file block was reversed — the filesystem is treated as raw and the operator can move/delete anything, with derivation handling the consequences; (2) the Computer workspace tab is excluded because the Computer concept is being retired; (3) the `skills/` folder gets no special DB-coupled handling because the `agent_skills` table is on the path to removal.

---

## Origin Requirement Trace

Carried forward verbatim from the brainstorm where applicable. Reversed items reference the in-line `(revised 2026-05-23)` notes in the brainstorm.

- **R1–R3** (per-node loading): covered by U5.
- **R4–R9** (clipboard): covered by U6, U7.
- **R10–R13** (drag-and-drop): covered by U7.
- **R14–R16** (server `move` action): covered by U1, U2.
- **R17–R18** (auto-rename on conflict): covered by U1, U2.
- **R19** (pinned file silent detach on single move): covered by U1 (server allows pinned-file move without 403).
- **R20** (post-move toast on folder detach): covered by U8.
- **R21–R23** (canonical-file blocking): **reversed at plan time** — see brainstorm revisions. No implementation work; derivation must remain robust (existing behavior).
- **R24** (apply to all five remaining tree instances): covered by U7 + U8 verification.

Acceptance Examples AE1–AE5, AE7 carry forward as test scenarios on U5–U8. AE6 is reversed and removed.

---

## Scope Boundaries

### In scope

- Server `move` action on `/api/workspaces/files` covering single-file and folder moves, atomic per Lambda invocation
- All five UX capabilities applied to the five workspace tree instances: agent workspace tab, agent sub-agents tab, space workspace tab, user knowledge route, human personalization route
- `.gitkeep` sentinel preservation on emptied source folders post-move (see learning `docs/solutions/design-patterns/gitkeep-materialization-s3-empty-folders-2026-05-13.md`)
- `derive-agent-skills` re-run on source and destination when a move touches `AGENTS.md` or `**/SKILL.md`
- Manifest regeneration on source and destination prefixes after every move (see learning `docs/solutions/workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md`)

### Deferred to Follow-Up Work

- **Computer tab + ComputerTask queue + EFS-sidecar Lambda + ECS infrastructure removal.** The Computer concept is retired (see memory `project_computer_concept_removed`). Touchpoints to remove later: the Computer route under `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx`, the `target.kind === "computer"` branches in `packages/api/workspace-files.ts`, the EFS sidecar handler at `packages/api/src/handlers/workspace-files-efs.ts`, and any ECS task definitions. Out of scope here; track as separate effort.
- **Skills database removal.** `agent_skills` table + `/Capabilities/Skills` admin route to be removed; skills configured entirely in filesystem (see memory `project_skills_db_removal_direction`). Out of scope; gets its own brainstorm.
- Multi-select (Cmd/Shift+click)
- Cross-tree clipboard (persistent or cross-tab)
- Desktop-drag-to-upload (binary support, MIME, size caps, malware scanning)
- Library swap to `react-arborist` or `react-complex-tree`
- Virtualization for >1000-node trees
- Undo / restore-deleted
- Adding `@thinkwork/workspace-defaults` as an `apps/admin` dependency (no longer needed once R21–R23 are reversed)

### Outside this product's identity

- Treating the workspace as anything other than a raw filesystem. Per the 2026-05-23 reversal, there are no "system-managed" files at the UI layer.

---

## Key Technical Decisions

- **Extend the existing custom tree; do not adopt `react-arborist`.** `FolderTree` carries bespoke product logic (inherited-update review affordances, missing/no-files badges, pinned-file 403 flow) that would cost more to re-platform than to extend. Confirmed against `apps/admin/src/components/agent-builder/FolderTree.tsx` and `apps/admin/src/components/ai-elements/file-tree.tsx`.
- **Server gains a `move` action; client does not compose `get + put + delete`.** Client composition risks half-moved state on network failure and turns folder moves into 3N round-trips. A single Lambda action keeps the operation atomic at the folder level. The `move` action lives in `packages/api/workspace-files.ts` alongside the existing `list/get/put/delete` switch.
- **Reuse `workspace-copy.ts` patterns for the folder walk.** `packages/api/src/lib/workspace-copy.ts` already pairs `ListObjectsV2Command` (via `listPrefix` in `workspace-files.ts` lines 1698–1723) with `CopyObjectCommand` per object. The new `handleMove` mirrors this pattern and adds the source-prefix delete pass.
- **Use `@dnd-kit/core@^6.3.1` + `@dnd-kit/utilities`. Skip `@dnd-kit/sortable`.** Sortable is for reorderable lists; we only need folder-as-droppable, which is plain `useDroppable`. Bundle cost ≈ 23 kB min+gz. Native HTML5 DnD was considered and rejected (no keyboard sensor, no ARIA announcements, ugly ghost images).
- **Extend the existing `useKeyboardShortcuts` hook with scoped firing rather than adding `react-hotkeys-hook`.** Saves a dependency; the existing hook at `apps/admin/src/hooks/useKeyboardShortcuts.ts` already excludes inputs/textareas/contenteditable. Add a `scopeRef` argument so cut/paste/delete hotkeys only fire when the tree (or a descendant) holds focus. Hand-roll the `metaKey || ctrlKey` cross-platform mapping (one helper).
- **Clipboard state lives in `WorkspaceEditor`, not a new Context provider.** Matches the existing `useState`-driven pattern. The `key`-based remount of `WorkspaceEditor` (lines 189–203) already implements R7 (navigating away clears clipboard) for free.
- **Per-node mutation state via prop, not internal state.** Add `mutatingPaths: Set<string>` to `FolderTreeProps` (or `mutationStateFor(path)` lambda — mirrors the existing `sourceFor`/`updateAvailableFor` pattern). `FileTreeFolder`/`FileTreeFile` receive an `isMutating?: boolean` prop that swaps the icon for a `Loader2` spinner. Extends the vendored AI-Elements primitives per the pattern in `docs/solutions/design-patterns/ai-elements-vendor-extend-composability-gap-2026-05-13.md`.
- **No new canonical-file allowlist.** Per the 2026-05-23 reversal, all files are moveable. The server `move` handler does not import `CANONICAL_FILE_NAMES` for blocking purposes. Existing `isBuiltinToolWorkspacePath` (line 930) is *not* a canonical-file gate and remains in place for its actual purpose.
- **`.gitkeep` policy:** the handler skips `.gitkeep` files from the source-prefix delete pass if they are the sole remaining object, OR re-emits a fresh `.gitkeep` after the delete completes if the source folder becomes empty. The simpler implementation is the second — always re-emit `.gitkeep` at the source prefix if `ListObjectsV2` returns empty after delete. Conflict detection (the auto-rename logic) ignores `.gitkeep` when comparing destination contents.
- **Derive triggers on AGENTS.md / SKILL.md moves.** Source and destination must both be re-derived. `derive-agent-skills.ts` already runs on every workspace `put` and `delete`; the `move` handler runs it twice (once per side) only when a touched path matches `AGENTS.md` or `**/SKILL.md`. For all other paths, derivation is skipped to keep moves fast.
- **No ComputerTask queue path.** Computer targets return 400 `"move not supported for computer targets"` if reached. The UI never invokes `move` against a Computer target because the Computer tab is being retired and is excluded from R24.
- **Tests are pure-function + handler integration only.** Clipboard logic and the canonical-file-free conflict resolver are testable as pure functions. The server `handleMove` integrates into the existing `workspace-files-handler.test.ts` suite (62 KB; `aws-sdk-client-mock` + `vi.hoisted` DB queue patterns). Drag-and-drop UI interactions are NOT automatically tested in v1 (would require adding `@testing-library/react` + `jsdom`, out of scope per the synthesis).

---

## System-Wide Impact

- **Lambda bundle.** `packages/api/workspace-files.ts` gains a `handleMove` function. Lambda zip rebuilds via `pnpm build:lambdas` or `bash scripts/build-lambdas.sh graphql-http` per `CLAUDE.md`. No new SDK adoption — `CopyObjectCommand` is already imported in adjacent files.
- **Admin bundle.** Adds two runtime deps to `apps/admin/package.json`: `@dnd-kit/core@^6.3.1`, `@dnd-kit/utilities@^3.x`. ≈ 23 kB min+gz combined. No new test deps.
- **Codegen.** No GraphQL schema change. `pnpm --filter @thinkwork/admin codegen` is NOT required.
- **Manifest + derivation pipelines.** `regenerateManifest` and `deriveAgentSkills` are called from the new `move` action on the relevant code paths. Both are existing functions; no new infrastructure.
- **Deployment.** Server PR merges through the `main` → Deploy pipeline (per the project rule "GraphQL Lambda deploys via PR" — same applies to the workspace-files Lambda). No direct `aws lambda update-function-code` invocations.
- **No database migration.** The `move` action does not add schema. The `agent_skills` rows are read/written by existing derivation code unchanged.
- **No new cross-tenant surface.** Auth + target resolution reuses the existing `resolveCallerFromAuth` + `resolve<X>Target` chain in `workspace-files.ts`.

---

## High-Level Technical Design

Directional sketch of the `handleMove` Lambda action. **This illustrates the intended approach and is directional guidance for review, not implementation specification.** The implementing agent should treat it as context, not code to reproduce.

```
handleMove(deps, target, fromPath, toFolder):
  isFolder = listPrefix(target.key(fromPath) + "/").length > 0
  if isFolder:
    return handleFolderMove(deps, target, fromPath, toFolder)
  else:
    return handleSingleFileMove(deps, target, fromPath, toFolder)

handleSingleFileMove:
  destBase = basename(fromPath)
  destPath = resolveCollision(toFolder + "/" + destBase, listPrefix(toFolder + "/"))
  S3.CopyObject(source = target.key(fromPath), dest = target.key(destPath))
  S3.DeleteObject(target.key(fromPath))
  regenerateManifest(target)
  if touchesAgentsOrSkillMd(fromPath) or touchesAgentsOrSkillMd(destPath):
    deriveAgentSkills(target)
  return { ok: true, destPath, detachedPinnedCount: isPinned(fromPath) ? 1 : 0 }

handleFolderMove:
  sourcePrefix = target.key(fromPath) + "/"
  destFolderName = basename(fromPath)
  destPrefix = resolveCollisionFolder(toFolder + "/" + destFolderName, listPrefix(toFolder + "/"))
  objects = listPrefix(sourcePrefix)
  detachedPinned = 0
  for obj in objects:
    relPath = obj.Key.slice(sourcePrefix.length)
    S3.CopyObject(source = obj.Key, dest = target.key(destPrefix) + "/" + relPath)
    if isPinned(sourcePrefix + relPath): detachedPinned += 1
  for obj in objects:
    S3.DeleteObject(obj.Key)
  // re-emit sentinel at source if empty (it will be, after the deletes)
  S3.PutObject(target.key(fromPath) + "/.gitkeep", Body = "")
  regenerateManifest(target)  // both prefixes covered
  if anyTouchesAgentsOrSkillMd(objects):
    deriveAgentSkills(target)
  return { ok: true, destPath: destPrefix, movedCount: objects.length, detachedPinnedCount: detachedPinned }

resolveCollision(candidate, siblingKeys):
  if candidate not in siblingKeys (ignoring .gitkeep): return candidate
  for n in 2..∞: if candidate-with-(n) not in siblingKeys: return candidate-with-(n)
```

Auto-rename collision resolver applies the same `(2)`, `(3)`, … suffix logic to file basenames (preserving extension: `notes.md` → `notes (2).md`) and folder names (`old` → `old (2)`).

UI side: clipboard state in `WorkspaceEditor` is a single `clipboardItem: { path: string; kind: "file" | "folder" } | null`. Cut writes; paste reads + clears on success. Drag-and-drop bypasses the clipboard entirely and goes straight to a `move` call.

---

## Implementation Units

### U1. Server `handleMove` — single-file path

**Goal:** Add the `move` action to the workspace-files Lambda's dispatcher, implementing the single-file path with auto-rename on conflict. Folder-path handling lands in U2.

**Requirements:** R14, R16, R17, R18 (file half).

**Dependencies:** none.

**Files:**
- `packages/api/workspace-files.ts` (extend `WRITE_ACTIONS` set, add `case "move":` branch in dispatcher, implement `handleMove` for files only; folder branch left as 501 or thrown stub)
- `packages/api/src/__tests__/workspace-files-handler.test.ts` (extend with single-file move tests — see Test scenarios below)

**Approach:**
- Validate body: `fromPath: string`, `toFolder: string`. Both must pass `cleanWorkspacePath` (existing helper). `toFolder` may be `""` (root).
- Resolve target via the existing target-resolution chain. Reject `target.kind === "computer"` with 400 `"move not supported for computer targets"`.
- Detect folder vs file by listing `target.key(fromPath) + "/"` — if any objects exist, treat as folder (defer to U2's stub for now; have U1 return 501 explicitly when the prefix list is non-empty).
- For files: read sibling list of `toFolder` (filtering `.gitkeep`), compute the collision-resolved destination, `CopyObjectCommand` + `DeleteObjectCommand`, return `{ ok: true, destPath, detachedPinnedCount }`.
- Pinned-file detection reuses `isPinnedWorkspacePath` from `packages/api/src/lib/pinned-versions.ts` — increments `detachedPinnedCount` but does NOT 403. This is the silent detach behavior per R19.
- Call `regenerateManifest(target)` on success.
- If `fromPath` or destination matches `AGENTS.md` or `**/SKILL.md`, call `deriveAgentSkills(target)`.

**Patterns to follow:**
- Existing `case "delete":` and `case "put":` branches in `packages/api/workspace-files.ts:1611-1667` for dispatcher shape, auth gating, and write-action guarding.
- `packages/api/src/lib/workspace-copy.ts` for the `CopyObjectCommand` invocation idiom.

**Test scenarios** (extend `packages/api/src/__tests__/workspace-files-handler.test.ts`):
- Covers AE2 (paste of `notes.md` into `memory/` folder, server side): given `target.kind === "agent"` and `fromPath = "notes.md"`, `toFolder = "memory"`, response is `{ ok: true, destPath: "memory/notes.md" }`; assertions: CopyObject called once with correct keys, DeleteObject called once with old key, manifest regen invoked.
- Single-file move with destination collision: `memory/` already contains `notes.md`; given `fromPath = "events/notes.md"`, `toFolder = "memory"`, response `destPath === "memory/notes (2).md"`; `notes.md` extension preserved.
- Single-file move with extension-aware suffix on multi-conflict: destination has `notes.md` + `notes (2).md`; new arrival becomes `notes (3).md`.
- Single-file move where `fromPath` is pinned (per `isPinnedWorkspacePath`): succeeds, response includes `detachedPinnedCount: 1`, no 403.
- Cross-tenant target: agent belongs to a different tenant; returns 404 (matches existing handler behavior at line 1588).
- Auth failure: caller is not tenant admin (and not apikey); returns 403.
- Computer target rejection: `target.kind === "computer"`; returns 400 with the documented error string.
- Same-folder no-op move: `fromPath = "notes.md"`, `toFolder = ""` (root); destination resolves to `notes.md`; conflict detection identifies this as same key — returns 400 `"source and destination identical"` (do not silently overwrite).
- Path traversal: `fromPath = "../etc/passwd"`; rejected by `cleanWorkspacePath` (existing behavior; spot-check that the new action exercises the same validation).
- AGENTS.md move at root: triggers `deriveAgentSkills` exactly once (assert mock call count).
- Sub-agent `SKILL.md` move: triggers `deriveAgentSkills` exactly once.
- Plain-file move (not AGENTS.md, not SKILL.md): does NOT trigger `deriveAgentSkills`.

**Verification:** Single-file move via direct fetch against a dev deployment moves the file in S3 and the file shows up under its new path in subsequent `listFiles`. No 5xx on any test path.

---

### U2. Server `handleMove` — folder path

**Goal:** Implement the folder-walk branch of `handleMove` with prefix list, per-object copy, batch delete, `.gitkeep` re-emit, and combined detach-count return.

**Requirements:** R14, R15, R16, R17, R18 (folder half), R19 (folder detach side), R20 (server provides count for toast).

**Dependencies:** U1.

**Files:**
- `packages/api/workspace-files.ts` (replace the U1 stub for the folder branch; reuse `listPrefix`)
- `packages/api/src/__tests__/workspace-files-handler.test.ts` (extend with folder move tests)

**Approach:**
- Detect folder branch: when `listPrefix(target.key(fromPath) + "/").length > 0`.
- Compute destination folder name with collision resolution against sibling folders at `toFolder` (folder collision detection lists `toFolder + "/" + destFolderName + "/"`).
- Loop the objects, build per-object dest keys preserving relative paths, issue `CopyObjectCommand` per object. Accumulate `detachedPinnedCount` by checking `isPinnedWorkspacePath` on each source-relative path.
- After all copies succeed, loop the source objects with `DeleteObjectCommand`. (Two passes — copy-all-then-delete-all — so a copy failure mid-flight does NOT leave a half-deleted source. Failed copy → throw → no deletes run → source is intact.)
- Re-emit `.gitkeep` at the now-empty source prefix.
- Call `regenerateManifest(target)` once (covers both prefixes implicitly because the manifest is per-target).
- If any moved object matches `AGENTS.md` or `**/SKILL.md`, call `deriveAgentSkills(target)` once.
- Atomicity guarantee per R15: copy-all-then-delete is the strongest atomicity Lambda can offer without S3 transactions. On copy failure mid-walk, no source objects have been deleted yet, so the user can retry. On delete failure mid-walk, the source is partially intact — surface as an error response with a `partiallyDeleted: true` flag so the client knows to refetch the file list rather than trust the optimistic view.

**Patterns to follow:**
- `packages/api/src/lib/workspace-copy.ts` for the per-object copy loop.
- `packages/api/src/lib/spaces/template-migration.ts:165` for another folder-walk copy example.
- `listPrefix` at `packages/api/workspace-files.ts:1698-1723` for pagination.

**Test scenarios:**
- Covers AE4 (folder of 30 files moves atomically): given a folder with 30 mocked objects, response `{ ok: true, movedCount: 30, destPath }`; assertions: 30 `CopyObjectCommand` calls in flight before any `DeleteObjectCommand`; on a forced copy failure on object #15, zero `DeleteObjectCommand` calls fired and the response is a thrown error.
- Covers AE5 (folder with 12 files, 3 pinned): response `{ movedCount: 12, detachedPinnedCount: 3, destPath }`. (The toast UI consumes this in U8.)
- Folder move with destination folder-name collision: `toFolder` already contains a folder `old/`; new arrival lands at `old (2)/`; nested child paths preserve their relative names (e.g. `old (2)/sub/note.md`, not `old (2)/old/sub/note.md`).
- Folder move where source contains a `.gitkeep`: after move, source prefix re-emits a fresh `.gitkeep` (assert `PutObjectCommand` was called with the source-prefix key); destination's nested `.gitkeep` is preserved as part of the bulk copy.
- Folder move that empties the source: ListObjectsV2 against the source after the delete loop returns only the re-emitted `.gitkeep`.
- Folder move touching AGENTS.md (the agent's root AGENTS.md is inside the moved folder): triggers `deriveAgentSkills` exactly once.
- Folder move touching multiple SKILL.md files (sub-agent folder containing N SKILL.md files): triggers `deriveAgentSkills` exactly once (not N times).
- Folder move with zero AGENTS.md / SKILL.md: does NOT trigger `deriveAgentSkills`.
- Delete-phase failure simulation: copy succeeds, the 5th delete throws; response includes `partiallyDeleted: true` and a non-2xx HTTP status; manifest regen NOT called (to avoid baking in inconsistent state); the client is expected to refetch.

**Verification:** Folder move via direct fetch against dev moves all child files in S3, leaves a `.gitkeep` sentinel at the empty source, and the move-derived counts (`movedCount`, `detachedPinnedCount`) match observed S3 state.

---

### U3. Admin API client — `moveWorkspaceFile` (inert)

**Goal:** Add the client-side `moveWorkspaceFile` function in `apps/admin/src/lib/workspace-files-api.ts` and the corresponding `agentBuilderApi.moveFile` wrapper in `apps/admin/src/lib/agent-builder-api.ts`. Not yet called from any component — verifiable by import only.

**Requirements:** Supports R14 from the client side.

**Dependencies:** U1.

**Files:**
- `apps/admin/src/lib/workspace-files-api.ts` (add `moveWorkspaceFile(target, fromPath, toFolder): Promise<MoveResult>`)
- `apps/admin/src/lib/agent-builder-api.ts` (re-export as `moveFile`)
- `apps/admin/src/lib/__tests__/workspace-files-api.test.ts` if it exists, or co-located unit test for URL/body shape

**Approach:**
- Mirror the existing `deleteWorkspaceFile` / `putWorkspaceFile` shape. POST to `/api/workspaces/files` with `{ action: "move", target, fromPath, toFolder }`.
- Define a TypeScript result type matching the server response: `{ ok: true; destPath: string; movedCount?: number; detachedPinnedCount: number; partiallyDeleted?: boolean }` or `{ ok: false; error: string }`.

**Patterns to follow:**
- `deleteWorkspaceFile` at `apps/admin/src/lib/workspace-files-api.ts:39-60`.

**Test scenarios:**
- URL/body shape: calling `moveWorkspaceFile({ kind: "agent", agentId: "abc" }, "notes.md", "memory")` posts to `/api/workspaces/files` with body containing `action: "move"`, `agentId: "abc"`, `fromPath: "notes.md"`, `toFolder: "memory"`.
- Response shape: success path returns the parsed JSON; error path throws with the server error string.

**Verification:** TypeScript compile passes. Existing unit test pattern (pure function over fetch mock) covers shape.

---

### U4. Server tests pass end-to-end + PR1 ship-readiness

**Goal:** Confirm the server-first PR is independently mergeable: all tests pass, build succeeds, no dead-code lint failures, the new client function is exported but unused (no UI consumers).

**Requirements:** Cross-cutting — ensures PR1's inert-shipping contract holds.

**Dependencies:** U1, U2, U3.

**Files:** none new — verification only.

**Approach:**
- Run `pnpm --filter @thinkwork/api test`, `pnpm --filter @thinkwork/admin test`, `pnpm --filter @thinkwork/api typecheck`, `pnpm --filter @thinkwork/admin typecheck`, `pnpm build:lambdas`.
- Verify `moveWorkspaceFile` is exported but not called from any component (`rg "moveWorkspaceFile|moveFile" apps/admin/src --type ts` should show only the export + tests).

**Test scenarios:** none new — this is a verification unit, not a feature unit.

Test expectation: none — verification unit; covered by U1, U2, U3 test suites running green.

**Verification:** PR1 opens against `main` with the server `move` action live but no UI consumer. Hand-curl-test against the dev stage moves real files. The Deploy job runs and the new Lambda handles `action: "move"` requests in production.

---

### U5. Per-node loading state

**Goal:** Replace folder/file icons with a `Loader2` spinner per node while a delete or move targeting that node is in flight. State is per-node, not global; other tree interactions remain responsive (R3).

**Requirements:** R1, R2, R3.

**Dependencies:** U4 (PR1 merged so the API is available — though this unit doesn't yet call `move`).

**Files:**
- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` (introduce `mutatingPaths: Set<string>` state; thread into `FolderTree` props)
- `apps/admin/src/components/agent-builder/FolderTree.tsx` (accept `mutatingPaths` prop or `mutationStateFor(path)` lambda; pass per-node `isMutating` into `FileTreeFolder` / `FileTreeFile`)
- `apps/admin/src/components/ai-elements/file-tree.tsx` (add `isMutating?: boolean` prop to `FileTreeFolder` and `FileTreeFile`; when true, render `Loader2` with `animate-spin` instead of the standard icon)
- `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.ts` (extend to assert the spinner-substitution prop is forwarded correctly via `buildWorkspaceTree` + props plumbing)

**Approach:**
- `WorkspaceEditor`'s existing `handleDeletePath` currently sets `deletingPath: string | null`. Replace with `mutatingPaths: Set<string>` so multiple paths can mutate concurrently (the existing single-path state is fine for deletes today because only one delete fires at a time, but the new move flow may stack moves; promote to a Set).
- `add(path)` before the API call; `delete(path)` in the `finally` block (success or failure).
- `FolderTree` receives `mutatingPaths` and passes `isMutating={mutatingPaths.has(node.path)}` to the rendered primitive.
- The primitive substitutes the `Loader2` icon (lucide-react, already installed) with a `className="animate-spin"`. The node label and surrounding row remain interactive (other nodes' context menus still work).

**Patterns to follow:**
- The vendor-extend pattern at `docs/solutions/design-patterns/ai-elements-vendor-extend-composability-gap-2026-05-13.md`. Extend props on the vendored primitive rather than positioning an overlay.
- The existing `sourceFor(path)` / `updateAvailableFor(path)` props on `FolderTreeProps` (lines 152-153) for per-node lookup APIs.

**Test scenarios:**
- Covers AE1 (delete shows spinner). Pure-function tests of `buildWorkspaceTree` cannot cover the spinner substitution (it's a render-time concern with no React Testing Library). The asserted behavior is the prop plumbing: given `mutatingPaths = new Set(["memory/notes.md"])`, the props passed to the descendant `FileTreeFile` include `isMutating={true}` for that path and `isMutating={false}` for siblings.
- Manual UI verification on the dev stage covers the visual outcome.

**Verification:** Delete a file on the dev stage; observe the spinner replaces the file icon for the duration of the request; after ~400ms the file is gone. Concurrent deletes on two different files both spin independently.

---

### U6. Clipboard hook, cut visual, paste context menu, scoped keyboard shortcuts

**Goal:** Implement the cut/paste UX surface: Cmd+X cuts the focused item with a dashed/muted visual, Cmd+V pastes to the selected folder (or root if none selected), context menus include `Paste` when the clipboard is non-empty. Keyboard shortcuts fire only when the tree (not the file editor) has focus.

**Requirements:** R4, R5, R6, R7, R8, R9.

**Dependencies:** U4 (server `move` action available).

**Files:**
- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` (introduce `clipboardItem: { path; kind } | null` state; implement `cut`, `paste`, `clearClipboard` handlers; bind `useKeyboardShortcuts` to the tree's focus scope)
- `apps/admin/src/components/agent-builder/FolderTree.tsx` (accept `clipboardItem` + handlers; pass `isCut={node.path === clipboardItem?.path}` into primitives; conditionally render `Paste` in folder + root context menus)
- `apps/admin/src/components/ai-elements/file-tree.tsx` (add `isCut?: boolean` prop to `FileTreeFolder` / `FileTreeFile`; when true, apply `opacity-50` + dashed border via `border border-dashed border-muted-foreground/40`)
- `apps/admin/src/hooks/useKeyboardShortcuts.ts` (extend to accept an optional `scopeRef: RefObject<HTMLElement>` — hotkeys fire only when `document.activeElement` is the scope element or a descendant)
- `apps/admin/src/hooks/__tests__/useKeyboardShortcuts.test.ts` (new — pure-function tests for the scope predicate)

**Approach:**
- Clipboard is a single React state slot in `WorkspaceEditor`. Cut overwrites; only one item at a time (R8). The `key`-based `WorkspaceEditor` remount clears it on tab/agent switch (R7).
- `paste` calls `agentBuilderApi.moveFile(target, clipboardItem.path, selectedFolderPath ?? "")`. On success: clear clipboard, refetch file list (the existing `fetchFiles()` pattern), if `detachedPinnedCount === 0` show no toast (for single-file moves only — folder-detach toast is U8's concern); if it's a single pinned file detach, no toast per R20's "no toast for single-file moves" carve-out.
- On paste failure: keep clipboard intact (R9), show `toast.error` with the server error.
- Context-menu wiring: extend the existing folder context menu (`FolderTree.tsx:235-285`) and file context menu (`322-333`) with `Cut` and conditional `Paste` items. The root-area "empty space" right-click also shows `Paste` — needs a wrapper `<ContextMenu>` around the tree's empty-area background (the existing FolderTree doesn't have one today; add it).
- `useKeyboardShortcuts` scope check: the hook already excludes `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable`. Add a `scopeRef` parameter — when provided, the predicate also requires `document.activeElement === scopeRef.current || scopeRef.current?.contains(document.activeElement as Node)`. This makes Cmd+X/Cmd+V/Backspace fire only when the tree has focus, not when an unrelated button on the page is focused. Hand-roll the `metaKey || ctrlKey` mapping (existing hook already does this in `meta: true` semantics — just confirm cross-platform behavior).
- `FolderTree` exposes a `treeRef: RefObject<HTMLDivElement>` to its parent; `WorkspaceEditor` passes it to `useKeyboardShortcuts` as the scope.

**Patterns to follow:**
- Existing `useKeyboardShortcuts` usage in `apps/admin/src/components/CommandPalette.tsx`.
- Radix ContextMenu composition in `apps/admin/src/components/agent-builder/FolderTree.tsx:235-285`.
- The vendor-extend pattern (same as U5) for adding `isCut` to the primitive.

**Test scenarios:**
- Covers AE2 (Cmd+X then Paste flow): pure-function test of the clipboard reducer — `cut("notes.md", "file")` → state has clipboardItem; `paste("memory")` → calls `moveFile("notes.md", "memory")`; on resolved success, state has `clipboardItem: null`.
- Covers AE7 (Cmd+V at root with no folder selected): reducer test — `selectedFolderPath = null`, `paste()` → calls `moveFile(clipboardItem.path, "")`.
- `useKeyboardShortcuts` scope predicate: given `scopeRef.current = treeElement` and `document.activeElement = childOfTree`, `shouldFire === true`; with `document.activeElement = buttonOutsideTree`, `shouldFire === false`.
- `useKeyboardShortcuts` ignores when target is editable: existing behavior — covered by existing test if present; if not, add a regression test.
- Replace-on-second-cut (R8): `cut("a.md", "file")` then `cut("b.md", "file")` → state holds only `b.md`.
- Failed-paste retains clipboard (R9): when `moveFile` rejects, `clipboardItem` is unchanged after the rejection settles.

**Verification:** Manual on dev stage — focus the tree, Cmd+X on a file, see dashed border + opacity drop, right-click another folder → Paste item appears, click it, file moves, dashed border disappears. Repeat with empty-area right-click (no folder selected) to verify root paste.

---

### U7. Drag-and-drop via `@dnd-kit/core`

**Goal:** Add intra-tree drag-and-drop. Drag a file or folder onto a folder row; on hover for >600ms the target folder auto-expands; drop completes the move atomically via the server `move` action.

**Requirements:** R10, R11, R12, R13.

**Dependencies:** U4 (server move), U5 (loading state — drag-in-flight should show spinner on the dragged node), U6 (clipboard pattern — drag bypasses clipboard but reuses the same `moveFile` call).

**Files:**
- `apps/admin/package.json` (add `@dnd-kit/core@^6.3.1`, `@dnd-kit/utilities@^3.x`)
- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` (wrap the tree in `<DndContext>`; sensors include `PointerSensor` with `activationConstraint: { distance: 4 }` and `KeyboardSensor`; `onDragEnd` calls `moveFile`)
- `apps/admin/src/components/agent-builder/FolderTree.tsx` (each row uses `useDraggable`; folder rows additionally use `useDroppable`; the FolderTree empty-area wrapper is also a droppable with id `"__root__"`)
- `apps/admin/src/components/agent-builder/useAutoExpandOnHover.ts` (new — small hook that runs a `setTimeout` while `isOver` is true and triggers expand)
- `apps/admin/src/components/ai-elements/file-tree.tsx` (extend primitive props to accept drag handles / data attributes from `useDraggable.attributes` and `useDraggable.listeners`)

**Approach:**
- `DndContext` lives in `WorkspaceEditor`. `onDragEnd({ active, over })` reads `active.id` (source path), `over.id` (destination folder path or `"__root__"`), and invokes the same `paste`-style call from U6 with `toFolder = over.id === "__root__" ? "" : over.id`.
- `collisionDetection={closestCenter}` — more forgiving than `rectIntersection` for short folder rows.
- Per-node `useDroppable` is added to folder rows only (file rows are not drop targets — R10 says "onto folders").
- The `useAutoExpandOnHover` hook is per-folder-node: watches the droppable's `isOver` and, after 600ms of continuous hover, calls the expansion callback. Cancels on `isOver → false`.
- Drag visual: dragged node uses `CSS.Translate.toString(transform)` from `@dnd-kit/utilities`. The empty drop-target visual is a focus ring on the folder row (`data-over` attribute → CSS).
- Block desktop file drop: the tree's root element has `onDragOver={e => { /* let dnd-kit own it */ }}` and `onDrop={e => { /* check if e.dataTransfer.types includes 'Files' and noop */ }}`. R13 — desktop drops are no-ops, not uploads.
- Accessibility: override `accessibility.announcements` on `DndContext` with tree-specific copy (`"Moved file X into folder Y."`, `"Drag canceled."`) and `screenReaderInstructions.draggable` describing tree semantics.

**Patterns to follow:**
- `@dnd-kit/core` documentation example for `useDraggable` + `useDroppable` (see external research artifact — folder-as-target pattern, no `@dnd-kit/sortable` needed).
- Vendor-extend pattern for forwarding drag attributes through `FileTreeFolder` / `FileTreeFile`.

**Test scenarios:**
- Covers AE3 (drag with conflict auto-rename): pure-function test of the drag-end reducer — `onDragEnd({ active: { id: "events/log.md" }, over: { id: "memory" } })` calls `moveFile("events/log.md", "memory")`. The auto-rename behavior is the server's responsibility (covered in U1/U2 tests).
- Drop on root: `over: { id: "__root__" }` calls `moveFile(activePath, "")`.
- Drop nowhere: `over === null` → no `moveFile` call.
- `useAutoExpandOnHover` timer: pure-function test using fake timers — given a folder that's collapsed and `isOver` toggles true, after 600ms `expand()` is called; if `isOver` toggles false before 600ms, `expand()` is not called.
- `useAutoExpandOnHover` no-op on already-expanded folders: given `expanded = true`, `expand()` is not called even after 600ms of hover.

**Verification:** Manual on dev stage — drag `events/log.md` onto `memory/`. Folder row shows focus ring during drag-over. Drop; file moves. Drag a folder onto a collapsed folder; hover ~600ms; target expands so you can drop deeper. Drag a file onto empty space at the bottom of the tree; file moves to root. Drag a file from the desktop onto the tree; nothing happens.

---

### U8. Post-move toast for pinned-file detach + 5-route verification

**Goal:** Surface the bulk pinned-file detach summary as a single `toast.success` after a folder move when `detachedPinnedCount > 0` (R20). Verify all five tree instances inherit the new behavior automatically because they share `WorkspaceEditor` + `FolderTree`.

**Requirements:** R20, R24.

**Dependencies:** U5, U6, U7.

**Files:**
- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` (after a successful `moveFile` resolves, inspect `response.detachedPinnedCount` and `response.movedCount`; if `detachedPinnedCount > 0` AND `movedCount > 1`, fire `toast.success(\`Moved ${movedCount} files. ${detachedPinnedCount} lost template inheritance.\`)`)
- `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.toast.test.ts` (new — pure-function test of the toast-decision predicate)

**Approach:**
- Toast logic is a pure function of the server response: `shouldEmitDetachToast({ movedCount, detachedPinnedCount }) => string | null`. Returns the toast string when `movedCount > 1 && detachedPinnedCount > 0`, otherwise null. Extract to a small util in `apps/admin/src/lib/workspace-tree-actions.ts` for testability.
- Wire the toast emission in `WorkspaceEditor`'s post-move success branch (used by both paste and drop paths).
- For single-file moves where `movedCount === 1` and the file was pinned, no toast fires — matches R20's carve-out.

**Patterns to follow:**
- Sonner usage in `apps/admin/src/components/agent-builder/AppSyncSubscriptionProvider.tsx` and elsewhere — `toast.success(string)`.

**Test scenarios:**
- Covers AE5 (folder move with 12 files, 3 pinned → toast fires with the exact string): `shouldEmitDetachToast({ movedCount: 12, detachedPinnedCount: 3 }) === "Moved 12 files. 3 lost template inheritance."`.
- Single-file pinned move → no toast: `shouldEmitDetachToast({ movedCount: 1, detachedPinnedCount: 1 }) === null`.
- Folder move with no pinned files → no toast: `shouldEmitDetachToast({ movedCount: 20, detachedPinnedCount: 0 }) === null`.
- Folder move with 1 file (edge): `shouldEmitDetachToast({ movedCount: 1, detachedPinnedCount: 0 }) === null`.

**5-route verification:**
- Smoke-test on dev stage by visiting each WorkspaceEditor host and confirming the new behavior:
  1. Agent workspace tab — `routes/_authed/_tenant/tenant-agents/$agentId.tsx` → `TenantAgentWorkspaceTab.tsx`
  2. Agent sub-agents tab — `TenantAgentSubAgentsTab.tsx`
  3. Space workspace tab — `apps/admin/src/components/spaces/SpaceDetailChrome.tsx`
  4. User knowledge — `routes/_authed/_tenant/knowledge/user.tsx`
  5. Human personalization — `routes/_authed/_tenant/users/$userId.tsx` (or wherever this lives — repo research flagged this path)
- For each: cut a file, paste it elsewhere, drag a file to a folder, observe the spinner during the move, observe the toast on a folder-detach scenario.
- The Computer route (`routes/_authed/_tenant/computers/$computerId.tsx`) is excluded; the server-side 400 protects against accidental invocation.

**Verification:** All five routes show the new behavior with no per-route code changes (because they all pass through the shared `WorkspaceEditor` → `FolderTree`). The Computer tab's move/cut/paste/drag invocations are blocked at the server.

---

## Phased Delivery

**PR 1 (server-first, inert):** U1, U2, U3, U4. Lands the `move` action + tests, exports the client function but does not wire it into any UI. Independently verifiable via vitest + direct curl. Mergeable to `main` on its own.

**PR 2 (UI wiring):** U5, U6, U7, U8. Adds `@dnd-kit/core`, the per-node loading state, the clipboard + paste UI, the drag-and-drop, the toast. All five tree instances inherit simultaneously. Depends on PR 1 being merged so the `move` action is live in dev.

---

## Dependencies / Assumptions

- `packages/api/src/lib/workspace-copy.ts` patterns are stable; reusing `CopyObjectCommand` per object inside one Lambda invocation completes for typical folder sizes (≤ ~100 files) well within the 15-minute Lambda timeout. Very large folders (hundreds+ files) could approach the ceiling — flagged in synthesis call-outs; not handled in v1.
- `derive-agent-skills.ts` is robust to AGENTS.md absence (the new `move` can leave `AGENTS.md` deleted temporarily during a single-file move where the user is reorganizing it). Verified during research — derivation clears routing rows gracefully when the file is missing.
- `regenerateManifest` is idempotent and safe to call after any write.
- The vendored `FileTree` primitives at `apps/admin/src/components/ai-elements/file-tree.tsx` are owned by this project (not blocked by upstream sync) and can be extended with new typed props.
- `@dnd-kit/core@6.3.1` works under React 19 + Vite + Strict Mode. Research validated this; if Strict Mode double-render issues surface, the documented fix (PR #788) is already in 6.3.1.
- The Computer tab is not actively being used by tenants in dev/prod such that the v1 exclusion creates user-visible regression. (Memory `project_computer_concept_removed` indicates the concept is dead.)
- `apps/admin` does not need `@thinkwork/workspace-defaults` as a dependency for this work (the canonical-file allowlist plan was dropped — R21-R23 reversed).
- No existing `apps/admin` consumer relies on the `deletingPath: string | null` shape that U5 replaces with `mutatingPaths: Set<string>` (verified during research — the variable is local to `WorkspaceEditor`).

---

## Risk Analysis & Mitigation

- **Risk: Folder-move atomicity edge case — delete-phase partial failure.** Mitigation: copy-all-then-delete-all ordering ensures a copy failure leaves the source intact. A delete-phase failure leaves a partial source; the server returns `partiallyDeleted: true` and the client refetches. Surfaced as test scenario in U2.
- **Risk: Moving `AGENTS.md` clears routing rows until recreated.** Mitigation: documented as a known consequence; derivation is robust to absence. Operators see the same recovery flow as deleting `AGENTS.md` today.
- **Risk: Lambda timeout on very large folder moves.** Mitigation: out of scope for v1; surfaced in synthesis call-outs. If hit in practice, a follow-up adds chunked moves or async task pipeline.
- **Risk: `@dnd-kit/core` 6.3.1 React 19 incompatibility.** Mitigation: research confirmed working; PR-stage smoke test on dev catches any Strict-Mode issues before merge. Pin exact version in `package.json`.
- **Risk: Keyboard shortcut conflicts with browser defaults inside the tree (Cmd+V interfering with paste inside an editor that happens to be focused).** Mitigation: the scoped `useKeyboardShortcuts` only fires when the tree element holds focus, and the hook already excludes `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable`. CodeMirror's contentEditable focus is correctly excluded.
- **Risk: `.gitkeep` re-emit at source creates a phantom empty folder the user thought they moved.** Mitigation: documented in `docs/solutions/design-patterns/gitkeep-materialization-s3-empty-folders-2026-05-13.md` — this is the project's existing convention. Future cleanup could prune empty `.gitkeep`-only folders, but that's out of scope.
- **Risk: Auto-rename suffix collides with itself (`notes (2).md` already exists and we generate another `notes (2).md`).** Mitigation: the resolver iterates `n` from 2 upward until unique, so it produces `notes (3).md`. Tested in U1.

---

## Outstanding Questions

### Deferred to Implementation

- [Affects U2][Technical] Whether `regenerateManifest` should be called once per move or once per side (source + destination). The manifest is per-target — one call covers both prefixes. Confirm by reading `regenerateManifest` and aligning the call.
- [Affects U5][Technical] Whether to keep `mutatingPaths` as a single `Set<string>` or distinguish mutation kinds (`Map<string, "deleting" | "moving">`). The visual is identical (spinner) so a Set is simpler; revisit if any per-kind UI emerges.
- [Affects U6, U7][Technical] Best-effort handling of the in-flight optimistic refresh: today's `WorkspaceEditor` uses a `loadRequestId` ref to ignore stale list responses. The new move + drop flow may need a similar `mutationRequestId` to ignore stale mutation completions if the user navigates away. Surface during implementation if observable bug appears.
- [Affects U7][Needs research] Exact CSS for the drop-target focus ring inside `FileTreeFolder` — `data-over` attribute styled by Tailwind utility classes vs `[data-over=true]:ring-2` selector. Implementer's call.
- [Affects U8][Technical] Toast wording when only some moves in a folder operation succeed (partial-delete case). Default: show the `partiallyDeleted` error toast instead of the success toast. Confirm in code.

---

## Open Follow-Ups (Tracked Separately)

These are deliberately NOT in scope for this plan; tracked here so reviewers see the broader trajectory:

- `/ce-brainstorm`: remove `agent_skills` table + `/Capabilities/Skills` admin route (per memory `project_skills_db_removal_direction`).
- Cleanup PR: retire the Computer workspace tab + `target.kind === "computer"` server branches + EFS sidecar Lambda + ECS task definitions (per memory `project_computer_concept_removed`).
- Future: multi-select (Cmd/Shift+click), cross-tree clipboard, desktop-drag-upload, virtualization, undo.
