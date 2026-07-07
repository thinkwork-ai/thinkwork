---
title: Plate Timeline Directive - Plan
type: feat
date: 2026-07-06
topic: plate-timeline-directive
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Plate Timeline Directive - Plan

## Goal Capsule

- **Objective:** Add a horizontal Timeline component to the Plate catalog's closed `tw:` directive vocabulary so agents can communicate an ordered sequence of events (milestones, phases, rollout stages) in house-themed document artifacts.
- **Product authority:** THINK-202 (Eric Odom); reference image in the issue is an example only — the shipped component must match the ThinkWork document house style, not the image's styling.
- **Open blockers:** none.

---

## Product Contract

### Summary

Introduce `tw:timeline`, a new first-class directive in the Document Compositor's typed component vocabulary: a horizontal track of ordered milestones (dot on a track, bold label above, short caption below, optional date), rendered server-side in the plate house style with the existing plate token palette. Ship it with authoring guidance and exemplar coverage so agents actually reach for it when a document needs a sequence of events.

### Problem Frame

The directive vocabulary today is `stats`, `verdict-grid`, and `chart` (bar, line, donut, stat-strip, sparkline, meter, funnel). None of these expresses an ordered sequence of named events: the closest is the funnel, which is vertical and quantitative. When an agent needs to show phases, milestones, or a progression (the reference image in THINK-202 is exactly this — three labeled stops on a horizontal track), it either misuses a chart or falls back to prose/lists, losing the scannable shape a timeline provides. Because the vocabulary is closed and DocSpector rejects improvised visuals by design, the only way agents can ever produce a timeline is to add one to the vocabulary.

### Key Decisions

- **Component, not plate.** The timeline is a new directive kind in the compositor vocabulary, not a new plate in `plate-definitions.ts`. The issue asks for a reusable visual that many plates can incorporate; a "timeline plate" would be the wrong altitude and would not compose into existing genres.
- **First-class `tw:timeline` directive, not a new `tw:chart` chartType.** Timeline items are label + caption text pairs, not numeric series; forcing them through the chart param shape would contort authoring and rendering. It follows the `stats` / `verdict-grid` pattern: its own typed YAML body and its own house-style render.
- **Theme fidelity is a hard constraint.** The component uses only the existing plate token vocabulary (`--accent`, `--ink`, `--muted`, `--line`, etc.) so it inherits tenant palettes and dual-theme behavior with zero new theming surface. No per-item arbitrary colors.
- **Minimal v1 item shape.** Ordered items with a required label, optional caption, optional date, and an optional single "current" marker for emphasizing where a sequence stands. Progress states, durations, and branching are out.

### Requirements

**Component behavior**

- R1. A new `timeline` directive kind exists in the compositor's closed vocabulary; agents author it as a fenced `tw:timeline` block with a typed YAML body, markdown-only, consistent with existing directives.
- R2. The body is an ordered list of items; each item has a required label, an optional caption, and an optional date string rendered verbatim.
- R3. An item may be marked as the current position; at most one item carries the marker, and it renders with visible emphasis using theme accent tokens.
- R4. A malformed body (empty items, missing label, multiple current markers, over the item cap) is rejected at compile time with a model-actionable diagnostic, matching the existing directive rejection behavior.
- R5. The layout is horizontal: milestone markers on a single track, labels above, captions/dates below, matching the plate house style rather than the reference image's styling.
- R6. The render degrades gracefully when items are many or the viewport is narrow: content must remain readable without clipping in the document iframe and in print CSS. The exact degradation mechanism (wrapping, scaling, or a documented item cap) is a planning decision under this constraint.

**Theming and rendering constraints**

- R7. The render is produced server-side by the compositor as self-contained HTML/CSS (or inline SVG) using only the plate token vocabulary; it passes DocSpector, supports light and dark themes, and contains no scripts (document tier).
- R8. Tenant palette overrides and per-plate accent triads apply to the timeline with no timeline-specific configuration added.

**Availability and contract integration**

