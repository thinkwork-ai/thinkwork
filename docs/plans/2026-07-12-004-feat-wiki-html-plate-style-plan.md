---
title: Wiki HTML Plate Style - Plan
type: feat
date: 2026-07-12
topic: wiki-html-plate-style
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Wiki HTML Plate Style - Plan

## Goal Capsule

- **Objective:** Wiki pages (Compounding Memory) render in the platform's house-style HTML plate format instead of raw markdown, on both web and mobile.
- **Product authority:** Linear THINK-270 (Eric Odom); this document is the requirements contract for planning.
- **Open blockers:** none. Outstanding Questions below lists two product forks with recommended answers for confirmation at Requirements Review.

---

## Product Contract

### Summary

Give every compiled wiki page a derived, self-contained HTML plate render — produced by the existing Document Compositor from the page's compiled sections — and make the web and mobile wiki readers display that render through the existing plate reader surfaces. Wiki page types (entity, topic, decision) get their own platform plates in the plate registry; markdown sections remain the canonical compiled form.

### Problem Frame

The Compounding Memory wiki stores compiled pages as markdown (`wiki.pages.body_md` plus `wiki.page_sections` rows), and each client renders that markdown its own way: the web full-page reader (`apps/web/src/components/memory/WikiPageView.tsx`) hand-renders structured sections after deliberately avoiding the prose renderer for readability reasons, and mobile (`apps/mobile/app/wiki/[type]/[slug].tsx`) pushes each section through `react-native-markdown-display`. The result is visually flat, inconsistent across clients, and far below the polish of the platform's document artifacts.

Meanwhile the platform already owns a mature report presentation: code-defined plates (THINK-153) resolved through the plate registry, compiled by the deterministic Document Compositor v2 (THINK-154) into sanitized, scriptless, theme-aware single-file HTML, with a framed web reader and a JS-disabled mobile WebView reader (`apps/mobile/lib/document-frame.ts`). Wiki pages are the most-read knowledge surface in the product and the only major reading surface not using it.

### Key Decisions

- **Plate render is derived, compile-time output; markdown stays canonical.** The wiki is a rebuildable derived store materialized from Hindsight memory by the `wiki-compile` pipeline. The plate render is one more derived representation produced at compile time from the compiled sections — never hand-authored, never the source of truth. Rebuilding or recompiling a page regenerates its render.
- **One platform plate per wiki page type, not one generic plate.** Entity, topic, and decision pages have different section semantics (`wiki.pages.type` "describes page shape"), and the plate contract (THINK-183 section specs) exists precisely to encode per-genre section structure. Three wiki plates in the plate registry beat one generic plate that flattens the distinction. Specialized plates per entity subtype or ontology class are deferred (see Scope Boundaries).
- **Wiki pages do not become document artifacts.** No `document-emission` path, no artifact rows, no S3 artifact cards. Documents-as-memory (THINK-152/193) deliberately never ingests compositor output; wiki pages derive _from_ memory, so routing them through the artifact pipeline would create a store-and-ingest loop and conflate two lifecycles. The wiki keeps its own tables; only the compositor and plate registry are reused.
- **Reuse the existing reader surfaces, not new ones.** Web displays the render with the same framed presentation the HTML-report reader uses; mobile displays it in the existing scriptless document-frame WebView envelope. No new rendering stack on either client.

### Requirements

**Rendering and storage**

- R1. Every compiled wiki page carries a house-style plate render: self-contained, sanitized, scriptless HTML derived from its compiled sections via the Document Compositor.
- R2. The plate render honors the compositor's existing guarantees — deterministic output, no scripts or SVG, inert external URLs, light/dark theme tokens.
- R3. Markdown sections (`wiki.page_sections`) remain the canonical compiled form; the render is regenerated whenever a page's sections change through the compile pipeline.

**Plate definitions**

- R4. Three platform plates — one each for entity, topic, and decision pages — are registered in the plate registry, with section specs mapped from the wiki section vocabulary for each page type.
- R5. Tenant palette customization applies to wiki plates through the existing plate-registry delta mechanism; section-spec editing for wiki plates is not exposed in v1.

