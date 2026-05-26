---
title: "fix: Reorder component nav and rename Company Brain to Memory"
type: fix
status: completed
date: 2026-05-26
---

# fix: Reorder component nav and rename Company Brain to Memory

## Overview

Update the docs Components navigation so it reads Agents, Spaces, Threads, then Memory. Keep existing `/concepts/knowledge/` routes stable, but change visible labels and nearby explanatory copy so readers see Memory as the component name instead of Company Brain.

---

## Problem Frame

The Components sidebar currently presents Threads, Spaces, Agents, then Company Brain. The requested reader path is Agents first, then Spaces, Threads, and Memory. The naming is also drifting: the concept pages still teach "Company Brain" as the component label, while current positioning prefers Memory as the visible term for the context layer that carries retained facts, compiled pages, knowledge bases, and source routing.

---

## Requirements Trace

- R1. The Components sidebar order must be Agents, Spaces, Threads, Memory.
- R2. The visible Components label "Company Brain" must become "Memory" while preserving current docs URLs.
- R3. The Memory concept docs should use Memory as the primary component term and retain route-compatibility notes where `/concepts/knowledge/` or `/knowledge` paths remain.
- R4. Adjacent docs and landing-page links should avoid sending readers back to "Company Brain" as the primary component name.
- R5. The docs site must build and the affected navigation must render in-browser.

---

## Scope Boundaries

- Do not rename route directories or slugs such as `concepts/knowledge` or `applications/admin/knowledge`.
- Do not change application UI routes or product behavior.
- Do not overhaul the full Memory documentation architecture beyond the targeted visible rename and consistency sweep.
- Do not rename GraphQL/API contracts that intentionally use `context`, `knowledge`, or `query_context`.

---

## Context & Research

### Relevant Code and Patterns

- `docs/astro.config.mjs` statically defines the Starlight sidebar. The Components group currently orders Threads, Spaces, Agents, Company Brain.
- `docs/src/content/docs/concepts/knowledge.mdx` is the Components overview page for the current Company Brain label.
- `docs/src/content/docs/applications/admin/knowledge.mdx` documents the Admin `/knowledge` page and already notes route compatibility.
- `docs/src/content/docs/index.mdx` contains the landing-page component cards and reading-order copy.

### Institutional Learnings

- `docs/plans/archived/memory-docs-overhaul.md` recommends keeping the `/concepts/knowledge/` URL family if changing URLs is costly, while changing the visible story toward Memory as the harness-owned context layer.

### External References

- External research is not needed. This is a docs IA and terminology alignment change that follows existing Starlight patterns in the repo.

---

## Key Technical Decisions

- Preserve URLs and slugs: The request is about visible navigation and terminology, and the current docs have many internal links to `/concepts/knowledge/` and `/applications/admin/knowledge/`.
- Use "Memory" as the component label: The sidebar and overview should teach Memory as the component. "Company Brain" can remain only where needed as legacy/compatibility vocabulary or where a historical pipeline name is still precise.
- Keep the rename targeted: Update high-signal pages and related links rather than mechanically replacing every historical "Company Brain" mention inside deep technical docs where the phrase names a specific existing page/pipeline concept.

---

## Open Questions

### Resolved During Planning

- Should routes be renamed from `/concepts/knowledge/` to `/concepts/memory/`? No. Preserve route compatibility for this change.
- Should "Company Brain" disappear everywhere? No. Use Memory as the primary component term, but leave precise historical or compatibility mentions when they explain existing route names or compiled-page terminology.

### Deferred to Implementation

- Exact wording for each deep technical page: The implementer should make local prose edits only where the old term appears as primary navigation/product vocabulary.

---

## Implementation Units

- U1. **Reorder and relabel the Components sidebar**

**Goal:** Make the left navigation match the requested order and label.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `docs/astro.config.mjs`

**Approach:**
- Move the Agents group before Spaces.
- Move Threads after Spaces.
- Rename the Company Brain group label to Memory without changing its slug values.
- Keep all existing Memory child items unless a child label still over-emphasizes Company Brain as primary navigation language.

**Patterns to follow:**
- Existing nested Starlight sidebar objects in `docs/astro.config.mjs`.

**Test scenarios:**
- Test expectation: none -- sidebar configuration is static docs metadata; verification is by docs build and browser smoke.

**Verification:**
- Components sidebar renders Agents, Spaces, Threads, Memory in that order.
- Memory still opens the existing `concepts/knowledge` overview.

---

- U2. **Retitle the Memory component overview**

**Goal:** Make the concept overview present Memory as the component name while preserving the context-layer explanation.