- R9. Plates with `allowedDirectives: "all"` (the four core plates and four of the five business plates) offer the timeline with no per-plate change; `proposal`'s explicit allow-list — the one restricted platform plate — is extended to include it. _(Planning correction: the requirements draft misnamed the restricted plate as `weekly-status`; in `plate-definitions.ts` the explicit allow-list is on `proposal`. Intent unchanged: the timeline is available on all nine platform plates.)_
- R10. Sequence-shaped sections of business plate contracts suggest the timeline via `suggestedDirectives` where a section communicates phases or an ordered rollout; planning maps the exact sections (candidates: proposal implementation/rollout, QBR roadmap).
- R11. Unknown-directive rejection and the availability gate (`allowedDirectives`) behave for `timeline` exactly as for existing kinds — no special cases.

**Authoring guidance and exemplars**

- R12. The document-composer skill's authoring guidance tells agents when to choose a timeline over a funnel, stats strip, or list — the trigger is "an ordered sequence of named events or phases" — so agents select it from dispatch summaries without being told the directive name.
- R13. The canned exemplar snippets used by plate exemplar and contract preview builders include a timeline snippet, so plate previews and "see it in action" exemplars showcase the component wherever it is allowed or suggested.

### Acceptance Examples

- AE1. **Covers R1, R5, R7.** Given an agent composing on the `plan` plate, when it emits a document containing a `tw:timeline` block with three items (labels + captions), then the compiled render shows a horizontal track with three accent-colored markers, labels above and captions below, correct in both light and dark theme, and DocSpector passes.
- AE2. **Covers R3.** Given a timeline body where the second of four items is marked current, when compiled, then that item alone renders emphasized and the others render as ordinary milestones.
- AE3. **Covers R4.** Given a timeline body with an item missing a label, when compiled, then compilation rejects the block with a diagnostic naming the offending item, and the agent can self-correct in-turn.
- AE4. **Covers R6.** Given a timeline with the maximum supported item count, when rendered in the document iframe and via print CSS, then no label or caption is clipped or overlapped.
- AE5. **Covers R9, R11.** Given a plate whose `allowedDirectives` excludes `timeline`, when a document authored on it includes a `tw:timeline` block, then the availability gate rejects it exactly as it would any other disallowed kind.

### Success Criteria

- An agent asked to "show the rollout phases" (or similar sequence-of-events request) on an allowing plate chooses `tw:timeline` unprompted, based on dispatch summaries and composer guidance.
- The component reads as native house style next to `tw:stats` and `tw:verdict-grid` in the same document — same typography, spacing idiom, and token usage.

### Scope Boundaries

- No interactivity: the document tier is scriptless; hover/click affordances are out.
- No vertical timeline variant, no Gantt-style durations or spans, no branching sequences.
- No per-item colors or tones beyond the theme accent and the current-item emphasis.
- No new plate, genre, or tenant-facing timeline configuration surface.
- No changes to the directive engine's architecture — this adds one spec to the existing registry pattern.

### Dependencies / Assumptions

- Authoring-guidance changes live in the document-composer skill under `packages/workspace-defaults`; shipped guidance reaches existing tenants only through the default-skill reseed/reinstall path, so verification must exercise a re-materialized skill, not just the repo copy.
- Assumption: the reference image in THINK-202 originates from an ad-hoc illustrative visual, so no existing timeline implementation is being replaced — confirmed by the grounding scan finding no timeline/stepper in the document surface.

### Outstanding Questions

All four questions deferred from Brainstorming are resolved in the Planning Contract's Key Technical Decisions below (KTD1 render mechanics, KTD2 overflow, KTD3 section mapping, KTD4 date handling). No open blockers remain.

### Sources

