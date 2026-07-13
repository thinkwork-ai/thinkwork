---
title: Mobile Wiki Reader Renders the HTML Plate - Plan
type: feat
date: 2026-07-12
topic: mobile-wiki-plate-reader
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Mobile Wiki Reader Renders the HTML Plate - Plan

## Goal Capsule

- **Objective:** The mobile wiki screen displays a wiki page's stored HTML plate render inside the existing scriptless document-frame WebView, with in-wiki taps navigating natively and un-rendered pages falling back to the current markdown path.
- **Product authority:** `docs/plans/2026-07-12-004-feat-wiki-html-plate-style-plan.md` (THINK-270), unit U4. This artifact scopes that unit for standalone execution as THINK-275; where the two disagree, the parent plan wins.
- **Open blockers:** THINK-273 (parent plan U2) must be merged and deployed to dev before this unit's device verification can run — `WikiPage.renderHtml` does not exist on `main` yet (verified: `packages/database-pg/graphql/types/` has `renderHtml` only on `Artifact`). Implementation can start against the U2-specified field shape; verification cannot.

---

## Product Contract

### Summary

Replace the mobile wiki page's markdown-only rendering with the compiled HTML plate render when one exists, shown in the same scriptless WebView envelope the mobile artifacts reader already uses. In-wiki links inside the render push native wiki screens; external links stay inert; pages without a render keep the existing markdown path.

### Key Decisions

These are inherited from the parent plan and are settled, not open for re-litigation here.

- **Scriptless WebView with request interception, not an in-app HTML parser.** The render displays with `javaScriptEnabled={false}` in the document-frame envelope (parent KTD7). Navigation is achieved by intercepting WebView load requests, never by injected script or postMessage.
- **A synthetic `baseUrl` on the WebView source is mandatory.** Without one, root-relative hrefs resolve against `about:blank` and a tap never produces a request to intercept — the interception design silently dead-ends. This is the unit's central correctness trap and the one behavior no unit test can prove.
- **Only the plate body goes in the WebView.** The `DetailLayout` header and the native summary/backlinks/connected-pages/sources cards stay native, outside the frame.
- **The markdown path is a contract, not legacy.** `react-native-markdown-display` rendering remains the permanent fallback for pages with a NULL render (parent R9); it must not be removed or degraded.

### Requirements

- R1. When a wiki page's `renderHtml` is non-null, the mobile wiki screen displays it in the scriptless document-frame WebView, themed to the app's current color scheme. *(parent R7)*
- R2. Tapping an in-wiki link (`/wiki/<type>/<slug>`) inside the render cancels the WebView load and pushes the target wiki screen natively — no browser, no reload. Type segments are normalized to the uppercase form the mobile router requires. *(parent R8)*
- R3. Tapping any other link inside the render does nothing: the request is blocked and no navigation occurs. *(parent R8)*
- R4. When `renderHtml` is null, the screen renders exactly as it does today via the markdown path. *(parent R9)*
- R5. The artifacts reader screen and the native wiki chrome (backlinks and connected-pages navigation) behave unchanged.

### Acceptance Examples

- AE1. **Covers R2.** Given a topic page whose render links to `/wiki/entity/acme-corp`, when the user taps it on device, then an intercepted request is observed and the entity's wiki screen pushes natively. *(parent AE2)*
- AE2. **Covers R3.** Given a page whose render contains an external URL, when the user taps it, then nothing happens — no WebView navigation, no system browser.
- AE3. **Covers R4.** Given a page whose render is missing (compile failure or not yet backfilled), when the user opens it, then the current markdown/section rendering displays rather than an error or blank frame. *(parent AE3)*

### Scope Boundaries

- The web wiki reader is parent unit U3 (THINK-274), not this issue.
- No changes to render generation, persistence, or the GraphQL field — that is U2 (THINK-273); this unit only fetches and displays.
- No envelope changes expected in `apps/mobile/lib/document-frame.ts`; touch it only if display genuinely requires it.
- No in-WebView rendering of the native chrome (summary, backlinks, sources) — those cards stay native.

### Dependencies / Assumptions

- Depends on THINK-273 (U2) merged and deployed to dev, with dev wiki data backfilled or rebuilt, before device verification.
- Assumes the mobile wiki screen's existing `extractWikiPath` URL mapping and `isWikiPageType` guard (both currently local to `apps/mobile/app/wiki/[type]/[slug].tsx`) are reusable for the interception policy, per parent KTD7.
- Assumes the artifacts reader (`apps/mobile/app/artifacts/[id].tsx`) is the WebView pattern to mirror (originWhitelist, hidden-until-load, `setSupportMultipleWindows={false}`).

### Sources

- Parent plan U4 section, requirements R7–R9, AE2–AE3, and KTD7: `docs/plans/2026-07-12-004-feat-wiki-html-plate-style-plan.md`.
- Current mobile wiki screen (markdown path, `extractWikiPath`, `isWikiPageType`): `apps/mobile/app/wiki/[type]/[slug].tsx`.
- Scriptless envelope helper: `apps/mobile/lib/document-frame.ts` (`withDocumentFrameEnvelope`).
- Existing WebView reader pattern: `apps/mobile/app/artifacts/[id].tsx`; `renderHtml` fetch precedent in `apps/mobile/lib/graphql-queries.ts` (`ArtifactDetailQuery`).