**Reading surfaces**

- R6. The web full-page wiki reader displays the plate render using the framed presentation pattern of the HTML-report reader; the search palette and entity dossier continue to open pages into it unchanged.
- R7. The mobile wiki reader displays the plate render in the scriptless document-frame WebView, replacing the native markdown rendering path.
- R8. In-wiki links (`/wiki/<type>/<slug>`) inside a rendered page navigate in-app on both clients, despite the render itself being scriptless; external links stay inert per compositor policy.
- R9. A page with no render available falls back to the current markdown/section rendering path on both clients.

**Regeneration**

- R10. `thinkwork wiki rebuild` (and the normal compile path) regenerates plate renders for all existing pages; no manual per-page backfill is required to migrate the existing wiki.

### Acceptance Examples

- AE1. **Covers R3, R10.** Given an existing wiki entity page compiled before this feature, when the operator runs `thinkwork wiki rebuild` (or the page's sections are next updated by a compile job), then the page gains a plate render and both readers display it.
- AE2. **Covers R8.** Given a topic page whose render contains a link to `/wiki/entity/acme-corp`, when the user taps or clicks it in either reader, then the app navigates to that wiki page in-app; a link to an external URL does not navigate.
- AE3. **Covers R9.** Given a page whose render is missing (compile failure or not yet regenerated), when a user opens it, then the reader shows the current markdown/section rendering rather than an error or blank frame.
- AE4. **Covers R5.** Given a tenant with a custom document palette, when a user views a wiki page, then the wiki plate reflects the tenant palette the same way document plates do.

### Scope Boundaries

Deferred for later:

- Specialized wiki plates per entity subtype or ontology/knowledge-model class (the issue's "specialized wiki plates for certain topics"). The per-type plates plus the registry's tenant-delta mechanism are the extension point; adding subtype plates later is registry configuration, not rearchitecture.
- Tenant-editable section contracts for wiki plates (content-contract editor integration).
- Restyling the search palette results, entity dossier card, or graph views — only the full-page readers change.

Outside this feature's identity:

- Wiki pages as document artifacts (emission, artifact rows, thread cards).
- Ingesting wiki plate renders back into memory.
- Changes to the compile pipelines' content decisions (planner/graph) — this feature changes presentation, not what gets written.

### Outstanding Questions

Resolve before planning (product forks; recommended answers stated):

- Q1. Should mobile switch to the plate WebView in v1, or ship web-first with mobile as a fast follow? **Recommended: both in v1** — the mobile scriptless WebView envelope already exists and the markdown path remains as the R9 fallback, so the increment is small.
- Q2. Per-type plates (entity/topic/decision) versus one generic wiki plate in v1? **Recommended: per-type**, per Key Decisions; a generic plate would discard the section-shape distinction the plate contract exists to encode.

Deferred to planning:

- Where the render is stored (column on `wiki.pages`, sibling table, or S3 object) and how incremental section patching triggers regeneration.
- Whether the render embeds the full page or is assembled per-section for very large pages.
- How link interception is implemented in each reader (web frame navigation vs mobile WebView request policy).

### Sources / Research

- Wiki derived store and section model: `packages/database-pg/src/schema/wiki.ts`; compile entry `packages/api/src/handlers/wiki-compile.ts`; pipeline libs `packages/api/src/lib/wiki/`.
- Plate system: `packages/api/src/lib/artifacts/plate-definitions.ts` (registry, THINK-153), `document-compositor.ts` and `document-templates.ts` (THINK-154), `plate-registry.ts` (resolution), tenant deltas in `packages/database-pg/src/schema/document-plates.ts`.
- Current readers: `apps/web/src/components/memory/WikiPageView.tsx` (THINK-263 U5), `apps/mobile/app/wiki/[type]/[slug].tsx`, mobile envelope `apps/mobile/lib/document-frame.ts`.
- Prior art: `docs/plans/2026-07-05-004-feat-plate-registry-tenant-genres-plan.md`, `docs/plans/2026-07-06-001-feat-documents-as-memory-plan.md` (why wiki pages must not become artifacts).