- Plate registry and definitions: `packages/api/src/lib/artifacts/plate-definitions.ts`, `packages/api/src/lib/artifacts/plate-registry.ts` (token vocabulary, exemplar builders, dispatch summaries).
- Directive engine and vocabulary: `packages/api/src/lib/artifacts/document-directives.ts`; base house-style CSS: `packages/api/src/lib/artifacts/document-templates.ts`.
- Chart types incl. funnel (nearest existing sequence visual): `packages/api/src/lib/artifacts/document-charts.ts`.
- Composer skill and authoring rules: `packages/workspace-defaults/files/skills/document-composer/`.
- Vocabulary: `CONCEPTS.md` (Genre Plate, Document Artifact, Document Tier, DocSpector).
- Prior art: THINK-153 (plate registry), THINK-154 (compositor + `tw:` directives), THINK-183/THINK-188 (contract spine, floor-model merge).

---

## Planning Contract

**Product Contract preservation:** changed: R9 — corrected the restricted plate's name from `weekly-status` to `proposal` (the code's explicit allow-list lives on `proposal`; `weekly-status` is `"all"`). Factual correction only; the product intent (timeline available on all nine platform plates) is unchanged. All other R/AE text is preserved verbatim.

### Key Technical Decisions

- **KTD1 — CSS/HTML render, `containsSvg: false`.** The timeline renders as sanitizer-allowlist-compatible markup (divs/spans, `class` attributes only) styled by new `.timeline` rules in `DOCUMENT_PLATE_CSS`, following the `tw:stats`/`tw:verdict-grid` inline path — not the chart placeholder path. Each item draws its own track segment via CSS pseudo-elements running full item width, so a flex-wrapped second row reads as its own edge-to-edge track; `:first-child`/`:last-child` trim the outer ends. Rationale: inherits plate tokens, tenant palettes, and dual-theme behavior for free; wraps naturally; avoids SVG's fixed-viewBox scaling and long-label text pain. The known cosmetic cost — a trailing half-segment at a row break — is accepted (segments are designed full-width so it reads intentional). _(Advisor-confirmed.)_
- **KTD2 — Overflow: hard cap of 8 items + flex-wrap.** Matches the 1–8 caps of `tw:stats` and `tw:verdict-grid`. More than 8 items rejects at compile time with the standard self-repair diagnostic ("split the sequence or aggregate phases"). Narrow viewports wrap items to additional rows; no proportional scaling. Print CSS allows breaks _between_ wrapped rows, never mid-item (`break-inside: avoid` on `.timeline .t-item`, not the container).
- **KTD3 — `suggestedDirectives` mapping (R10):** `proposal` → `scope-of-work` ("phase by phase" delivery) and `qbr` → `next-quarter-plan` (commitments/milestones for the quarter). These are the two genuinely sequence-shaped contract sections; other sections keep their existing suggestions. Requires `proposal.allowedDirectives` to become `["stats", "verdict-grid", "timeline"]` (R9) — the chart exclusion stays, so the plate remains the live restriction example.
- **KTD4 — Date is a verbatim string.** No parsing, normalization, or locale handling; rendered escaped as authored ("Jan 2026", "Q3", "2026-07-06" all valid).
- **KTD5 — Current-item emphasis is not color-only.** The `current` item gets a visibly distinct marker shape/weight (e.g., filled + ring via `--accent`/`--accent-soft` pair) plus bolder label, so emphasis survives DocSpector's dark-mode legibility check and is accessible without color perception.
- **KTD6 — Long-label containment.** Labels and captions get a `max-width` + word-wrap in CSS so one long label cannot balloon its flex item and desync marker spacing (AE4).
- **KTD7 — Registry-derived vocabulary everywhere, plus two hand-maintained mirrors.** Adding `timelineSpec` to `DEFAULT_REGISTRY` automatically extends `DIRECTIVE_KINDS` (unknown-directive diagnostics, plate save-time allow-list validation). Two mirrors must be updated by hand: `PLATE_DIRECTIVE_KINDS` in `apps/web/src/components/artifacts/plates/plate-support.ts` (PlateEditDialog checkboxes + Content Contract suggested-directive picker) and the composer-skill content mirrored in `packages/workspace-defaults/src/index.ts` (parity-tested against `files/`).

