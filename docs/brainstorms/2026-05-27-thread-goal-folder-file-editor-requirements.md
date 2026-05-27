---
date: 2026-05-27
topic: thread-goal-folder-file-editor
---

# Thread Goal Folder File Editor

## Problem Frame

The Thread info panel currently shows a compact Goal Files summary, but that summary does not explain enough or give users a useful way to inspect the portable folder state behind a workflow. For Goal-driven thread workflows, users need a first-class way to open and edit the actual files that define the Goal folder, while still being able to inspect the parent Space workspace that governs the thread.

---

## Actors

- A1. Operator/admin: Reviews and adjusts workflow context, artifacts, handoffs, and decisions before or during a client workflow.
- A2. End user: Uses the thread as the primary workflow surface and occasionally needs visibility into the files behind the agent's work.
- A3. Agent: Reads and writes portable folder files as durable workflow state.

---

## Key Flows

- F1. Open thread files
  - **Trigger:** A user clicks the Files icon in the thread header.
  - **Actors:** A1, A2
  - **Steps:** The thread transcript view is replaced by a file explorer/editor view. The initial scope is the current thread's Goal folder. The user selects files from the tree and reads or edits them in the editor.
  - **Outcome:** The user can inspect the full Goal folder state without opening a separate admin page or reading a compressed summary.
  - **Covered by:** R1, R2, R3, R4

- F2. Switch to Space workspace
  - **Trigger:** A user is in Files mode and switches scope from Goal Folder to Space Workspace.
  - **Actors:** A1, A2
  - **Steps:** The file explorer reloads to the parent Space workspace. The user can inspect the Space-level context, rules, and workflow files, then switch back to the Goal folder.
  - **Outcome:** Users can distinguish thread-local workflow state from Space-level operating context.
  - **Covered by:** R3, R5, R6

---

## Requirements

**Thread workspace mode**
- R1. The thread header must include a small Files icon button using the Tabler `IconFiles` symbol.
- R2. Clicking the Files button must toggle between the normal thread view and a full file explorer/editor view that replaces the current Thread Detail content area.
- R3. Files mode must default to the current thread's Goal folder, not the parent Space workspace.
- R4. The file explorer/editor experience should match the admin workspace editor experience closely enough that users recognize it as the same tool surface: file tree, selected file header, editor, save/discard behavior, and folder/file operations where supported.
- R5. Files mode must include an explicit scope switch between Goal Folder and Space Workspace.
- R6. Switching scope must make the active file tree/editor clearly represent the selected scope so users do not confuse Goal-local state with Space-level context.

**Info panel cleanup**
- R7. The compact Goal Files section must be removed from the Thread info panel once the Files mode is available.
- R8. The info panel should remain focused on workflow status, progress, review, attachments, and thread metadata.

**Portability and folder-is-the-agent**
- R9. The Goal Folder view must expose the durable files that make the workflow portable, such as progress, decisions, handoffs, artifacts, and other workflow-produced files.
- R10. The UI should reinforce that files are the source of durable workflow context, not a secondary debug artifact.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a user is viewing a Customer Onboarding thread, when they click the Files icon in the thread header, the transcript/composer area is replaced by a file tree and editor opened against that thread's Goal folder.
- AE2. **Covers R5, R6.** Given the user is in Files mode viewing the Goal Folder, when they switch to Space Workspace, the tree reloads to the parent Space files and the active scope label changes visibly.
- AE3. **Covers R7, R8.** Given a thread has Goal files, when the info panel is open, it does not show the old compact Goal Files list; file inspection is handled by Files mode.

---

## Success Criteria

- Users understand where to inspect and edit workflow files without needing the compressed Goal Files section.
- The thread page clearly separates conversation/workflow execution from portable folder inspection.
- Planning can reuse or extract the existing admin workspace editor surface without inventing a different file editing UX for Spaces.

---

## Scope Boundaries

- Do not build a second lightweight file preview inside the info panel.
- Do not replace the Space Detail workspace page; the thread Files mode is for in-thread workflow context.
- Do not add export/import functionality in this version.
- Do not add collaborative editor presence, comments, or file-level review workflows in this version.

---

## Key Decisions

- Files mode opens the Goal Folder by default: The thread is the active workflow unit, so thread-local state should be the first file surface.
- Space Workspace is a switch inside Files mode: Space context matters, but it should not displace Goal-local workflow state as the default.
- Remove compact Goal Files: Once a full file editor exists, the summary becomes noisy and underspecified.

---

## Dependencies / Assumptions

- The existing admin workspace editor is the desired UX baseline for the tree/editor experience.
- Planning should verify the cleanest way to share that editor between apps, including whether extraction to a package is warranted before or during implementation.
- Planning should verify the current API surface for reading and writing thread Goal folder files; if only Space workspace targets are currently supported by the shared workspace editor API, a Goal-folder target may be required.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3, R9][Technical] Which existing storage/API path should back the thread Goal Folder target?
- [Affects R4][Technical] What is the smallest clean extraction boundary for reusing the admin workspace editor in Spaces?
- [Affects R4][Technical] Which file operations are supported for Goal folders in v1: read/edit only, or create/rename/delete/move as well?

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
