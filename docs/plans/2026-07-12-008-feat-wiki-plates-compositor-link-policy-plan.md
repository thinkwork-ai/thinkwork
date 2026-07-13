---
title: Wiki Plates and Compositor Internal-Link Policy - Plan
type: feat
date: 2026-07-12
topic: wiki-plates-compositor-link-policy
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Wiki Plates and Compositor Internal-Link Policy - Plan

## Goal Capsule

- **Objective:** The plate system can produce a wiki-page render: three code-defined wiki plates (`wiki-entity`, `wiki-topic`, `wiki-decision`) exist and resolve with tenant deltas through a dedicated `resolveWikiPlate`, and the Document Compositor gains an opt-in internal-link policy that preserves validated `/wiki/...` anchors while keeping every other link inert and default output byte-identical.
- **Product authority:** `docs/plans/2026-07-12-004-feat-wiki-html-plate-style-plan.md` (THINK-270), unit U1. This artifact scopes that unit for standalone execution as THINK-272; where the two disagree, the parent plan wins.
- **Open blockers:** none. U1 has no dependencies — it is the first unit of the parent plan and blocks THINK-273 (U2). Verified: no `WIKI_PLATES` or `resolveWikiPlate` exists in `packages/api/src/lib/artifacts/` on `main` yet.

---

## Product Contract

### Summary

Add three platform wiki plates to the code-defined plate registry — one each for entity, topic, and decision pages — kept in a separate `WIKI_PLATES` list so they never surface in emission dispatch, `listPlates`, or composer UX, and resolvable through a new `resolveWikiPlate(tenantId, pageType)` that reuses the existing layering so tenant document palettes and platform overrides apply. Separately, give the Document Compositor an opt-in internal-link policy: with the policy set, a markdown link whose href normalizes to exactly `/wiki/(entity|topic|decision)/<slug>` survives as a real anchor; every other link keeps today's inert treatment, and compiles without the policy stay byte-identical to before the change. This unit has no consumers yet — persistence (U2/THINK-273) and the readers (U3/THINK-274, U4/THINK-275) build on it.

### Key Decisions

These are inherited from the parent plan and are settled, not open for re-litigation here.

