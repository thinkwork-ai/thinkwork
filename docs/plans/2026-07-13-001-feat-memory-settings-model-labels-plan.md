---
title: Memory Settings Model Labels - Plan
type: feat
date: 2026-07-13
topic: memory-settings-model-labels
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
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

## Planning Contract

### Product Contract preservation

Product Contract unchanged.

### Key Technical Decisions

- **KTD1 — Lift the title row into `KnowledgeModelTab`; sub-views become content-only.** Today each sub-view (`KnowledgeGraphTab`, `IdentityList`, `ResolutionQueue`) renders its own `SettingsPageTitle` inside a `p-6` wrapper, and `KnowledgeModelTab` renders the toggle group on a separate row above them. To satisfy R2/R3 with the toggle group *staying in place* while titles swap, `KnowledgeModelTab` owns a single title row — a small view → `{title, description}` map rendered via `SettingsPageTitle` — and the three sub-views drop their own `SettingsPageTitle` calls. The alternative (passing the toggle group down into each sub-view) would remount the toggle on every switch, losing keyboard focus mid-interaction and duplicating the layout in three places.
- **KTD2 — Render the toggle group through `SettingsPageTitle`'s existing `badge` slot.** `SettingsPageTitle` (`apps/web/src/components/settings/SettingsContent.tsx`) already renders `badge` inline immediately after the title text — exactly R2's "positioned after the title text". No new layout primitive; the `actions` slot (far right) is the wrong slot per the screenshot.
- **KTD3 — Titles come from a single map in `KnowledgeModelTab`:** Definitions → "Definitions" / "Inspect approved terms and relationship definitions." (R4); Identity and Resolution Queue keep their current title/description strings verbatim, just relocated. Sub-view padding is adjusted so content alignment is unchanged after the title moves out (the sub-views keep their own scroll/error/loading structure).
- **KTD4 — Aria-label becomes "Model view"** on the toggle group (R5), matching the renamed tab. No other accessibility strings name the old terms.

### Implementation Units

### U1. Rename the "Knowledge Model" tab to "Model"

- **Goal:** The fourth tab in the Memory page header reads "Model", still targeting `/settings/memory/ontology`.
- **Requirements:** R1.
- **Dependencies:** none.
- **Files:** `apps/web/src/components/settings/SettingsMemoryHome.tsx`, `apps/web/src/components/settings/SettingsMemoryHome.test.tsx`.
- **Approach:** Change the tab entry to `{ to: ONTOLOGY, label: "Model" }`. Two source-asserting tests pin the old string (`publishes the Memory tabs into the page header`, `keeps the Knowledge Model tab on the ontology route`) — update both assertions to the new label. Update the component's doc comment if it still says "Knowledge Model" where it now means the "Model" tab label (the historical-route explanation stays).
- **Test scenarios:**
  - Source assertion: `SettingsMemoryHome.tsx` contains `{ to: ONTOLOGY, label: "Model" }` and no longer contains `label: "Knowledge Model"`.
  - Existing route-mount and redirect assertions in `SettingsMemoryHome.test.tsx` still pass unchanged (route stays `/settings/memory/ontology`).
- **Verification:** `npx vitest run src/components/settings/SettingsMemoryHome.test.tsx` green from `apps/web`; tab visibly reads "Model" in the browser flow below.

### U2. Title-row toggle group + "Definitions" heading

