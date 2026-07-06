---
issue: THINK-205
title: "tw:timeline U1 — directive spec + house CSS"
parent: THINK-202
phase: Verification (dogfood QA on deployed dev)
date: 2026-07-06
verdict: PASS (all 9 scenarios green on deployed dev)
pr: "#3454"
merge_commit: 6523f937dce6c3db412b629a71962980aeb37f7b
deploy_run: "28829272666 (success)"
tenant: sleek-squirrel-230 (0015953e-aa13-4cab-8398-2e70f73dda63)
---

# THINK-205 Dogfood Verification — `tw:timeline` directive spec + house CSS

## Contract under test

U1 of THINK-202 (plan `docs/plans/2026-07-06-001-feat-plate-timeline-directive-plan.md`).
PR #3454 adds `timelineSpec` to the Document Compositor's closed `tw:` vocabulary
and `.timeline` house CSS to `DOCUMENT_PLATE_CSS`. Both are **server-side**
(`packages/api`, continuous-CD from `main`) — the compiled document HTML embeds
the CSS in its shell, so the render is fully live on dev (no `desktop-v*` canary
gap). Requirements R1–R8, R11; AE1–AE4 in browser, AE5 at unit level.

Directive shape: `items` list, 1–8 entries; each `{ label (required), caption?,
date? (verbatim), current? (boolean, ≤1 total) }`. Render is sanitizer-safe
HTML (`containsSvg: false`). Current emphasis is non-color-only (filled dot +
`--accent-soft` ring **and** bolder label). Overflow = flex-wrap; print =
`break-inside: avoid` per item.

## Deployment preconditions (confirmed)

- PR #3454 merged 2026-07-06T23:04Z, merge commit `6523f937d`.
- Post-merge Deploy run `28829272666` (main → dev) **completed success**
  (updated 2026-07-06T23:25Z) — dev is running U1.
- Document artifacts compile **only** through the service-secret `document.emit`
  callback the Pi runtime's `emit_document` tool posts to; there is no
  user-facing "compile this markdown" GraphQL path (`documentPlatePreview`
  compiles only the fixed per-plate exemplar, and U2's timeline exemplar snippet
  is not yet merged). Therefore every functional scenario is driven by a **real
  agent turn** emitting a document in a thread — the true end-to-end path.

## Scenario matrix

Seeded from the QA checklist (floor) + plan U1 verification contract, extended
with the mapped end-to-end flow (agent → compositor → persisted artifact →
reader). Each write scenario is paired with a persistence assertion (re-open
fresh).

| # | Scenario | Maps to | Functional | Experiential | Evidence |
|---|----------|---------|:----------:|:------------:|----------|
| S1 | Agent composes plan-plate doc with a `tw:timeline` (4 items, labels + captions, one `current`); artifact compiles, opens in reader with a horizontal track — accent dot markers on a connecting line, bold labels above, captions/dates below, house style | AE1/AE2, R1/R5/R7/R8 | ✅ PASS | ✅ PASS | S1-light.png; extracted markup |
| S2 | Light **and** dark theme on that document; both legible, track/dots/current-ring recolor with theme tokens | R7 dual-theme | ✅ PASS | ✅ PASS | S1-light.png (light), S2-dark.png (dark); computed tokens |
| S3 | `current` item emphasis beyond color: filled dot + soft ring **plus** bolder label vs siblings | AE2, R3, KTD5 | ✅ PASS | ✅ PASS | computed styles; single `t-item current` in markup |
| S4 | Agent emits a timeline with a **missing label** → validation rejects + self-repair in-turn; corrected doc renders | AE3, R4 | ✅ PASS | ✅ PASS | agent reply; corrected docB.html (3 items) |
| S5 | 8-item timeline, narrow viewport (700 / 520px) → items wrap to rows, no clip/overlap of labels/captions | AE4, R6, KTD2 | ✅ PASS | ✅ PASS | S5-700.png, S5-520.png; layout metrics |
| S6 | Print (PDF) of the 8-item document → clean; items atomic, no mid-item split | AE4, R6, KTD2 | ✅ PASS | ✅ PASS | S6-8item.pdf; `break-inside:avoid` rule |
| S7 | Item with `date: "Q3 '26"` renders verbatim | KTD4, R2 | ✅ PASS | ✅ PASS | S1-light.png / S2-dark.png; markup |
| S8 | Persistence: re-open the document fresh after a full page reload → timeline persists identically | plan "persisted document" invariant | ✅ PASS | n/a | re-extracted `srcdoc` byte-identical |
| S9 | Availability gate: a plate excluding `timeline` rejects it with `DIRECTIVE_GENRE_RESTRICTED` — covered at **unit-test** level here (end-to-end AE5 belongs to U2/THINK-206) | AE5, R11 | ✅ unit | n/a | `document-compositor.test.ts` |