### High-Level Technical Design

Directive data flow (all existing seams; the timeline adds one registry entry and one CSS block):

````mermaid
flowchart LR
    A["agent markdown\n```tw:timeline …```"] --> B[compositor fence hook]
    B --> C{allowedDirectives\ngate 1b}
    C -- disallowed --> X[DIRECTIVE_GENRE_RESTRICTED\ndiagnostic]
    C -- allowed --> D[timelineSpec.render\nYAML validate 1–8 items,\n≤1 current, labels required]
    D -- invalid --> Y[DIRECTIVE_INVALID +\ncorrected example]
    D -- ok --> E["inline HTML (.timeline)\ncontainsSvg: false"]
    E --> F[sanitize-html allowlist]
    F --> G[document shell +\nDOCUMENT_PLATE_CSS .timeline rules]
````

Directional markup sketch (guidance, not specification):

```html
<div class="timeline">
  <div class="t-item [current]">
    <div class="t-label">Kickoff</div>
    <div class="t-track"><span class="t-dot"></span></div>
    <div class="t-caption">Contract signed</div>
    <div class="t-date">Jan 2026</div>
  </div>
  <!-- … up to 8 items -->
</div>
```

Authoring shape:

```yaml
items:
  - { label: Kickoff, caption: Contract signed, date: Jan 2026 }
  - { label: Build, caption: Core implementation, current: true }
  - { label: Launch, date: Q4 }
```

---

## Implementation Units

One PR per unit. U1 is independently shippable (timeline live on all `"all"` plates); U2 and U3 each depend on U1 being merged (U2 for `DIRECTIVE_KINDS` save-validation and exemplar compile; U3 because guidance must never reach tenant workspaces before the runtime accepts the directive — dev deploys continuously from `main`, so PR merge order is the ordering mechanism).

### U1. `tw:timeline` directive spec + house CSS

**Goal:** The directive exists, validates, and renders house-styled on every `allowedDirectives: "all"` plate.

**Requirements:** R1–R8, R11; AE1–AE4, plus AE5's gate behavior at unit-test level (the end-to-end AE5 flow belongs to U2).

**Dependencies:** none.

**Files:**

- `packages/api/src/lib/artifacts/document-directives.ts` — `timelineSpec` (kind `timeline`, genres `"all"`, schema string, corrected minimal example, render fn); append to `DEFAULT_REGISTRY`.
- `packages/api/src/lib/artifacts/document-templates.ts` — `.timeline` rules in `DOCUMENT_PLATE_CSS` (flex track, dot markers, current emphasis per KTD5, label max-width per KTD6, print rules per KTD2).
- `packages/api/src/lib/artifacts/document-directives.test.ts` — unit coverage.
- `packages/api/src/lib/artifacts/document-compositor.test.ts` — integration coverage.

**Approach:** Mirror `statsSpec` exactly: `asRecord`/`textOf` validation, `reject()` with spec for self-repair diagnostics, `escapeHtml` on every field. Validate: `items` list 1–8; per-item required `label`; optional `caption`/`date` strings; optional boolean `current` with at-most-one enforcement (diagnostic names both offending indices). Output `containsSvg: false` so the HTML rides the inline + sanitizer path.

**Test scenarios:**

- Happy: 3 items with labels+captions → `ok`, HTML contains `.timeline` with 3 items, no SVG. _(Covers AE1 structure.)_
- Date verbatim: `date: "Q3 '26"` renders escaped, unmodified. _(KTD4)_
- Covers AE2. `current: true` on item 2 of 4 → exactly that item carries the emphasis class.
- Covers AE3. Missing label on items[1] → `DIRECTIVE_INVALID` naming `items[1]`, message includes corrected example.
- Reject: empty `items`, 9 items, two `current: true` items, non-mapping YAML body, YAML parse error — each with self-repair diagnostic.
- Escaping: label `<b>x&y</b>` renders escaped.
- Compositor integration: markdown with a `tw:timeline` fence compiles with `.timeline` markup surviving `SANITIZE_CONFIG` (classes intact); unknown-directive diagnostic vocabulary now lists `tw:timeline`.
- Gate: a plate whose `allowedDirectives` is `["stats"]` rejects `tw:timeline` with `DIRECTIVE_GENRE_RESTRICTED`. _(Covers AE5 at unit level.)_

