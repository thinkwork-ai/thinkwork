---
title: Plate Timeline Directive - Plan
type: feat
date: 2026-07-06
topic: plate-timeline-directive
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
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

- R9. Plates with `allowedDirectives: "all"` (the four core plates and four of the five business plates) offer the timeline with no per-plate change; `weekly-status`'s explicit allow-list is extended to include it.
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

**Deferred to Planning**

- CSS/HTML versus inline-SVG rendering mechanics for the track and markers.
- Overflow mechanism under R6: wrap to additional rows, proportional scaling, or a hard item cap (and its value).
- Exact `suggestedDirectives` section mapping for R10.
- Whether the date field warrants light normalization (verbatim string is the default).

### Sources

- Plate registry and definitions: `packages/api/src/lib/artifacts/plate-definitions.ts`, `packages/api/src/lib/artifacts/plate-registry.ts` (token vocabulary, exemplar builders, dispatch summaries).
- Directive engine and vocabulary: `packages/api/src/lib/artifacts/document-directives.ts`; base house-style CSS: `packages/api/src/lib/artifacts/document-templates.ts`.
- Chart types incl. funnel (nearest existing sequence visual): `packages/api/src/lib/artifacts/document-charts.ts`.
- Composer skill and authoring rules: `packages/workspace-defaults/files/skills/document-composer/`.
- Vocabulary: `CONCEPTS.md` (Genre Plate, Document Artifact, Document Tier, DocSpector).
- Prior art: THINK-153 (plate registry), THINK-154 (compositor + `tw:` directives), THINK-183/THINK-188 (contract spine, floor-model merge).
