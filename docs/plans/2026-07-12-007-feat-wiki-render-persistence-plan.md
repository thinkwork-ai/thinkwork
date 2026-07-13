---
title: Wiki Page Render Persistence, GraphQL renderHtml, and Backfill - Plan
type: feat
date: 2026-07-12
topic: wiki-render-persistence
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Wiki Page Render Persistence, GraphQL renderHtml, and Backfill - Plan

## Goal Capsule

- **Objective:** Every wiki page write path persists a compositor-produced HTML plate render alongside the canonical markdown, clients can fetch it through a `WikiPage.renderHtml` GraphQL field on the detail query, and existing pages can be backfilled in batch without an LLM recompile.
- **Product authority:** `docs/plans/2026-07-12-004-feat-wiki-html-plate-style-plan.md` (THINK-270), unit U2. This artifact scopes that unit for standalone execution as THINK-273; where the two disagree, the parent plan wins.
- **Open blockers:** THINK-272 (parent plan U1) must be merged before this unit can compile a render — `resolveWikiPlate` and the `WIKI_PLATES` definitions do not exist on `main` yet (verified: no `WIKI_PLATES`/`resolveWikiPlate` in `packages/api/src/lib/artifacts/`). Implementation can be drafted against the U1-specified interfaces; tests and dev verification cannot pass until U1 lands.

---

## Product Contract

### Summary

When the wiki compile pipeline writes a page — full upsert, canonical-entity upsert, or an incremental section patch — it also compiles the page's sections through the Document Compositor into a self-contained HTML plate render and stores it on the page row. The render is best-effort: any compile failure or oversize output persists a NULL render and never fails the compile. A `renderHtml` field on the `WikiPage` detail query exposes the stored render to web, mobile, and CLI clients, and an operator batch script backfills renders for already-compiled pages from their stored sections without invoking any LLM.

### Key Decisions

These are inherited from the parent plan and are settled, not open for re-litigation here.

- **Render is stored as nullable columns on `wiki.pages`, not a sibling table or S3.** New columns `render_html`, `render_plate_slug`, `rendered_at` keep the render transactionally consistent with the sections it derives from and make the read path a plain GraphQL field (parent KTD1).
- **Regeneration hooks the existing `body_md` rewrite seam, no new trigger or queue.** `upsertPage`, `upsertCanonicalEntityPage`, and `upsertSections` in `packages/api/src/lib/wiki/repository.ts` already assemble full-page markdown via `renderBodyMarkdown(sections)`; the render is produced at those same points from the same assembled content (parent KTD2). Verified: all three functions exist on `main` and funnel through that seam.
- **Render generation is best-effort; failure degrades to NULL, never fails the compile.** Plate-resolution throws, compositor `ok: false` diagnostics, and outputs over the 256 KiB document render cap all persist the page with `render_html = NULL` and logged diagnostics (parent KTD3, KTD6). The NULL render is safe because the readers' markdown fallback is a permanent contract (parent R9).
- **Markdown sections stay canonical; the render is derived and rebuildable.** The render is regenerated whenever a page's sections change through the compile pipeline; rebuilding a page regenerates its render (parent R3).
- **The schema change ships as a hand-rolled migration on the `wiki` schema.** Post-journal wiki changes are hand-rolled SQL with `-- creates-column:` markers, psql-applied to dev before the PR merges so the `db:migrate-manual` drift gate passes (parent KTD9).
- **Tenant palettes bake into the stored render at compile time.** A palette change applies on the next compile/rebuild/backfill — the same semantics document artifacts already have (parent KTD8).
- **The backfill is a compositor-only batch script, not per-page manual work.** It recompiles renders from stored sections with no Bedrock calls, mirroring the existing document-render backfill precedent; the normal compile path and `thinkwork wiki rebuild` regenerate renders on their own (parent R10).

### Requirements

