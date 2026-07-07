---
issue: THINK-206
title: "tw:timeline U2 — plate catalog integration (allow-list, suggestions, exemplar, web mirror)"
parent: THINK-202
phase: Verification (dogfood QA on deployed dev)
date: 2026-07-07
verdict: PASS (5/5 API-side scenarios green on deployed dev; web mirror deferred-to-canary by contract)
pr: "#3460"
merge_commit: 21810b3538e19a634547530a5c7f5f8c8e014472
deploy_run: "28833100605 (success)"
tenant: sleek-squirrel-230 (0015953e-aa13-4cab-8398-2e70f73dda63)
---

# THINK-206 Dogfood Verification — `tw:timeline` plate catalog integration

## Contract under test

U2 of THINK-202 (plan `docs/plans/2026-07-06-001-feat-plate-timeline-directive-plan.md`).
PR #3460 wires the U1 `tw:timeline` directive into the plate catalog:

- **R9** — `proposal.allowedDirectives` → `["stats", "verdict-grid", "timeline"]`
  (chart stays excluded, so proposal remains the live restriction example).
- **R10 / KTD3** — `suggestedDirectives: [{ kind: "timeline" }]` on
  `proposal`/`scope-of-work` and `qbr`/`next-quarter-plan`.
- **R13** — `timeline` entry in `EXEMPLAR_DIRECTIVE_SNIPPETS` (3-item rollout
  snippet), auto-picked-up by `buildPlateExemplar` for every `"all"` plate and
  for `proposal`.
- **Web mirror** — `"timeline"` added to `PLATE_DIRECTIVE_KINDS` (PlateEditDialog
  checkbox + Content Contract suggested-directive picker).

**Requirements:** R9, R10, R13; AE5. **Verdict: PASS.**

**Canary gap (contract):** `apps/web` ships to dev only on `desktop-v*` tags,
not `main` merges. The PlateEditDialog Timeline checkbox and the Content Contract
picker option (web mirror) are **not visible on deployed dev** until the next
canary — verified at unit-test level (`PlateContentTab.test.tsx`, green) and
recorded as **deferred-to-canary**, NOT failed. All API-side behavior (steps
1–4) deploys with `main` (run 28833100605) and is verified live below.

## Deployment preconditions (confirmed)

- PR #3460 merged 2026-07-07T00:37:09Z, merge commit `21810b3538e`.
- Post-merge Deploy run `28833100605` (main → dev) **completed success** — dev
  is running U2. (Confirmed via `gh run view` + `gh pr view`.)

## Environment & method

Deployed dev `https://app.thinkwork.ai`, tenant `sleek-squirrel-230`, signed in
as `eric@thinkwork.ai` (Cognito refresh-grant token minted from
`~/.thinkwork/config.json` and injected into localStorage per the dogfood
dev-auth runbook). Two API-side compile surfaces reach the U2 changes on dev:

1. **`documentPlatePreview` GraphQL query** (user-facing, operator-gated) —
   compiles a plate's exemplar through the real compositor + DocSpector and
   returns HTML inline. Used for the live "see it in action" render checks
   (S2/S5) and the resolved-contract inspection (`documentPlates`, S4). GraphQL
   endpoint `ho7oyksms0.execute-api.us-east-1.amazonaws.com/graphql`.
2. **Agent `emit_document` turn** — the true end-to-end path (agent → compositor
   → persisted artifact → sandboxed `srcdoc` reader iframe). Used for the
   proposal compose (S1) and the AE5 rejection (S3), where authored timeline
   content on a specific plate is required. Agent turns ran on **Kimi K2.5**
   (~40s each) in fresh threads; functional assertions read the server-rendered
   HTML from the iframe's `srcdoc` (exact compositor output), visual assertions
   from screenshots.

Tenant plate deltas were configured via `saveDocumentPlate` (the same operator
mutation the canary-gated PlateEditDialog calls) since the UI checkbox is not on
dev. **All tenant config changed during verification was restored** (see S3).

