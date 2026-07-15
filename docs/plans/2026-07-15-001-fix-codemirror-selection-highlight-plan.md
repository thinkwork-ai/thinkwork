---
title: Visible Text Selection in All CodeMirror Editors - Plan
type: fix
date: 2026-07-15
topic: codemirror-selection-highlight
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
linear_issue: THINK-296
---

# Visible Text Selection in All CodeMirror Editors - Plan

## Goal Capsule

- **Objective:** Selecting text in any CodeMirror editor in the ThinkWork web app shows a clearly visible selection highlight, focused or unfocused.
- **Product authority:** THINK-296 (High priority, reported by Eric Odom with before/after screenshots — the "after" reference is a standard blue-tinted selection band over the dark editor surface).
- **Open blockers:** none. Root-cause hypothesis is grounded in the code (see Sources); remaining verification is planning/implementation work.

## Product Contract

### Summary

Fix invisible text selection across every CodeMirror editor in the ThinkWork web app by making selection styling a single shared concern applied to all editor embeds, instead of the current split between a partially working house theme and bare `vscodeDark` embeds.

### Problem Frame

Users who select text in ThinkWork's code editors (e.g. the Agent Workspace file editor) get no visual feedback — the selection exists (copy works) but nothing highlights. This makes editing prompts, routines, and workspace files feel broken and error-prone: users can't see what they're about to cut, replace, or copy.

A selection-visibility override was added to the shared editor pane in June 2026 (`packages/workspace-editor/src/components/FileEditorPane.tsx`), yet the bug is still observed. The likely mechanism: CodeMirror's `drawSelection` (on by default via `basicSetup`) suppresses the native selection and paints a `.cm-selectionLayer` at negative z-index; the house theme paints `.cm-content` with an opaque `var(--muted) !important` background, which by CSS paint order sits above that layer and hides it. The three editors that don't use the shared pane rely on bare `vscodeDark` and are reported broken as well.

### Key Decisions

- **One shared selection treatment, not per-editor patches.** The fix ships as a single shared CodeMirror theme/extension (or equivalent shared styling) consumed by every editor embed, so future editors get visible selection for free. Copy-pasting the override into each of the four+ embed sites is explicitly rejected — that is how the current partial/broken state arose.
- **Match the reference look, not pixel-perfect VS Code.** The acceptance bar is the issue's second screenshot: a translucent primary/blue-tinted band over the dark surface, clearly distinguishable from the background and from the active-line/search-match tints. Exact color values are a planning/implementation choice.
- **Root-cause fix over stacking more `!important`.** Planning must verify the paint-order hypothesis and fix the layering (e.g. transparent `.cm-content`, background carried by the scroller/editor, or explicit selection-layer ordering) rather than adding stronger overrides on top of the existing ones.

### Requirements

**Selection visibility**

- R1. Dragging or keyboard-extending a selection in any CodeMirror editor in the web app renders a visible highlight over the selected text.
- R2. The highlight is visible both while the editor is focused and after focus leaves it (CodeMirror's unfocused-selection state), in the app's dark editor surfaces.
- R3. Selection visibility does not regress adjacent editor affordances: cursor, active-line styling (where enabled), search/selection-match tints, and the managed-section decorations in the workspace editor remain readable and visually distinct from the selection band.

**Coverage**

- R4. The fix applies to every CodeMirror embed in the web app. Known surfaces at brainstorm time: the shared workspace editor pane (`packages/workspace-editor/src/components/FileEditorPane.tsx`, used by Agent Workspace / Composer / scoped space+user editors) and the three direct embeds — artifacts editor (`apps/web/src/routes/_authed/_shell/artifacts.$id.tsx`), routine code editor (`apps/web/src/components/routines/RoutineCodeEditor.tsx`), and system prompt viewer (`apps/web/src/components/workbench/SystemPromptViewer.tsx`). Planning re-inventories to catch any embed this list misses.
- R5. Read-only editors (e.g. the system prompt viewer) show the same visible selection as editable ones — selecting to copy is a primary use there.

**Mechanism**

- R6. Selection styling is defined once in shared code and consumed by all embeds; no per-editor duplicated selection CSS remains after the fix.

### Acceptance Examples

- AE1. **Covers R1, R4.** Given the Agent Workspace file editor open on any file, when the user drags across a line of text, then the selected range shows a highlight band clearly distinguishable from the editor background (per the THINK-296 reference screenshot).
- AE2. **Covers R2.** Given text selected in the routines code editor, when the user clicks into another pane (editor loses focus), then the selection remains visibly highlighted (in the dimmer unfocused treatment is acceptable, but not invisible).
- AE3. **Covers R5.** Given the read-only system prompt viewer, when the user selects a paragraph to copy it, then the selection is visibly highlighted before and during the copy.
- AE4. **Covers R3.** Given a workspace file with managed-section decorations, when the user selects text inside a managed section, then both the selection band and the managed-section affordance remain distinguishable.

### Scope Boundaries

- Web app only. The mobile app has no CodeMirror editors; nothing to do there.
- No broader editor-theme redesign — syntax token colors, gutter styling, and the vscodeDark-vs-house-theme follow-up noted in `FileEditorPane.tsx` stay out of scope.
- Light-mode support is bounded by what the editors do today: the editor surfaces are dark-themed regardless of app theme, so the fix targets visibility on those dark surfaces; a themed light editor variant is not in scope.

### Outstanding Questions

- **Deferred to Planning:** Confirm the paint-order root cause empirically (opaque `.cm-content` vs `.cm-selectionLayer` z-index) and choose the layering fix; decide where the shared selection theme lives (`packages/workspace-editor` export vs `@thinkwork/ui` vs app-level CSS) and the exact highlight color tokens; complete the embed inventory (R4).

### Sources

- THINK-296 issue description with before/after screenshots.
- `packages/workspace-editor/src/components/FileEditorPane.tsx:19-52` — house editor theme: opaque `var(--muted) !important` backgrounds on `.cm-content`/`.cm-scroller` plus the June 2026 selection override (`&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection`) that the issue shows is not effective.
- Direct `vscodeDark` embeds with no selection override: `apps/web/src/routes/_authed/_shell/artifacts.$id.tsx:749`, `apps/web/src/components/routines/RoutineCodeEditor.tsx:60`, `apps/web/src/components/workbench/SystemPromptViewer.tsx:64`.
- No embed passes `drawSelection` explicitly; `@uiw/react-codemirror`'s `basicSetup` enables it by default, which suppresses native selection rendering (unverified assumption to confirm in planning: default-on `drawSelection` in the installed `@uiw/react-codemirror@^4.25.9`).
