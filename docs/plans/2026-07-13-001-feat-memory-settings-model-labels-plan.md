---
title: Memory Settings Model Labels - Plan
type: feat
date: 2026-07-13
topic: memory-settings-model-labels
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
linear: THINK-278
---

# Memory Settings Model Labels - Plan

## Goal Capsule

- **Objective:** Tighten the operator-facing labeling and layout of the Memory settings surface in `apps/web`: the "Knowledge Model" tab becomes "Model", the sub-view toggle group moves onto the title row, and the "Ontology" heading becomes "Definitions".
- **Product authority:** THINK-278 issue description and its annotated screenshot of `/settings/memory/ontology`; LFG mode — no-preference decisions recorded in Key Decisions below.
- **Open blockers:** none.

## Product Contract

### Summary

Three label/layout changes to the Memory settings page (`/settings/memory/*`) in the web app: rename the top-level "Knowledge Model" tab to "Model", render the Definitions / Identity / Resolution Queue toggle group inline on the same row as the active sub-view's title instead of on its own row above it, and retitle the "Ontology" sub-view heading to "Definitions".

### Key Decisions

- **The route stays `/settings/memory/ontology`.** Only the visible label changes; existing deep links and the route file are untouched. Renaming the URL is a separate, riskier change with no product ask behind it.
- **The "Definitions" heading intentionally matches the "Definitions" toggle item.** The screenshot shows the toggle group landing beside the title, so the selected toggle and the heading name the same thing — that redundancy is the requested design, not an accident to smooth over.
- **The heading's description drops the "ontology" jargon.** With the heading renamed, a description that still leads with "ontology terms" would reintroduce the term the rename removes. Reworded to plain "terms and relationship definitions" language (autonomous, easily reversible).

### Requirements

- R1. The Memory settings page's top-level tab strip (Memory / Wiki / KBs / Knowledge Model) labels its fourth tab "Model"; its target route remains `/settings/memory/ontology`.
- R2. The Definitions / Identity / Resolution Queue toggle group renders on the same horizontal row as the active sub-view's title, positioned after the title text — it no longer occupies its own row above the title.
- R3. Each of the three sub-views (Definitions, Identity, Resolution Queue) keeps its own title and description; switching the toggle swaps both the title row's text and the content below, with the toggle group staying in place on the title row.
- R4. The Definitions sub-view's heading reads "Definitions" (was "Ontology"), with a description that no longer uses the word "ontology" (e.g., "Inspect approved terms and relationship definitions.").
- R5. Accessibility labels that name the old terms (the toggle group's "Knowledge model view" aria-label) are updated to match the new naming.

### Scope Boundaries

- Web app only (`apps/web`); the mobile app has no equivalent Knowledge Model surface to update.
- No route, GraphQL, database, or runtime naming changes — "ontology" identifiers in queries, types, and file names stay as-is; this is a presentation-layer rename.
- The content of the three sub-views (term tables, identity list, resolution queue) is unchanged.

### Sources

- Tab strip and label: `apps/web/src/components/settings/SettingsMemoryHome.tsx` (tab defined at the `{ to: ONTOLOGY, label: "Knowledge Model" }` entry; source-asserting tests in `SettingsMemoryHome.test.tsx`).
- Toggle group and sub-view host: `apps/web/src/components/settings/knowledge-model/KnowledgeModelTab.tsx`.
- "Ontology" heading: `apps/web/src/components/settings/knowledge-graph/KnowledgeGraphTab.tsx`; sibling sub-view titles in `knowledge-model/IdentityList.tsx` and `knowledge-model/ResolutionQueue.tsx`.