- **Wiki plates live in a separate code-defined list (`WIKI_PLATES`), not in `PLATFORM_PLATES`.** Keeping them out of `PLATFORM_PLATES` excludes them from `emit_document` dispatch, `listPlates` composer surfaces, and plate-preview UX without new hidden-flag machinery (parent KTD4). Verified: `PLATFORM_PLATES` is the single list feeding `BY_SLUG` and the registry's platform layer today.
- **A dedicated `resolveWikiPlate(tenantId, pageType)` reuses the existing layering.** It maps page type → wiki plate slug and delegates to `resolveFromLayers` (platform wiki def → tenant document palette → `document_plates` overrides), so tenant palette customization comes free with the existing delta mechanism (parent R5, KTD4).
- **Section specs are advisory (`suggested` tier), mapped from the wiki template vocabulary.** Entity: overview/notes/visits/related; topic: summary/highlights/related_entities/recent; decision: context/decision/rationale/consequences — from `packages/api/src/lib/wiki/templates.ts` (verified). The graph-materializer source emits a different vocabulary (overview/relationships, per the parent plan), so specs must be advisory, not required (parent KTD4).
- **Wiki plates set `allowedDirectives: []`.** Wiki section markdown contains no `tw:` directive fences; a stray fence produces a compile error and that page falls back to markdown rendering downstream — acceptable, the canonical markdown remains readable (parent assumption).
- **The internal-link policy is opt-in on `CompileDocumentInput` with dot-segment normalization plus route-shape validation.** A candidate href is resolved against a fixed synthetic base (dot-segment normalization, mirroring mobile's `extractWikiPath` `new URL(...).pathname` pattern) and survives only when the normalized path matches `^/wiki/(entity|topic|decision)/[^/]+$` — enum-bound type, single slug segment. A bare `startsWith("/wiki/")` check is insufficient: `/wiki/../admin` would otherwise pass and, under the relaxed reader sandbox (parent KTD7), resolve on click into an arbitrary same-origin route. This gate is the sole control on web navigation targets, so its tests are load-bearing (parent KTD5).
- **The policy is a parse-time change at the inert-href gate, not a sanitizer change.** Link handling honors the policy where `isInertHref` currently fires; surviving anchors render with no scheme, no host, no target attribute — the reader envelope owns targeting (parent U1 approach).
- **Default compositor output stays byte-identical.** No policy set → behavior unchanged; golden-parity fixtures in `packages/api/src/lib/artifacts/__fixtures__/` must not churn (parent KTD5, verification contract).

### Requirements

- R1. Three wiki plate definitions — slugs `wiki-entity`, `wiki-topic`, `wiki-decision` — exist in `plate-definitions.ts` in a separate `WIKI_PLATES` list, each with eyebrow, per-type accent palettes (light and dark), `allowedDirectives: []`, and `suggested`-tier section specs mapped from the wiki template vocabulary for its page type. _(parent R4)_
- R2. `resolveWikiPlate(tenantId, pageType)` resolves a wiki plate with the existing layering — platform definition, tenant document palette, `document_plates` platform-override rows — and returns an error/null for an unknown page type. _(parent R5, KTD4)_
- R3. Wiki plate slugs are excluded from `listPlates`, emission dispatch, and every composer-facing plate surface. _(parent KTD4)_
- R4. `CompileDocumentInput` accepts an optional internal-link policy; when set, a link whose href normalizes (dot-segment resolution against a fixed synthetic base) to a path matching `^/wiki/(entity|topic|decision)/[^/]+$` survives as an anchor with exactly that path as href; all other hrefs — external URLs, other root-relative paths, `javascript:`, protocol-relative, traversal attempts, unknown wiki types, extra path segments — keep the existing inert degradation. _(parent R8 policy half, KTD5)_
- R5. Compiles without the policy produce byte-identical output to before the change: existing golden-parity fixtures pass unmodified, and two compiles of the same wiki input produce identical bytes. _(parent R2, KTD5)_

### Acceptance Examples

- AE1. **Covers R4.** Given a compile with the wiki link policy, when the markdown contains `[Acme](/wiki/entity/acme-corp)`, `[x](https://evil.example)`, and `[y](/other/path)`, then only the first survives as an anchor (href exactly `/wiki/entity/acme-corp`); the other two degrade to inert inline text.
- AE2. **Covers R4.** Given a compile with the wiki link policy, when the markdown links to `/wiki/../admin`, `/wiki/./../x`, `//host/wiki/entity/x`, `/wiki/bogus-type/x`, or `/wiki/entity/a/b`, then every one degrades to inert text exactly like an external URL.
- AE3. **Covers R5.** Given the existing document-artifact golden fixtures, when the full compositor test suite runs after this change, then the fixtures pass without modification.
- AE4. **Covers R2.** Given a tenant with a custom document palette and a `platform_override` row for `wiki-entity`, when `resolveWikiPlate` runs for that tenant, then the resolved plate's light/dark tokens reflect the palette and the override merges; an unknown page type resolves to nothing.
- AE5. **Covers R3.** Given a tenant, when `listPlates(tenantId)` runs, then no wiki slug appears in the result.

### Scope Boundaries

- No persistence — render columns, repository write-path hooks, GraphQL exposure, and backfill are U2 (THINK-273).
- No reader changes — web is U3 (THINK-274), mobile is U4 (THINK-275); the navigation halves of parent R8 (sandbox relaxation, WebView interception) live there.
- No changes to default compositor behavior, sanitizer configuration, or the plate contract's directive system.
- No tenant-editable section contracts for wiki plates, and no specialized plates per entity subtype or ontology class (parent scope boundaries).
- No new hidden-flag or visibility machinery in the registry — separation by list membership is the mechanism.

### Dependencies / Assumptions

- Dependencies: none. This unit blocks THINK-273 (U2), which consumes `resolveWikiPlate` and the link policy.
- One PR, per the parent plan's execution profile.
- Follow the existing `BUSINESS_PLATES` definition shape (`qbr`/`proposal` precedent) for the three wiki definitions; follow `resolvePlatformPlate`/`resolvePlate` structure for `resolveWikiPlate`.
- This unit has no user-visible surface; completeness = `pnpm --filter @thinkwork/api test` green including untouched golden fixtures, plus a locally compiled sample wiki page render inspected in a browser file load for plate styling, dark/light tokens, and live wiki anchors (parent U1 verification). End-to-end user-flow proof is deferred to U3/U4.
- The synthetic base used for normalization is an implementation detail; only the normalized-path match is contractual.

### Sources

- Parent plan U1 section, requirements R2/R4/R5/R8, and KTD4/KTD5: `docs/plans/2026-07-12-004-feat-wiki-html-plate-style-plan.md`.
- Plate registry: `packages/api/src/lib/artifacts/plate-definitions.ts` (`BUSINESS_PLATES`/`PLATFORM_PLATES`, `allowedDirectives`), `plate-registry.ts` (`resolveFromLayers`, `resolvePlatformPlate`, `listPlates`) — all verified present.
- Compositor: `packages/api/src/lib/artifacts/document-compositor.ts` (`isInertHref`, `CompileDocumentInput`) — verified present; golden fixtures in `packages/api/src/lib/artifacts/__fixtures__/`.
- Wiki section vocabulary: `packages/api/src/lib/wiki/templates.ts` (verified: entity overview/notes/visits/related; topic summary/highlights/related_entities/recent; decision context/decision/rationale/consequences).
- Mobile normalization precedent: `extractWikiPath` in `apps/mobile/app/wiki/[type]/[slug].tsx` (verified).
- Sibling unit artifacts (shape precedent): `docs/plans/2026-07-12-007-feat-wiki-render-persistence-plan.md` (THINK-273), `docs/plans/2026-07-12-006-feat-web-wiki-plate-reader-plan.md` (THINK-274), `docs/plans/2026-07-12-005-feat-mobile-wiki-plate-reader-plan.md` (THINK-275).