### Why the exemplar preview surface behaves as it does (important nuance)

The live `documentPlatePreview` resolver calls `buildContractPreviewExemplar`,
not `buildPlateExemplar`:

- For **non-contract** plates (no sections/analyses — `report`, `plan`, `brief`,
  `ideation`, `customer-qbr`) it returns `buildPlateExemplar`, which includes one
  block per allowed directive — so the **timeline snippet renders** in the live
  preview (verified in S2).
- For **contract-bearing** plates (`proposal`, `qbr`, `weekly-status`, …) it
  builds the THINK-188 "contract in action" body (every declared section +
  computed analyses + a waiver demo) and **omits the whole directive gallery**
  — stats, verdict-grid, chart, and timeline alike. This is pre-existing
  THINK-188 behavior, not a U2 change; U2's R13 unit contract (snippet in
  `EXEMPLAR_DIRECTIVE_SNIPPETS`, picked up by `buildPlateExemplar`) is met and
  green. The consequence — the timeline is not showcased in the live preview of
  the two plates where it is *suggested* — is filed as a paper cut + a Decision
  for a human below, not a failure.

## Scenario matrix

Seeded from the QA checklist (floor: steps 1–4) + plan U2 verification contract
(ceiling: R9/R10/R13/AE5), plus the deferred-to-canary web-mirror item.

| # | Scenario | Maps to | Surface | Functional | Experiential | Evidence |
|---|----------|---------|---------|:----------:|:------------:|----------|
| S1 | Proposal-plate document with a `tw:timeline` in Scope of Work compiles + renders house-styled timeline (regression: pre-U2 proposal rejected timeline with `DIRECTIVE_GENRE_RESTRICTED`) | R9; step 1 | agent `emit_document` | ✅ PASS | ✅ PASS | `S1-proposal-timeline.png`; extracted `srcdoc` markup |
| S2 | Live plate exemplar preview renders a `tw:timeline` block in house style | R13; step 2 | `documentPlatePreview` | ✅ PASS | ✅ PASS | preview HTML (plan/report); S1 pixels (same `.timeline` CSS) |
| S3 | AE5 end-to-end: a plate whose allow-list excludes `timeline` rejects an authored `tw:timeline` with `DIRECTIVE_GENRE_RESTRICTED`; agent reports it verbatim; delta removed after | R9/R11/AE5; step 3 | `saveDocumentPlate` delta + agent `emit_document` | ✅ PASS | ✅ PASS | `S3-ae5-rejection.png`; verbatim diagnostic; cleanup confirmed |
| S4 | Suggestion surfacing: `timeline` offered on `qbr`/`next-quarter-plan` and `proposal`/`scope-of-work` in the resolved plate contract | R10/KTD3; step 4 | `documentPlates` (sections → suggestedDirectives) | ✅ PASS | n/a | live GraphQL response |
| S5 | Proposal exemplar/allow-list includes `timeline` but still **excludes** `tw:chart` (restriction preserved) | R9 boundary | `documentPlates` + `documentPlatePreview` | ✅ PASS | n/a | live `allowedDirectives`; proposal preview has no chart |
| C1 | Web mirror: `PLATE_DIRECTIVE_KINDS` includes `timeline`; PlateEditDialog checkbox + Content Contract picker option | web mirror | unit `PlateContentTab.test.tsx` | ✅ unit | deferred-to-canary | 8/8 tests pass locally + merged CI |

## Per-scenario verdicts & evidence

### S1 — proposal accepts + renders a timeline in Scope of Work (R9; step 1) — PASS

In a fresh thread, asked the agent to `emit_document` on the **proposal** plate
("Acme Rollout Proposal") with a `tw:timeline` of 3 phases in Scope of Work. The
agent emitted the artifact — **no rejection** — reply: *"Verification confirmed:
The proposal plate accepts the `tw:timeline` directive."* Server-rendered markup
(verbatim from the reader iframe `srcdoc`):