- R1. Every page persisted through the wiki compile write paths (`upsertPage`, `upsertCanonicalEntityPage`, `upsertSections`) carries a plate render — self-contained, sanitized, scriptless HTML compiled from its sections via the Document Compositor with the page type's wiki plate — stored with the plate slug used and a render timestamp. _(parent R1, R2)_
- R2. When a page's sections change through the compile pipeline, its stored render is regenerated in the same write; the markdown sections remain the canonical compiled form. _(parent R3)_
- R3. Render generation never fails a page write: plate-resolution errors, compositor failures, oversize output (over the document render byte cap), and zero-section pages all persist the page with a NULL render and logged diagnostics. _(parent KTD3, KTD6)_
- R4. The `wikiPage` GraphQL detail query exposes `renderHtml`; list and search surfaces (`wikiSearch`, graph, dossier) do not carry it. Codegen is regenerated in every consumer (`packages/api`, `apps/web`, `apps/mobile`, `apps/cli`).
- R5. An operator batch script backfills renders for existing pages from their stored sections, compositor-only (no LLM), and is idempotent — re-running over already-rendered pages produces the same bytes. _(parent R10, AE1)_
- R6. The `wiki.pages` schema change ships as a hand-rolled migration with `-- creates-column:` markers, applied to dev via psql before the PR merges.

### Acceptance Examples

- AE1. **Covers R1, R2.** Given a page written through `upsertSections` patching one section, when the write completes, then `render_html` reflects the new section content, `rendered_at` is updated, and the render contains the plate shell for the page's wiki plate slug.
- AE2. **Covers R3.** Given a page whose plate resolution throws or whose compositor output exceeds the byte cap, when the write completes, then the page row persists with `render_html` NULL and no exception escapes the compile.
- AE3. **Covers R4.** Given a compiled page with a stored render, when a client queries `wikiPage` on deployed dev, then `renderHtml` returns the sanitized HTML document; `wikiSearch` results for the same page carry no render.
- AE4. **Covers R5.** Given dev wiki pages compiled before this feature, when the operator runs the backfill script against dev, then pages with sections gain renders without any Bedrock invocation, and a second run leaves them byte-identical. _(parent AE1)_

### Scope Boundaries

- No reader changes — web is parent unit U3 (THINK-274), mobile is U4 (THINK-275); this unit only persists and exposes the render.
- No plate definitions or compositor changes — wiki plates and the internal-link policy are U1 (THINK-272); this unit consumes `resolveWikiPlate` and `compileDocument` as delivered.
- No changes to the compile pipelines' content decisions (planner/graph) — presentation only.
- No S3 storage, no artifact rows, no document-emission path for wiki pages (parent scope: wiki pages do not become document artifacts).
- Detail-only GraphQL exposure; no render on list, search, graph, or dossier payloads.

### Dependencies / Assumptions

- Depends on THINK-272 (U1) merged: `WIKI_PLATES` in `plate-definitions.ts`, `resolveWikiPlate` in `plate-registry.ts`, and the compositor internal-link policy. As of this artifact U1 is still pre-implementation.
- One PR, per the parent plan's execution profile. The migration takes the next free hand-rolled number (0245 as of this artifact; renumber if taken at implementation time).
- Assumes the `wiki-compile` Lambda needs no `build-lambdas.sh` changes — it already inlines `packages/api` code and bundles the pure-JS compositor dependencies (parent U2 approach note; verify at implementation).
- End-to-end dev verification per the parent contract: migration psql-applied to dev with `pnpm db:migrate-manual` reporting the columns present; a compile on dev followed by `wikiPage.renderHtml` returning HTML via the dev GraphQL endpoint; the backfill script run against dev (AE4).
- The 256 KiB cap reuses the existing document render size discipline (`DOCUMENT_RENDER_MAX_BYTES`, verified present in `packages/api/src/lib/artifacts/`).

### Sources

- Parent plan U2 section, requirements R1/R2/R3/R10, AE1, and KTD1–KTD3/KTD6/KTD8/KTD9: `docs/plans/2026-07-12-004-feat-wiki-html-plate-style-plan.md`.
- Write seam: `packages/api/src/lib/wiki/repository.ts` (`upsertPage`, `upsertCanonicalEntityPage`, `upsertSections`, `renderBodyMarkdown`); schema `packages/database-pg/src/schema/wiki.ts` (`wiki` pgSchema).
- GraphQL source: `packages/database-pg/graphql/types/wiki.graphql`; `renderHtml` precedent on `Artifact` in `artifacts.graphql`.
- Backfill precedent: `packages/api/scripts/backfill-document-renders.ts`.
- Migration discipline: `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`.
- Sibling unit artifacts (shape precedent): `docs/plans/2026-07-12-005-feat-mobile-wiki-plate-reader-plan.md` (THINK-275), `docs/plans/2026-07-12-006-feat-web-wiki-plate-reader-plan.md` (THINK-274).