**Verification (browser, deployed dev):** Sign in to dev web (dogfood auth), in an agent thread ask the agent to produce a plan-plate document whose body includes a `tw:timeline` block with 3–4 items (naming the directive explicitly is fine pre-U3). Open the document artifact in the reader: horizontal track with accent markers, labels above, captions/dates below; toggle light/dark theme — both legible; the `current` item visibly emphasized beyond color alone. Then ask the agent to emit a timeline with a missing label — confirm the agent surfaces/self-corrects from the diagnostic and the corrected document renders. Narrow the viewport (devtools) to confirm wrap-not-clip with 8 items, and check the browser print preview shows no mid-item page break.

### U2. Plate catalog integration: allow-list, suggestions, exemplar, web mirror

**Goal:** The timeline is offered by every platform plate, suggested where sections are sequence-shaped, showcased in plate exemplars/previews, and configurable in the operator UI.

**Requirements:** R9, R10, R13; AE5.

**Dependencies:** U1.

**Files:**

- `packages/api/src/lib/artifacts/plate-definitions.ts` — `proposal.allowedDirectives` → `["stats", "verdict-grid", "timeline"]`; `suggestedDirectives: [{ kind: "timeline" }]` on `proposal`/`scope-of-work` and `qbr`/`next-quarter-plan`.
- `packages/api/src/lib/artifacts/plate-registry.ts` — `timeline` entry in `EXEMPLAR_DIRECTIVE_SNIPPETS` (3-item rollout-phases snippet).
- `packages/api/src/lib/artifacts/plate-registry.test.ts` — exemplar/validation coverage.
- `apps/web/src/components/artifacts/plates/plate-support.ts` — add `"timeline"` to `PLATE_DIRECTIVE_KINDS`.
- `apps/web/src/components/artifacts/plates/PlateContentTab.test.tsx` — picker coverage.

**Approach:** Pure catalog configuration on the seams U1 opened. The exemplar builder picks the snippet up automatically for `"all"` plates and for `proposal` once its allow-list includes `timeline`; save-time validation accepts `timeline` because `DIRECTIVE_KINDS` is registry-derived (KTD7).

**Test scenarios:**

- Platform-definitions/save-gate tests still pass with the extended proposal allow-list and the two new section suggestions (suggestion kinds validate against `DIRECTIVE_KINDS`).
- Exemplar for an `"all"` plate includes a `tw:timeline` block and compiles clean through gate 2 (no diagnostics); exemplar for `proposal` includes timeline but still excludes `chart`.
- Covers AE5. A plate config with `allowedDirectives: ["stats", "verdict-grid"]` rejects a timeline document exactly like any disallowed kind.
- Web: `PLATE_DIRECTIVE_KINDS` renders a Timeline checkbox in PlateEditDialog; Content Contract tab's suggested-directive options include timeline.

**Verification (browser, deployed dev):** In dev web operator settings → Plates: open PlateEditDialog for a tenant plate — Timeline appears in the directive checkboxes and in the Content Contract tab's suggested-directive picker. Open a business plate's preview/exemplar ("see it in action") — the rendered exemplar shows the timeline component in house style. Compose a proposal-plate document with a timeline in Scope of Work — it compiles and renders. Then create/edit a tenant plate delta that unchecks Timeline, compose a document with `tw:timeline` on it, and confirm the availability-gate rejection reads like any other disallowed directive (AE5, end to end).

### U3. Authoring guidance + exemplar-driven adoption

**Goal:** Agents choose the timeline unprompted when a document communicates an ordered sequence of named events (R12); guidance ships through the default-skill path so real tenant workspaces receive it.