```html
<div class="timeline">
  <div class="t-item"><div class="t-label">Kickoff</div><div class="t-track"><span class="t-dot"></span></div><div class="t-caption">Contract signed</div><div class="t-date">Jan 2026</div></div>
  <div class="t-item current"><div class="t-label">Build</div><div class="t-track"><span class="t-dot"></span></div><div class="t-caption">Core delivery</div></div>
  <div class="t-item"><div class="t-label">Launch</div><div class="t-track"><span class="t-dot"></span></div><div class="t-date">Q2 2026</div></div>
</div>
```

`S1-proposal-timeline.png` shows the reader rendering the Scope of Work section
as a horizontal track — Kickoff (Contract signed / Jan 2026), **Build** (Core
delivery, filled *current* dot), Launch (Q2 2026) — dots on a connecting line,
bold labels above, captions/dates below, house style matching `tw:stats`. This
is the **regression proof**: before U2 the proposal plate's allow-list
(`["stats","verdict-grid"]`) rejected `tw:timeline` with
`DIRECTIVE_GENRE_RESTRICTED`; U2 added `timeline` and it now compiles and
renders. **Functional + experiential: PASS.**

### S2 — live exemplar preview renders the timeline in house style (R13; step 2) — PASS

`documentPlatePreview(slug: "plan")` and `("report")` (non-contract `"all"`
plates) compiled clean (`diagnostics: []`) and returned the 3-item timeline from
`EXEMPLAR_DIRECTIVE_SNIPPETS`:

```html
<div class="timeline">
  <div class="t-item"><div class="t-label">Kickoff</div>…<div class="t-caption">Goals and owners locked</div><div class="t-date">Week 1</div></div>
  <div class="t-item current"><div class="t-label">Rollout</div>…<div class="t-caption">Phased team onboarding</div></div>
  <div class="t-item"><div class="t-label">Full adoption</div>…<div class="t-date">Q4</div></div>
</div>
```

3 `t-item`s, `t-item current` on Rollout (non-color emphasis), `Week 1`/`Q4`
verbatim (KTD4), rendered alongside the `tw:chart` svg (an `"all"` plate carries
both). The `.timeline` house CSS is embedded in the compiled shell. The rendered
pixels are corroborated by S1 (identical `.timeline` CSS). **PASS.**

_(Nuance: the contract-bearing `proposal`/`qbr` live previews use THINK-188's
`buildContractPreviewExemplar`, which omits the directive gallery — see the
method note + paper cut. R13's unit contract for those plates is covered by the
green `plate-registry.test.ts` "exemplar includes tw:timeline" cases.)_

### S3 — AE5 availability gate rejects a timeline on a disallowing plate (R9/R11/AE5; step 3) — PASS

Created an isolated tenant plate `timeline-gate-check` with
`allowedDirectives: ["stats","verdict-grid"]` via `saveDocumentPlate`, then asked
the agent to `emit_document` a `tw:timeline` on it. The compile rejected; the
agent reported the diagnostic **verbatim** (turn ran 40s, then reported without
retrying a different directive, as instructed):

```
[DIRECTIVE_GENRE_RESTRICTED] tw:timeline: Directive "tw:timeline" is not
available for the "timeline-gate-check" genre. Directives available for
"timeline-gate-check": tw:stats, tw:verdict-grid.
```

The gate rejects `timeline` exactly as it would any disallowed kind (R11), with
a model-actionable diagnostic naming the plate and its available directives.
`S3-ae5-rejection.png` captures the agent turn. **Cleanup:** the tenant plate was
deleted (`deleteDocumentPlate` → `ok:true`); a follow-up `documentPlates` query
confirms `timeline-gate-check` is gone and `proposal.allowedDirectives` is intact
at `["stats","verdict-grid","timeline"]`. **Functional + experiential: PASS.**

### S4 — suggestion surfacing on sequence-shaped sections (R10/KTD3; step 4) — PASS

`documentPlates(tenantId)` resolved-contract inspection (live GraphQL):