## Per-scenario verdicts & evidence

**Environment.** Deployed dev `https://app.thinkwork.ai`, tenant
`sleek-squirrel-230`, signed in as `eric@thinkwork.ai` (Cognito refresh-grant
token injected per the dogfood dev-auth runbook). Documents composed by real
agent turns in thread `6b144078-477e-47c7-89a0-f5bf071c1fbe` (model **Claude
Fable 5**; each `emit_document` turn ran in ~40–55s). The rendered document is a
**sandboxed `srcdoc` iframe** (opaque origin), so functional assertions read the
server-rendered HTML from the iframe's `srcdoc` attribute (the exact compositor
output) and visual assertions come from screenshots/PDF.

### S1 — plan-plate timeline renders in the reader (AE1/AE2; R1/R5/R7/R8) — PASS

Prompted the agent to emit a `plan`-plate document "Q3 Rollout Plan" with a
`tw:timeline` of 4 items (Kickoff / Build `current:true` / Beta / Launch), with
captions and two dates. Artifact emitted `Final · v1` and opened in the docked
reader (`S1-light.png`). Server-rendered markup (verbatim from the iframe
`srcdoc`):

```html
<div class="timeline">
  <div class="t-item"><div class="t-label">Kickoff</div><div class="t-track"><span class="t-dot"></span></div><div class="t-caption">Contract signed</div><div class="t-date">Jan 2026</div></div>
  <div class="t-item current"><div class="t-label">Build</div><div class="t-track"><span class="t-dot"></span></div><div class="t-caption">Core implementation</div></div>
  <div class="t-item"><div class="t-label">Beta</div>…</div>
  <div class="t-item"><div class="t-label">Launch</div>…</div>
</div>
```

Horizontal track, hollow accent dots on a connecting line, bold labels above,
captions/dates below — matching the `tw:stats` house idiom. No `<svg>`
(`containsSvg:false` honored); classes survived `SANITIZE_CONFIG`. The
`.timeline` CSS is embedded in the compiled document shell (server-side, live on
dev — no `desktop-v*` canary dependency). **Functional + experiential: PASS.**

### S2 — light and dark theme (R7) — PASS

The document ships both `:root[data-theme="light"]` / `:root[data-theme="dark"]`
token sets and a `@media (prefers-color-scheme: dark)` block; the timeline uses
only theme tokens (`--line`, `--accent`, `--accent-soft`, `--card`). Real reader
renders **light** legibly (`S1-light.png`, measured `--accent:#0f6b5c`). Forcing
**dark** (`S2-dark.png`) recolors correctly — `--bg:#16181c`, `--accent:#4cc2ab`;
current dot `rgb(76,194,171)` filled with `rgb(18,51,45)` ring; hollow dots
`rgb(29,32,37)` (=`--card`). Both fully legible. **PASS.**

### S3 — current-item emphasis is non-color-only (AE2, R3, KTD5) — PASS

Exactly one `t-item current` in the markup (Build). Computed styles: current dot
= **filled** accent + `0 0 0 3px` `--accent-soft` **ring**; sibling dots =
hollow `--card` with accent border. Current label `font-weight:800` vs siblings
`600`. Emphasis survives independent of color (shape + weight). **PASS.**

### S4 — missing-label rejection + in-turn self-repair (AE3, R4) — PASS