- **Goal:** The Definitions / Identity / Resolution Queue toggle group sits inline after the active sub-view's title, the title/description swap with the selected view, and the Definitions view is headed "Definitions" with a de-jargoned description.
- **Requirements:** R2, R3, R4, R5.
- **Dependencies:** none (independent of U1; shares a PR — see Checkpoint PR boundary).
- **Files:** `apps/web/src/components/settings/knowledge-model/KnowledgeModelTab.tsx`, `apps/web/src/components/settings/knowledge-graph/KnowledgeGraphTab.tsx`, `apps/web/src/components/settings/knowledge-graph/KnowledgeGraphExplorer.test.tsx`, `apps/web/src/components/settings/knowledge-model/IdentityList.tsx`, `apps/web/src/components/settings/knowledge-model/ResolutionQueue.tsx`.
- **Approach:** Per KTD1–KTD4: `KnowledgeModelTab` renders one `SettingsPageTitle` whose `title`/`description` come from the view map and whose `badge` is the existing `ToggleGroup` (aria-label "Model view"). `KnowledgeGraphTab`, `IdentityList`, and `ResolutionQueue` drop their own `SettingsPageTitle` and keep only content; their outer padding is rebalanced so the content column doesn't shift. Definitions map entry carries the R4 strings. Keep the toggle group's on-screen position visually stable while titles of different lengths swap beneath it (e.g., a minimum width on the title container sized to the longest title, "Resolution Queue") so the control the user just clicked doesn't jump.
- **Test scenarios:**
  - Source assertions (new or extended test alongside the existing convention): `KnowledgeModelTab.tsx` renders `SettingsPageTitle` with the `ToggleGroup` in the `badge` slot; aria-label is "Model view"; the Definitions entry is titled "Definitions" and its description does not contain "ontology"; `KnowledgeGraphTab.tsx` / `IdentityList.tsx` / `ResolutionQueue.tsx` no longer render `SettingsPageTitle`.
  - Rewrite the `mounts Ontology as definitions only` case in `KnowledgeGraphExplorer.test.tsx` — its assertions against `KnowledgeGraphTab.tsx` pin the old heading (`toContain("Ontology")`, `toContain("approved ontology terms")`, `not.toContain("Definitions")`) and all three are inverted by this unit. Rewrite them to assert the tab is content-only: renders `mode="definitions"` and no `SettingsPageTitle`. Explorer-source assertions in the same file stay unchanged.
- **Verification:** Full `pnpm --filter @thinkwork/web test` + `typecheck` green; browser flow below shows the toggle on the title row across all three views.

### Verification Contract

Verification runs in a real browser against deployed dev (`/settings/memory`), per THINK-116 discipline — pixels gate UI claims.

1. **Tab rename flow (U1):** Sign in → Settings → Memory. The header tab strip reads Memory / Wiki / KBs / **Model**. Click "Model" → URL is `/settings/memory/ontology` and the Knowledge Model surface loads. A direct deep link to `/settings/memory/ontology` lands on the same tab, selected.
2. **Title-row toggle flow (U2):** On the Model tab, the heading row reads **Definitions** with the Definitions / Identity / Resolution Queue toggle group inline after the title text — no toggle row above the heading. The description under "Definitions" contains no "ontology" wording. Click **Identity** → title/description swap to the Identity strings, toggle group stays in place on the title row, identity list content renders below. Click **Resolution Queue** → same swap behavior with queue content. Click back to **Definitions** → term definitions table renders as before.
3. **Accessibility check (U2):** Inspect the toggle group element — `aria-label="Model view"`.
4. **Regression check:** The Memory tab's refresh/raw-units header actions still render on the Memory tab and not on the Model tab.

### Checkpoint PR boundary

One PR covering U1 + U2 (grouped intentionally): both units touch the same small settings surface, verification is a single browser pass over one page, and neither unit has independent rollback value — splitting would double review/CI overhead for a ~5-file presentation change with no risk isolation benefit.

### Rollout notes

- Pure presentation-layer change in `apps/web`; no schema, GraphQL, terraform, or runtime impact. Ships through the normal merge-to-main pipeline; web deploys to dev on merge (desktop canaries tag separately and are unaffected).
- Instant rollback = revert the squash commit.

### Risks

- **Source-asserting test drift (low):** `SettingsMemoryHome.test.tsx` greps source strings; missing one assertion fails CI loudly rather than silently — low risk, caught pre-merge.
- **Layout regression on narrow widths (low):** the title + toggle share a row; `SettingsPageTitle` already handles a `badge` with `min-w-0` truncation on the title side. Verify visually during the browser pass.
- **Toggle-position jitter (low, mitigated in U2):** the three titles differ in width, so an unconstrained inline badge would shift horizontally on every view switch. U2's approach stabilizes it with a fixed-minimum title width; the browser pass confirms the toggle doesn't move when switching views.

### Definition of Done

- U1 and U2 implemented and merged to `main` via one squash-merged PR with lint, typecheck, test, and format checks green.
- All four Verification Contract flows pass in a real browser against deployed dev.
- R1–R5 all observably true on `/settings/memory/ontology`.