**Requirements:** R2, R3

**Dependencies:** U1

**Files:**
- Modify: `docs/src/content/docs/concepts/knowledge.mdx`

**Approach:**
- Change frontmatter title from Company Brain to Memory.
- Rewrite the lead to define Memory as the harness-owned context layer.
- Keep a short compatibility note that older docs and routes may still say Company Brain or `/concepts/knowledge/`.
- Update section headings, cards, related-page labels, and route notes so Memory is the primary term.

**Patterns to follow:**
- Existing overview-card structure in `docs/src/content/docs/concepts/knowledge.mdx`.
- Memory framing from `docs/plans/archived/memory-docs-overhaul.md`.

**Test scenarios:**
- Test expectation: none -- prose-only docs change; verification is by build and browser smoke.

**Verification:**
- `/concepts/knowledge/` renders with title "Memory".
- The page explains retained memory, compiled pages, knowledge bases, workspace files, and source routing as facets of Memory.

---

- U3. **Sweep high-signal adjacent docs for old component naming**

**Goal:** Prevent landing pages and related docs from contradicting the new navigation label.

**Requirements:** R3, R4

**Dependencies:** U2

**Files:**
- Modify: `docs/src/content/docs/index.mdx`
- Modify: `docs/src/content/docs/applications/admin/knowledge.mdx`
- Modify: `docs/src/content/docs/applications/admin/index.mdx`
- Modify: `docs/src/content/docs/applications/admin/knowledge-bases.mdx`
- Modify: `docs/src/content/docs/applications/admin/spaces.mdx`
- Modify targeted files under `docs/src/content/docs/concepts/knowledge/` where "Company Brain" is used as the current primary component label.

**Approach:**
- Update landing-page component lists, cards, and reading-order links to say Memory.
- Update Admin knowledge docs to say the visible module name is Memory while the route remains `/knowledge`.
- Update related-page labels from Company Brain to Memory.
- Leave "Company Brain" in precise historical/compatibility statements only when a sentence would otherwise become misleading.

**Patterns to follow:**
- Route compatibility language already present in `docs/src/content/docs/applications/admin/knowledge.mdx`.
- Existing related-pages sections across concept docs.

**Test scenarios:**
- Test expectation: none -- prose-only docs change; verification is by targeted search and docs build.

**Verification:**
- `rg "Company Brain" docs/src/content/docs/index.mdx docs/src/content/docs/applications/admin docs/src/content/docs/concepts/knowledge` returns only intentional compatibility or historical/technical mentions.
- No updated links point to renamed routes that do not exist.

---

- U4. **Verify docs build and navigation**

**Goal:** Prove the docs still build and the Components sidebar renders the requested order.

**Requirements:** R5

**Dependencies:** U1, U2, U3

**Files:**
- Modify: none

**Approach:**
- Run the docs build after edits.
- Start the docs dev server and smoke-test the docs home page plus the Memory concept overview in a browser.
- Use browser output to confirm the Components order and Memory label.

**Patterns to follow:**
- Existing docs verification flow from prior Starlight docs changes.

**Test scenarios:**
- Test expectation: none -- this unit is verification-only.

**Verification:**
- Docs build completes successfully.
- Browser snapshot shows Components ordered Agents, Spaces, Threads, Memory.
- `/concepts/knowledge/` loads and displays "Memory" as the page title.

---

## System-Wide Impact

- **Interaction graph:** Static docs config and markdown pages only.
- **Error propagation:** Not applicable.
- **State lifecycle risks:** Not applicable.
- **API surface parity:** Existing routes and API names remain unchanged.
- **Integration coverage:** Browser smoke validates Starlight sidebar rendering and page title.
- **Unchanged invariants:** `/concepts/knowledge/` and `/applications/admin/knowledge/` remain stable URLs.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Over-renaming breaks historical or precise technical meaning | Keep Company Brain only where it is explicitly compatibility or historical terminology |
| Broken links from route rename assumptions | Preserve all existing slugs and verify with docs build |
| Landing page and sidebar disagree | Update both `docs/astro.config.mjs` and `docs/src/content/docs/index.mdx` in the same change |

---

## Documentation / Operational Notes

- This change is itself documentation. No runtime rollout notes are needed.

---

## Sources & References

- Related code: `docs/astro.config.mjs`
- Related docs: `docs/src/content/docs/concepts/knowledge.mdx`
- Related docs: `docs/src/content/docs/applications/admin/knowledge.mdx`
- Institutional guidance: `docs/plans/archived/memory-docs-overhaul.md`