- `qbr` / `next-quarter-plan` → `suggestedDirectives: [{ kind: "timeline" }]` ✅
- `proposal` / `scope-of-work` → `suggestedDirectives: [{ kind: "timeline" }]` ✅

Other sections keep their existing suggestions (`qbr/business-outcomes` → stats,
`qbr/usage-trend` → chart:line, `qbr/account-health` → verdict-grid,
`proposal/pricing` → stats). The two genuinely sequence-shaped sections carry the
timeline suggestion, matching KTD3 exactly. The operator UI *picker* that renders
these is web-mirror / canary-gated (C1); the underlying contract data is live and
correct on dev. **Functional: PASS.**

### S5 — proposal keeps chart excluded while adding timeline (R9 boundary) — PASS

Live `documentPlates`: `proposal.allowedDirectives = ["stats","verdict-grid",
"timeline"]` — timeline added, **chart still excluded**, so proposal remains the
library's live directive-restriction example. `documentPlatePreview(slug:
"proposal")` compiled clean with no chart markup. **PASS.**

### C1 — web mirror (deferred-to-canary) — PASS (unit) + deferred

`PLATE_DIRECTIVE_KINDS` gains `"timeline"`; `apps/web` PlateContentTab suite
(incl. "includes timeline in the picker option source") passes **8/8** locally
in this worktree and in merged PR CI. The PlateEditDialog Timeline checkbox and
Content Contract picker option are **not visible on deployed dev** until the next
`desktop-v*` canary — **deferred-to-canary by contract, not a failure.** Server
registry stays authoritative (`DIRECTIVE_KINDS` is registry-derived), so a
missing checkbox would hide the toggle but never break compilation.

### Supporting unit evidence (this worktree, deployed code)

- `packages/api` `plate-registry.test.ts` — **46/46 pass**, including the AE5
  `DIRECTIVE_GENRE_RESTRICTED` case and the "proposal/qbr exemplar includes
  `tw:timeline`, proposal still excludes `tw:chart`" cases.
- `apps/web` `PlateContentTab.test.tsx` — **8/8 pass** (C1 picker option).

## Paper cuts

Experiential nits found while verifying. None fail verification.

1. **Contract-plate live previews don't showcase the suggested timeline.** The
   two plates where `timeline` is *suggested* (`proposal`/`scope-of-work`,
   `qbr`/`next-quarter-plan`) are contract-bearing, so their operator "see it in
   action" preview (`buildContractPreviewExemplar`) renders the contract
   (sections + analyses + waiver) and omits the directive gallery entirely —
   stats, verdict-grid, chart, and timeline are all absent from that view. So an
   operator previewing proposal/qbr never sees the timeline they're being nudged
   toward. This is **pre-existing THINK-188 behavior** (not a U2 regression; all
   directives are treated identically) and R13's snippet-in-exemplar contract is
   met via `buildPlateExemplar` + the green unit tests. Cosmetic/experiential;
   see Decision for a human #1. The timeline *does* render live in non-contract
   plate previews (`plan`, `report`, `brief`, `ideation`, `customer-qbr`).

## Decisions for a human

1. **(Non-blocking, product) Should contract-plate previews surface suggested
   directives?** Today the operator preview for `proposal`/`qbr` shows the
   contract-in-action document and never renders the timeline (or any directive)
   snippet, even though those are the plates where timeline is `suggested`
   (R13's "showcase wherever suggested" intent). This is a THINK-188 boundary
   that predates U2, so it is **out of U2's scope** and does not fail this
   verification. Flagging for THINK-202/U3 or a follow-up: if the "see it in
   action" preview should include suggested-directive examples for contract
   plates, that's a small change to `buildContractPreviewExemplar` (append the
   suggested-section directive snippets), not a U2 defect. No action required to
   close THINK-206.

Otherwise: **none.** All five API-side scenarios pass on deployed dev (R9, R10,
R13, AE5); the web mirror is deferred-to-canary per contract and unit-green.
