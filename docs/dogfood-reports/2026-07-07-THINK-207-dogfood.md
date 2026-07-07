---
issue: THINK-207
title: "tw:timeline U3 — document-composer authoring guidance + parity mirrors"
parent: THINK-202
phase: Verification (dogfood QA on deployed dev)
date: 2026-07-07
verdict: PASS (distribution gate + R12 unprompted selection + negative guidance all green on deployed dev)
pr: "#3465"
merge_commit: 014e023ded3a0eecc6d88a3682e076ad400f3e7f
deploy_run: "28835663056 (success; Bootstrap reseed step green)"
tenant: sleek-squirrel-230 (0015953e-aa13-4cab-8398-2e70f73dda63)
platform_agent: thinkwork (id c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c)
---

# THINK-207 Dogfood Verification — `tw:timeline` authoring guidance (R12 unprompted selection)

## Verdict: PASS

## Scenario matrix (resume checkpoint)

| # | Scenario | Maps to | Surface | Functional | Experiential | Evidence |
|---|----------|---------|---------|:----------:|:------------:|----------|
| 1 | **Distribution gate** — reseed re-materializes the fresh document-composer skill (Timeline block + R12 selection section) into the dev tenant's installed platform-agent workspace copy | THINK-177/THINK-160; step 1 | Deploy run + S3 workspace copy + live runtime skill-load | ✅ PASS | n/a | `step1-s3-grep.txt`; reseed log; first-turn `workspace_skill` tool result |
| 2 | **R12 positive** — fresh agent thread, sequence-shaped prompt with NO directive named → emitted document uses `tw:timeline` in house style | R12; step 2 | agent `emit_document` turn | ✅ PASS (on retry) | ✅ PASS | `R12-timeline-render.png`, `R12-timeline-content.md`, extracted `srcdoc` |
| 3 | **Negative guidance** — fresh thread, unordered magnitude content → NO `tw:timeline` | R12 negative; step 3 | agent `emit_document` turn | ✅ PASS | ✅ PASS | `NEG-support-issues-content.md`; `class="timeline"` = 0 in render |
| 4 | **Guidance-load corroboration** — the agent loaded the fresh skill copy carrying the Timeline block before authoring | step 4; THINK-160 | agent `workspace_skill` tool result | ✅ PASS | n/a | inline tool result quoting `/workspace/skills/document-composer/SKILL.md` |

## Contract under test

U3 of THINK-202 (plan `docs/plans/2026-07-06-001-feat-plate-timeline-directive-plan.md`).
PR #3465 ships the **authoring guidance** so agents choose `tw:timeline` **unprompted**
for sequence-shaped content:

- `SKILL.md` — a **Timeline** component block (fenced `tw:timeline` example matching
  U2's exemplar; field notes: 1–8 items, `label` required, `caption`/`date` optional +
  rendered verbatim, ≤1 `current: true`).
- `references/authoring-rules.md` — the R12 selection section ("Sequences: when to reach
  for `tw:timeline`"; trigger = "an ordered sequence of named events or phases"; timeline
  vs funnel vs stats vs ordered-list table; negative guidance against forcing timelines
  onto unordered content).
- `src/index.ts` mirrors re-inlined (parity 71/71); `DEFAULTS_VERSION` 33 → 34.

**Requirement:** R12 (unprompted selection). **Verdict: PASS.**

## Deployment preconditions (confirmed)

- PR #3465 merged 2026-07-07T01:45:48Z, merge commit `014e023de`, CI green.
- Post-merge Deploy run **28835663056** (main → dev) completed **success**, including the
  Bootstrap job's "Reseed workspace-defaults to existing tenants (version-aware)" step
  (green, finished 2026-07-07T02:03:29Z). The reseed log shows, for the dev tenant:

  ```
  [seed-defaults] sleek-squirrel-230: seeded (v33 → v34)
  [seed-skills] sleek-squirrel-230/document-composer: workspace copy was stale —
      re-materialized 5 files from the catalog
  [seed-skills] sleek-squirrel-230/document-composer: published + trusted
      (signature=approved_unverified) + installed on platform agent
  ```

## Environment & method

Deployed dev, tenant `sleek-squirrel-230`, acting as `eric@thinkwork.ai` (Cognito
refresh-grant token minted from `~/.thinkwork/config.json`). The platform agent is
slug `thinkwork` (id `c1e4434f-...`), materialized workspace under
`s3://thinkwork-dev-storage/tenants/sleek-squirrel-230/agents/thinkwork/`.