**Requirements:** R12; success criteria.

**Dependencies:** U1 (runtime must accept the directive on dev before guidance reaches any tenant workspace).

**Files:**

- `packages/workspace-defaults/files/skills/document-composer/SKILL.md` — a **Timeline** component block (fenced example + field notes) alongside Stat strip / Verdict grid / Chart.
- `packages/workspace-defaults/files/skills/document-composer/references/authoring-rules.md` — selection guidance: trigger is "an ordered sequence of named events or phases"; timeline vs `funnel` (quantitative stage conversion) vs `stats` (headline numbers) vs ordered list (procedural steps that don't need visual scanning).
- `packages/workspace-defaults/src/index.ts` — update both hand-maintained mirrors (KTD7).
- `packages/workspace-defaults/src/__tests__/parity.test.ts` — stays green (files/ ↔ mirror parity).

**Approach:** Documentation-shaped but feature-bearing for R12 — the selection trigger phrasing is the product surface. Keep the example the same 3-item rollout snippet as U2's exemplar for consistency.

**Test scenarios:**

- Parity test passes with the updated mirrors (this is the gate that catches a files/-only edit).
- Test expectation otherwise: none — content change; behavior is proven by the live verification below.

**Verification (browser, deployed dev):** Trigger the default-skill reseed/reinstall path for the dev tenant (the shipped-guidance path in Dependencies/Assumptions — verify against the re-materialized workspace `skills/document-composer/` copy, not the repo copy). Then, in a fresh agent thread in the dev web app, ask for a document that communicates a sequence **without naming the directive** (e.g., "write up our Q3 rollout plan as a document showing the phases from kickoff to launch"). Open the emitted document: it uses `tw:timeline` for the phase sequence, rendered in house style. This proves the success criterion end to end: guidance → dispatch → authoring → compile → render.

---

## Verification Contract

- **Gates per unit (pre-PR):** full `pnpm --filter @thinkwork/api test` (U1/U2), `pnpm --filter @thinkwork/web test` (U2), `pnpm --filter @thinkwork/workspace-defaults test` (U3), plus `pnpm -r typecheck` and `pnpm format:check` — real failures fixed, never bypassed.
- **Per-unit browser flows** as specified in each unit — driven in a real browser against deployed dev after the unit's PR merges and the `main` deploy completes.
- **Final acceptance:** AE1–AE5 each demonstrably pass on deployed dev; the R12 success criterion (unprompted selection) passes after U3.

## Risks & Rollout

- **Row-break half-segment (KTD1):** cosmetic trailing track segment where flex wrap breaks a row; accepted by design. If it reads broken in practice, the fallback is trimming via container queries — a follow-up, not a blocker.
- **Guidance-before-runtime skew:** a tenant whose workspace reseeds between U3's merge and a failed/lagging U1 deploy would author rejected blocks. Mitigated by strict PR ordering (U1 merged + deployed before U3 merges) — dev is continuous CD from `main`.
- **Mirror drift:** the web `PLATE_DIRECTIVE_KINDS` and workspace-defaults `src/index.ts` mirrors are hand-maintained; the parity test covers workspace-defaults, and U2's picker test covers the web list. Missing the web mirror would hide the checkbox but not break compilation (server registry stays authoritative).
- **Rollout:** no schema/migration, no Terraform, no new env. All three units ship via normal PR → `main` → dev CD. Web changes reach production only on the next `desktop-v*` canary tag (apps/web deploys on tags, not `main`) — acceptable: the operator checkbox is a convenience; server-side behavior ships with `main`.

## Definition of Done

- All three unit PRs merged to `main`; dev deploy green after each.
- AE1–AE5 verified in a real browser against deployed dev, per the unit verification flows.
- R12 success criterion verified live: an agent, unprompted, selects `tw:timeline` for a sequence-of-events document on a re-materialized workspace skill.
- No regressions in the existing directive/compositor/plate-registry/parity suites.
