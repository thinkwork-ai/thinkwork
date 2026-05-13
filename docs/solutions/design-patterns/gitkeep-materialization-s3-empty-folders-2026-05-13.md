---
title: "Materialize empty folders on S3-backed storage by writing a filtered `.gitkeep` sentinel"
date: 2026-05-13
category: design-patterns
module: apps/admin/agent-builder/workspace-editor
problem_type: design_pattern
component: frontend_stimulus
severity: low
applies_when:
  - Adding "New Folder" or "Create empty container" UX on S3-backed (or git-backed) storage
  - Building tree views that must represent zero-leaf folders
  - Any FOG-pure workspace where folder identity needs a file marker
tags:
  - s3
  - gitkeep
  - file-tree
  - empty-folder
  - sentinel-file
  - cleanup-arc-2026-05-13
---

# Materialize empty folders on S3-backed storage by writing a filtered `.gitkeep` sentinel

## Context

S3 has no concept of empty folders — only objects exist, and "folder" paths are inferred from object keys via the delimiter. Git has the same constraint: empty directories aren't versioned. When admin/dev tooling needs to let a user create an intentionally-empty folder in a UI tree backed by S3 (or R2, GCS, any object store), there's no direct API call to "mkdir." The workaround is to write a single zero-byte `.gitkeep` (or `.s3keep`) object inside the path so it materializes on `listFiles`.

PR #1207 added a "New Folder" affordance to the workspace editor in `apps/admin`. The folder needs to appear in the tree immediately after creation, even before any real files are added.

## Guidance

On folder-create, `putFile` a zero-byte `.gitkeep` at `<folder-path>/.gitkeep`. In the tree-build pass, filter `.gitkeep` from leaf rendering so users never see it. Don't offer per-file delete on `.gitkeep` through the UI — deleting it makes the folder disappear from `listFiles` since the object store has no other objects under that prefix.

## Why This Matters

The `.gitkeep` trick is the only way to materialize an empty container in an object-store-backed tree. The key gotchas are display and deletion:

- **Display:** if `.gitkeep` leaks into the rendered tree, users see a confusing zero-byte file they didn't create.
- **Deletion:** if users can delete the keepfile, the folder vanishes (S3 deletion is per-object — removing the last object under a prefix removes the inferred folder). Worse, deleting a real file in the folder may also vanish the folder if it was the only object.

The keepfile **survives** the user adding and deleting real files later, because it's an independent object. That's the whole point: the folder is durable as long as the keepfile sits there.

## When to Apply

- Any "create empty container" UX in admin/dev tooling backed by S3, R2, GCS, or any other object store
- Git repos that need preserved empty directories (the original `.gitkeep` use case)
- Anywhere a tree UI is derived from a flat object listing with delimiter inference

## Examples

**This session — folder creation in WorkspaceEditor (PR #1207):**

```ts
// apps/admin/src/components/agent-builder/WorkspaceEditor.tsx
const handleCreateFolder = async () => {
  const raw = newFolderPath.trim().replace(/^\/+|\/+$/g, "");
  if (!raw) return;
  if (raw.includes("..") || raw.includes("\\")) return;
  setCreatingFolder(true);
  try {
    await agentBuilderApi.putFile(stableTarget, raw + "/.gitkeep", "");
    await fetchFiles();
    setShowNewFolderDialog(false);
    setNewFolderPath("");
  } catch (err) {
    console.error("Failed to create folder:", err);
  } finally {
    setCreatingFolder(false);
  }
};
```

**The matching leaf filter** in the tree builder:

```ts
// apps/admin/src/components/agent-builder/FolderTree.tsx (buildWorkspaceTree)
for (let i = 0; i < parts.length; i++) {
  const part = parts[i];
  const isLast = i === parts.length - 1;
  if (part === ".gitkeep" && isLast) continue;  // hide keepfiles
  // ... normal tree building
}
```

**The guardrails currently holding:**

- Leaf filter hides keepfiles from the tree.
- No per-file delete affordance in the tree itself (folder delete via tree was removed in PR #1207).
- Editor-pane trash only deletes the currently-open file, and the tree doesn't open `.gitkeep` files.

## Related

- (auto memory [claude]) [[project_agents_folder_ui_only_decision]] — synthetic `agents/` folder is UI fabrication, not storage; the gitkeep pattern is the storage-side companion that keeps **real** folders durable
- (auto memory [claude]) [[project_s3_event_orchestration_decision]] — S3 is the orchestration substrate; folder semantics matter
- (synthetic agents/ + manifest regen context) [docs/solutions/workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md](../workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md)
- (workspace-as-filesystem-truth invariant) [docs/solutions/architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md](../architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md)
- PR #1207 — folder creation in WorkspaceEditor (this session)