Agent turns were driven end-to-end through the real GraphQL API
(`ho7oyksms0.execute-api.us-east-1.amazonaws.com/graphql`): `createThread` → `sendMessage`
(`role: USER`, `agentDispatch: FORCE_ON`) → poll `thread.lifecycleStatus` +
`artifacts(threadId)` → read `artifact { content, renderHtml }`. `content` is the
`emit_document` digest markdown (grep for the ```` ```tw:timeline ```` fence); `renderHtml`
is the compiled single-file HTML `srcdoc` the reader iframe shows (grep for the rendered
`<div class="timeline">` body markup — note the house CSS embeds a `.timeline` **stylesheet
rule** in every document, so the meaningful positive signal is `class="timeline"` in the
body, not the always-present CSS). Turns ran on **Kimi K2.5** (`moonshotai.kimi-k2.5`).
Fresh thread per scenario.

## Per-scenario verdicts & evidence

### 1 — Distribution gate (step 1) — PASS

The mandatory precondition: the *re-materialized workspace copy* (not the repo copy) must
carry the guidance. Fetched the installed platform-agent skill from S3 (`step1-s3-grep.txt`):

- `agents/thinkwork/skills/document-composer/SKILL.md` → `grep -c 'tw:timeline'` = **1**
  (line 82: `**Timeline** — an ordered sequence of named events or phases on a horizontal…`).
- `agents/thinkwork/skills/document-composer/references/authoring-rules.md` →
  `grep -c 'ordered sequence of named events or phases'` = **1**; section
  `## Sequences: when to reach for \`tw:timeline\`` present (line 64).
- S3 object timestamps: written 2026-07-07T02:03:18–19Z — i.e. by this deploy's reseed
  (matches the reseed-log line above), not a stale copy.

Independently corroborated live at runtime (see scenario 4): the agent's own
`workspace_skill` tool call returned `/workspace/skills/document-composer/SKILL.md`
containing the Timeline block — proving the deployed Pi runtime loaded the fresh copy.
**PASS.**

### 2 — R12 positive: unprompted `tw:timeline` selection (step 2) — PASS

R12 is probabilistic agent behavior; the brief allows one retry (two consecutive
document-producing misses with a confirmed-fresh skill = FAIL). Progression:

- **Attempt A** (thread `f11b8150`, prompt = the brief's canonical *"Write up our Q3
  rollout plan as a document showing the phases from kickoff to launch."*): the agent
  loaded document-composer, then asked clarifying questions ("What are we rolling out?
  When does Q3 start?") and emitted **no document**. Non-result (no component chosen) —
  not counted as a selection miss; re-run with a self-contained prompt.
- **Attempt B** (thread `ccf0f0ff`, artifact `89f6695d`, REPORT "Q3 Product Rollout"):
  self-contained phased prompt. The agent emitted a document laying out Kickoff → Internal
  Beta → Customer Pilot (current) → Full Launch, but rendered the sequence as a **GFM
  "Phase Overview" table** — no `tw:timeline` (`content` fence count 0, render
  `class="timeline"` 0). Genuine **miss #1**. (The prompt itself supplied a phase/status
  table shape, which likely primed the table choice — see paper cut #1.)
- **Attempt C — retry** (thread `2bb90c06`, artifact `a65cdc4e`, PLAN "Q4 Customer
  Onboarding Rollout"): a clean *narrative* sequence prompt (Q4 onboarding: discovery in
  October → configuration/migration in early November → two-week guided pilot in late
  November "that's the stage we're planning toward right now" → go-live and handoff in
  December), no directive named, no table framing. The agent chose **`tw:timeline`
  unprompted** (plus a `tw:stats` "Key Dates" strip). Extracted `content` fence:

  ```
  ```tw:timeline
  items:
    - { label: Discovery,     caption: Workshop and requirements gathering, date: October }
    - { label: Configuration, caption: System setup and data migration,     date: Early November }
    - { label: Guided Pilot,  caption: Two-week structured testing period, current: true, date: Late November }
    - { label: Go-Live,       caption: Full launch and team handoff,        date: December }
  ```
  ```

  Server-rendered `srcdoc` (verbatim, house style):

  ```html
  <div class="timeline">
    <div class="t-item"><div class="t-label">Discovery</div><div class="t-track"><span class="t-dot"></span></div><div class="t-caption">Workshop and requirements gathering</div><div class="t-date">October</div></div>
    <div class="t-item"><div class="t-label">Configuration</div>…<div class="t-date">Early November</div></div>
    <div class="t-item current"><div class="t-label">Guided Pilot</div>…<div class="t-date">Late November</div></div>
    <div class="t-item"><div class="t-label">Go-Live</div>…<div class="t-date">December</div></div>
  </div>
  ```

  `R12-timeline-render.png` shows the reader: a horizontal track under the Summary —
  Discovery (Oct), Configuration (Early Nov), **Guided Pilot** (single emphasized/filled
  *current* dot, Late Nov), Go-Live (Dec) — bold labels above, captions/dates below,
  exactly one `current` phase, dates rendered verbatim (KTD4). This proves the R12 success
  criterion end to end: **guidance → dispatch → authoring → compile → render.** The track
  reads as one continuous line (consistent with the merged/re-verified THINK-205 U1
  track-gap repair — no visual ambiguity). Miss-then-pass is within the one-retry
  allowance. **Functional + experiential: PASS.**

### 3 — Negative guidance: no timeline on unordered content (step 3) — PASS

- **Attempt A** (thread `f96647db`): the turn degenerated into a runaway `"I'll!!!!…"`
  sequence (a Kimi K2.5 model glitch) and emitted no document. Non-result; re-run.
- **Attempt B** (thread `dfec2c74`, artifact `d2b5f949`, REPORT "Top Support Issues —
  Monthly Summary"): prompt = this month's top support issues by ticket volume (login 42,
  billing 30, dashboard 25, mobile 18, export 12 — explicitly "not a sequence"). The agent
  emitted a document with a **ticket-volume table** + `tw:stats` + `tw:chart` +
  `tw:verdict-grid` and **NO `tw:timeline`** (`content` fence count 0; render
  `class="timeline"` = 0). Unordered magnitude content correctly stayed
  tables/stats/chart — the negative guidance ("don't force a timeline onto content with no
  inherent order") holds. **Functional + experiential: PASS.**

### 4 — Guidance-load corroboration (step 4) — PASS

In attempt A of scenario 2 the agent's `workspace_skill{slug:"document-composer"}` tool
result returned the full `/workspace/skills/document-composer/SKILL.md`, which contains the
**Timeline** component block verbatim (fenced `tw:timeline` example + field notes). This is
direct evidence that the deployed Pi runtime loaded the freshly re-materialized skill copy
(stronger than the S3 read, since it is what the model actually saw). **PASS.**

## Paper cuts

Experiential nits found while verifying. None fail verification.

1. **R12 selection competes with prompt framing.** Of the two prompts that produced a
   document, the *table-scaffolded* one (attempt B, which itself listed phases with a
   status column) yielded a GFM table; the *narrative* one (attempt C) yielded the
   timeline. The guidance nudge ("reach for it whenever the content is 'first this, then
   this'… don't wait to be asked") works, but a strongly table-shaped prompt can still win.
   This is expected probabilistic model behavior on Kimi K2.5, not a guidance defect — the
   R12 criterion (unprompted selection succeeds) is met. Worth a future eval case if we
   want to measure selection rate.
2. **Kimi K2.5 runtime noise.** One turn asked clarifying questions on a sparse prompt;
   one negative turn degenerated into a runaway `"!"` sequence. Both are model-runtime
   instability unrelated to U3's content change; they only required re-running with
   self-contained prompts. Not attributable to the timeline guidance.

## Decisions for a human

None blocking. (Optional, non-blocking: if we want a hard number on unprompted-selection
rate, add a document-composer selection eval — the guidance ships correct and is loaded by
the runtime; this report demonstrates the criterion, not a rate.)

## Evidence index (`docs/dogfood-reports/evidence-THINK-207/`)

- `step1-s3-grep.txt` — installed platform-agent workspace copy grep (distribution gate).
- `R12-timeline-render.png` — reader screenshot of the emitted Q4 onboarding timeline.
- `R12-timeline-render.html` — the compiled `srcdoc` (self-contained HTML render).
- `R12-timeline-content.md` — the `emit_document` digest markdown (contains the
  `tw:timeline` fence).
- `NEG-support-issues-content.md` — the negative document's digest markdown (no timeline).

Dogfood threads left on dev (evidence): `f11b8150` (R12 A), `ccf0f0ff` (R12 B / miss),
`2bb90c06` (R12 C / pass), `f96647db` (NEG A / model glitch), `dfec2c74` (NEG B / pass).
No tenant config was mutated (read-only agent turns + S3 reads); nothing to restore.
