# Knowledge Graph — Definitions view cleanup

**Date:** 2026-06-06
**Scope:** Lightweight — bounded UI cleanup, no data/API changes
**Surface:** Settings → Knowledge Graph (spaces/desktop)

## Summary

The Knowledge Graph settings page has two sub-tabs, **Data** and **Definitions**. The
Definitions tab drifted from the Data tab's layout: it nests its own bordered header
("Ontology Definitions v1"), right-aligns its toggle group, shows redundant counts, has no
search, and renders its list as stacked multi-line rows instead of a table. This work makes
Definitions match Data's toolbar, and gives both tabs the same left-justified
`[Search] [toggle group]` row.

No backend, GraphQL, or data-model changes. Presentation only.

## Where this lives

The view is **already merged to `main`** but is **not** on the current working branch
(`codex/github-free-deployment-plan`, which predates it). Implementation must branch from
`main` (or a worktree off `origin/main`), not the current checkout.

- `apps/spaces/src/components/settings/SettingsKnowledgeGraph.tsx` — page wrapper (`p-6`),
  page title + description, and the top-level **Data / Definitions** tab toggle. Renders
  `KnowledgeGraphExplorer`.
- `apps/spaces/src/components/settings/knowledge-graph/KnowledgeGraphExplorer.tsx` — the
  explorer. Holds the shared toolbar row (currently Data-only), the Data table/graph views,
  and the `OntologyContractPanel` (Definitions) with `OntologyEntityList` /
  `OntologyRelationshipList` / `OntologyMappingList`.

## Current vs. desired

Today the **Data** toolbar (`KnowledgeGraphExplorer.tsx:303–348`) renders a search input plus
a Table/Graph toggle, but the toggle is pushed to the far right with `ml-auto`. The
**Definitions** toolbar slot is empty for `mode === "definitions"`; instead
`OntologyContractPanel` (`:465–550`) draws its own `border-b` header with the "Ontology
Definitions" label + `v1` badge + a right-aligned Entities/Links/Maps toggle carrying counts,
and the lists below render each item as a stacked multi-line `<div>` (name, type badge,
description, aliases).

Desired: both tabs share one left-justified toolbar — `[Search input] [toggle group]` —
sitting directly under the page title with the explorer's existing `gap-3` spacing. No nested
bordered sub-header. Definitions renders a real `DataTable`.

## Requirements

1. **Definitions list → proper `DataTable`.** Replace the stacked multi-line row renderers
   (`OntologyEntityList`, `OntologyRelationshipList`, `OntologyMappingList`,
   `KnowledgeGraphExplorer.tsx:552–653`) with the shared `DataTable` (`@thinkwork/ui`), one
   value per column, single-line cells (truncate on overflow). Use the same `DataTable` props
   pattern as the Data tab (`scrollable`, `allowHorizontalScroll={false}`,
   `tableClassName="table-fixed"`). Column sets per view:
   - **Entities:** Name · Type (`broadType` badge) · Description · Aliases
   - **Links:** Name · Source · Target · Aliases
   - **Maps:** Subject · Kind · Vocabulary · External URI

2. **Remove the "Ontology Definitions" label.** Delete the Database-icon + "Ontology
   Definitions" header block (`:494–506`).

3. **Left-justify the Definitions toggle group.** Remove `ml-auto` from the Entities/Links/Maps
   `ToggleGroup` (`:515`) so it aligns left in the shared toolbar.

4. **Match Data's header padding.** Move the Definitions toggle group out of the nested
   `OntologyContractPanel` bordered header (`border-b … pb-3` / `pt-2`, `:494/:533`) and into
   the explorer's shared toolbar row (`:303`), which currently renders only for `mode === "data"`.
   This removes the extra top gap/border visible above the Definitions content and makes the
   toolbar sit at the same offset as Data's.

5. **Remove the counts on the Definitions toggle group.** `Entities (15)` → `Entities`,
   `Links (20)` → `Links`, `Maps (5)` → `Maps` (`:518, :524, :527`). (The Data tab's
   Table/Graph toggle has no counts and is unaffected.)

6. **Add a search box to Definitions.** Same pattern/styling as Data's search
   (`:306–330`) — placeholder, leading search icon, clear (`X`) button. Filters the currently
   selected Definitions view (entities/links/maps) client-side over the already-loaded
   arrays. Suggested fields: name, description/label, and aliases.

7. **Place the Data Table/Graph toggle next to the search input (left-justified).** Remove
   `ml-auto` from the Data view toggle (`:337`) so the toolbar reads `[Search] [Table/Graph]`
   left-to-right, matching the Definitions toolbar.

## Resulting shared toolbar

Both tabs: a single left-justified row `[Search input] [toggle group]` directly under the
page title.

- **Data** → toggle = Table / Graph
- **Definitions** → toggle = Entities / Links / Maps (no counts)

## Out of scope

- Backend, GraphQL queries/resolvers, or ontology data model.
- The top-level Data / Definitions tab toggle in `SettingsKnowledgeGraph.tsx` (unchanged).
- The Config panel, Thread Ingest sheet, Entity sheet, and drop-diagnostics views.
- Graph (canvas) rendering behavior.

## Assumptions / minor decisions

- **`v1` version badge** (`:502–506`): default is to keep it, relocated inline next to the
  left-justified Definitions toggle group, since the active ontology version is useful context.
  Drop it if it reads as clutter — low stakes either way.
- **Definitions search scope:** filters within the active sub-view only (not across all three
  at once), mirroring how Data search scopes to the entity list.
- **Maps "Subject" column** reuses the existing `subjectLabels` lookup (`:481–490`) for the
  display value.

## Success criteria

- Definitions and Data show an identical toolbar shape: left-justified `[Search] [toggle]`
  at the same vertical offset under the page title; no extra gap/border above Definitions.
- Definitions content is a `DataTable` with each field in its own single-line column; no
  stacked multi-line rows.
- No "Ontology Definitions" label; no counts on the Entities/Links/Maps toggle.
- Typing in the Definitions search filters the visible rows; the clear button resets it.
- Empty/loading/error states preserved for each Definitions view.

## Next step

Hand to `/ce-plan` (or `/ce-work` directly — this is small) on a branch off `main`.

```
file: docs/brainstorms/2026-06-06-knowledge-graph-definitions-cleanup-requirements.md
```