Asked the agent to deliberately emit a `tw:timeline` whose 2nd item has no
`label`. Agent reply: *"The validation error caught the missing label on item 2
and the corrected version (with label Beta added) emitted successfully."* The
malformed emit was rejected by the compositor, the agent self-corrected
**in-turn**, and the corrected "Broken Timeline Test" document renders a valid
3-item timeline (`Alpha`, **`Beta`**, `Gamma` — Beta being the repaired item).
The **exact** diagnostic contract (`DIRECTIVE_INVALID`, `items[1]` named,
corrected `tw:timeline` example inlined) is asserted at unit level in the merged
`document-directives.test.ts`; the browser proves the end-to-end self-repair loop
works on deployed dev. **PASS.**

### S5 — 8-item overflow wraps, no clip/overlap (AE4, R6, KTD2) — PASS

Second agent turn emitted an 8-item plan-plate timeline (Discovery → Support,
Build `current`) — the upper cap is accepted and renders (8 `t-item`s). Layout
metrics on the shipped HTML: 700px → 2 rows; 520px → 3 rows (3/3/2); **no
clipping, no overlap** at either width (`S5-700.png`, `S5-520.png`). Each row
reads as its own edge-to-edge track; Build's filled current dot is preserved
across the wrap. Matches KTD1/KTD2 (accepted trailing half-segment at row
breaks). **PASS.**

### S6 — print / PDF clean, items atomic (AE4, R6, KTD2) — PASS

PDF of the 8-item document (`S6-8item.pdf`): print media applies white bg /
black text; 8 items wrap 6+2, each item atomic (dot stays with its label +
caption), Build's filled current dot preserved, all content on one page. The
shipped shell's print block contains `.timeline .t-item{break-inside:avoid}`
(the KTD2 rule) — so if a page break ever fell across the track it could only
land *between* items, never mid-item. *(Caveat: the document fit on one page, so
no page break actually traversed the timeline in this run; "no mid-item split"
is proven by the rule + item atomicity, not by an observed split.)* **PASS.**

### S7 — date rendered verbatim (KTD4, R2) — PASS

`date: "Q3 '26"` renders exactly as authored (`t-date` = `Q3 '26`, with the
apostrophe) under Launch; `Jan 2026` under Kickoff. No parsing/normalization.
**PASS.**

### S8 — persistence (fresh re-open) — PASS

An agent write-confirmation is a claim, not evidence. After a full page reload
(navigated away and back), re-opened the Q3 Rollout Plan document and
re-extracted its `srcdoc`: byte-identical (6962 chars) to the first render.
Documents are server-persisted artifacts (`Final · v1`), re-fetched and
re-rendered fresh on reload. **PASS.**

### S9 — availability gate (AE5, R11) — PASS (unit-level, per unit scope)

The end-to-end AE5 allow-list flow belongs to U2 (THINK-206). At this unit, the
gate is covered by the merged `document-compositor.test.ts` case: a plate whose
`allowedDirectives` is `["stats"]`-only rejects a `tw:timeline` document with
`DIRECTIVE_GENRE_RESTRICTED`. **PASS (unit).**

## Paper cuts

Experiential nits found while reading as an operator. None fail verification;
each is filed as a non-blocking follow-up.

1. **4-item wrap in the narrow docked panel reads 3+1.** In the ~450px docked
   reader, the 4-item Q3 Rollout Plan wraps `Kickoff/Build/Beta` on row 1 and
   `Launch` alone on row 2 — the lone last item looks slightly unbalanced (it
   renders as a full-width solo track). This is the accepted flex-wrap behavior
   (KTD1) and reads fine at full width; only the very narrow docked panel makes a
   4-item sequence break awkwardly. Cosmetic. Follow-up filed.
2. **Trailing half-segment at row breaks** (KTD1, accepted by design) is visible
   at 520px on the final 2-item row. It reads intentional (segments are
   full-width by design), matching the plan's accepted cosmetic cost. No action
   needed; noted for completeness.

## Decisions for a human

None. All nine scenarios pass; the U1 verification contract (AE1–AE4 in browser,
AE5 at unit level, KTD1/KTD2/KTD4/KTD5/KTD6 exercised) is satisfied on deployed
dev. Both paper cuts are cosmetic and consistent with accepted KTD1 behavior —
filed as non-blocking follow-ups, not handed off as blockers.
