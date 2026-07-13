---
title: Web Wiki Reader Renders the HTML Plate - Plan
type: feat
date: 2026-07-12
topic: web-wiki-plate-reader
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Web Wiki Reader Renders the HTML Plate - Plan

## Goal Capsule

- **Objective:** The web full-page wiki reader displays a wiki page's stored HTML plate render through the framed document presentation, with in-wiki link clicks navigating the SPA route and un-rendered pages falling back to the current section rendering.
- **Product authority:** `docs/plans/2026-07-12-004-feat-wiki-html-plate-style-plan.md` (THINK-270), unit U3. This artifact scopes that unit for standalone execution as THINK-274; where the two disagree, the parent plan wins.
- **Open blockers:** THINK-273 (parent plan U2) must be merged and deployed to dev before this unit's browser verification can run — `WikiPage.renderHtml` does not exist on `main` yet (verified: `packages/database-pg/graphql/types/` has `renderHtml` only on `Artifact`). Implementation can start against the U2-specified field shape; verification cannot.

---

## Product Contract

### Summary

When a wiki page carries a compiled HTML plate render, the web full-page wiki reader (`WikiPageView`) displays it through the same framed presentation the HTML-report reader uses, instead of the hand-rendered section layout. Clicking an in-wiki link inside the render navigates the app to that wiki page; external links stay inert; pages without a render keep the existing section rendering. Search palette and entity dossier entry points are unchanged.

### Key Decisions

These are inherited from the parent plan and are settled, not open for re-litigation here.

- **Relaxed frame sandbox plus `<base target="_top">`, not script-based navigation.** The wiki frame renders with `sandbox="allow-top-navigation-by-user-activation"` and an injected `<base target="_top">` so a user click on a `/wiki/...` anchor navigates the top window into the SPA route (parent KTD7). No `allow-scripts`, no postMessage surface — the render stays scriptless.
- **A full SPA reload on in-wiki link clicks is the named v1 compromise.** The click navigates via top-window navigation, so the route rehydrates state. Acceptable because the frame stays scriptless; a follow-up can move to an interception scheme without touching stored renders.
- **Artifact call sites keep `sandbox=""` byte-for-byte.** Only the wiki call site relaxes the sandbox. The document-artifact reader's containment posture must not change, whether the frame gains props or the wiki gets a thin wrapper.
- **Navigation-target safety lives in the compositor, not the frame.** The compositor's internal-link policy (parent KTD5, shipped in U1) is the sole control on which hrefs survive as anchors; the frame CSP does not constrain top-level navigation. This unit trusts the stored render and changes only presentation.
- **The section rendering path is a contract, not legacy.** The existing hand-rendered section layout remains the permanent fallback for pages with a NULL render (parent R9); it must not be removed or degraded.

### Requirements

- R1. When a wiki page's `renderHtml` is non-null, the web full-page wiki reader displays it through the framed document presentation, with the frame sandbox exactly `allow-top-navigation-by-user-activation` and `<base target="_top">` injected into the envelope, themed to the app's current theme. _(parent R6)_
- R2. Clicking an in-wiki link (`/wiki/<type>/<slug>`) inside the render navigates the app to that wiki page. _(parent R8)_
- R3. External URLs in a rendered page are inert text and do not navigate. _(parent R8)_
- R4. When `renderHtml` is null, the page renders exactly as it does today via the section rendering path. _(parent R9)_
- R5. Tenant document palettes apply to the displayed wiki plate the same way they do to document plates. _(parent AE4/R5)_
- R6. The surrounding reader chrome (header, breadcrumbs, related memories) and the search palette and entity dossier entry points behave unchanged, and document-artifact frame call sites keep `sandbox=""`.

### Acceptance Examples

- AE1. **Covers R2.** Given a topic page whose render links to `/wiki/entity/acme-corp`, when the user clicks it, then the app lands on that entity's wiki page (full reload accepted). _(parent AE2)_
- AE2. **Covers R3.** Given a page whose render contains an external URL, when the user clicks it, then nothing navigates — the URL renders as inert text.
- AE3. **Covers R4.** Given a page whose render is missing (compile failure or not yet backfilled), when the user opens it, then the current section rendering displays rather than an error or blank frame. _(parent AE3)_
- AE4. **Covers R5.** Given a tenant with a custom document palette, when a user views a wiki page, then the wiki plate reflects the tenant palette the same way document plates do. _(parent AE4)_

### Scope Boundaries

- The mobile wiki reader is parent unit U4 (THINK-275), not this issue.
- No changes to render generation, persistence, or the GraphQL field — that is U2 (THINK-273); this unit only fetches and displays.
- No restyling of the search palette results, entity dossier card, or graph views — only the full-page reader changes.
- No compositor or plate-registry changes — the internal-link policy and wiki plates are U1 (THINK-272).
- No client-side interception scheme for reload-free in-wiki navigation — deferred follow-up per the named compromise.

### Dependencies / Assumptions

- Depends on THINK-273 (U2) merged and deployed to dev, with dev wiki data backfilled or rebuilt, before browser verification. As of this artifact both THINK-272 and THINK-273 are still pre-implementation.
- Assumes the framed presentation in `apps/web/src/components/workbench/DocumentFrame.tsx` (`withDocumentFrameEnvelope`, srcDoc + CSP envelope + theme stamping) is the pattern to reuse, extended with optional sandbox/base-target variation or wrapped, per parent U3 — implementer's choice, provided artifact call sites are behaviorally byte-identical.
- Assumes verification is a real browser against deployed dev, per the parent plan's U3 flows: search palette → wiki page plate render, in-wiki link click navigation, external link inert, fallback page, dossier entry, light/dark plus tenant palette.

### Sources

- Parent plan U3 section, requirements R6/R8/R9, AE2–AE4, and KTD5/KTD7: `docs/plans/2026-07-12-004-feat-wiki-html-plate-style-plan.md`.
- Current web wiki reader (section rendering path, entry points): `apps/web/src/components/memory/WikiPageView.tsx`; page query `ComputerWikiPageQuery` in `apps/web/src/lib/graphql-queries.ts`.
- Framed presentation to reuse: `apps/web/src/components/workbench/DocumentFrame.tsx` (`sandbox=""` today) and its test `DocumentFrame.test.tsx`; `renderHtml` fetch precedent in `ArtifactDetailForRouteQuery`.
- Sibling unit artifact (shape precedent): `docs/plans/2026-07-12-005-feat-mobile-wiki-plate-reader-plan.md` (THINK-275).
