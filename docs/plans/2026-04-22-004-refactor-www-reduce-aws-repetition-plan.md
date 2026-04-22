---
title: "refactor(www): reduce AWS repetition across homepage copy"
type: refactor
status: active
date: 2026-04-22
---

# refactor(www): reduce AWS repetition across homepage copy

## Overview

AWS shows up across the homepage more times than the differentiator itself
needs. The verbatim phrase "AWS account your team already operates" appears
**four times in rendered copy** (journey step 4, controls card 1, ownership
lede, finalCta lede) and "AWS deployment boundary you own" repeats between
`meta.description` and `hero.lede`. The word "AWS" lands ~10 times in rendered
copy when the deployment-ownership claim could be made with 3–4 well-placed
anchors plus product-name mentions (AWS Bedrock AgentCore).

The fix is copy-only: keep AWS loud where it earns its placement (hero, one
governance pillar, ownership anchor, quick-start, finalCta eyebrow, AgentCore
product names) and rotate the middle-of-page duplicates to varied phrasing
("your boundary", "your account", "your ops team").

Nothing about the platform story changes — only the density and rhythm of the
ownership claim.

## Problem Frame

A visitor scanning the homepage reads the AWS-ownership claim restated in
nearly identical words at five separate beats:

- `meta.description` / hero lede — "AWS deployment boundary you own"
- `proofStrip` — "Your AWS account" + "inside your boundary"
- `journey` step 4 — "inside the AWS account your team already operates"
- `controls` card 1 — "Runs in your AWS" + "the account your team already operates"
- `ownership` lede — "AWS account your team already operates" + "boundary your ops team already enforces"
- `finalCta` lede — "Deploy into the AWS account your team already operates"

At six repetitions of essentially one sentence, the differentiator starts to
feel defensive rather than confident. The reader's ear also flags the repeated
verb phrase "your team already operates" — four verbatim occurrences in one
page.

We want the ownership message to feel **said once, reinforced elliptically** —
not recited.

## Requirements Trace

- R1. Reduce rendered "AWS" touchpoints from ~10 to ~6–7 without losing the
  ownership differentiator.
- R2. The verbatim phrase "AWS account your team already operates" must appear
  **zero times** in rendered copy (runner-up `ledeCandidates` entries may keep
  it since they are stored-only).
- R3. Keep AWS in its load-bearing placements: hero lede (establishes it), one
  governance pillar card (`controls.items[0].title`), `ownership.points[0]`
  anchor, `quickStart.headline`, `finalCta.eyebrow`, and AWS Bedrock AgentCore
  product names in audit / evals / memory sections.
- R4. No structural changes — component files stay untouched. Change only
  `apps/www/src/lib/copy.ts`.
- R5. Voice guardrails preserved: noun-first, no marketing verbs, no new
  compliance/vertical claims.

## Scope Boundaries

- Not changing component layout, section order, or screenshots.
- Not touching `hero.ledeCandidates` or `hero.headlineCandidates` — these are
  stored alternates with a header comment saying "locked; runner-ups kept for
  future copy iteration."
- Not renaming/rebranding AgentCore — AWS Bedrock AgentCore is the correct
  product name for the evaluators and is load-bearing in audit / evals /
  memory.
- Not reopening the hero lede decision (shipped in PR #384, reviewed, approved).
- Not adding new sections, CTAs, or rebalancing the adoption / journey
  narrative.

## Context & Research

### Relevant Code and Patterns

- `apps/www/src/lib/copy.ts` — single source of truth for homepage copy; every
  section component imports from here. Voice guardrails live in the top-of-file
  comment (lines 1–8).
- Recent precedent: PR #384 (2026-04-22, commit `c716285`,
  `docs(www): polish homepage copy on top of the journey reframe`) is the
  current working mode for this kind of change — copy-only edits to `copy.ts`,
  visual QA at desktop + mobile, tight commit.
- `apps/www/src/components/*` sections pull named exports from `copy.ts`; no
  component touches raw AWS strings.

### Institutional Learnings

- This is the third copy-polish pass on the homepage in the last 10 days
  (journey reframe → #380; reviewer feedback pass → #384; this one). The
  progression is load-bearing: every pass has trimmed without weakening the
  core claim. Stay consistent with that trajectory — trim, don't rewrite.
- `docs/plans/2026-04-22-002-docs-www-homepage-copy-polish-plan.md` (prior pass
  that shipped as #384) established the pattern of "translate jargon at
  scan-first touchpoints, keep the canonical noun where it's the home for the
  idea." Apply the same principle here: AWS lives in the sections where
  AWS-ness is the topic; it leaves the sections where it's just repeated for
  emphasis.

## Key Technical Decisions

- **Keep AWS explicit in exactly five rendered placements:**
  1. `hero.lede` — establishes the differentiator
  2. `controls.items[0].title` ("Runs in your AWS") — pillar-card label
  3. `ownership.points[0]` ("Stays in your AWS account.") — five-noun anchor
  4. `quickStart.headline` ("Five commands. One AWS account.") — concrete proof
  5. `finalCta.eyebrow` ("Your AWS · Your rules") — closer stamp
- **Plus AWS Bedrock AgentCore product-name mentions** in `audit`, `controls`,
  `evals`, and `memory` — these are the service name, not repetition of the
  deployment claim. Leave untouched.
- **Kill "AWS account your team already operates" in every rendered location.**
  Four verbatim repetitions is an ear-splitting pattern.
- **Trim `ownership.lede`** to say the ownership thing *once* per section,
  not twice. Keep the more distinctive "boundary your ops team already
  enforces" phrasing; drop the first half.
- **`meta.description`** drops "AWS" since the hero lede carries the same
  claim one scroll later; the social-preview line can be more general.

## Open Questions

### Resolved During Planning

- Does the `finalCta.eyebrow` "Your AWS · Your rules" survive the trim? Yes —
  it's a 4-word punctuation beat, not a restatement of the sentence above.
- Does `proofStrip[3].label` "Your AWS account" need to change? Yes — the
  detail line right under it already says "inside your boundary", so the label
  can be "Your boundary" and the card becomes tonally consistent without losing
  meaning.
- Should runner-up `ledeCandidates` / `headlineCandidates` entries be edited?
  No — they are stored-only, header-comment-locked, and the point of keeping
  them is to preserve prior framings for later iteration.

### Deferred to Implementation

- Exact replacement phrasing for `finalCta.lede` — draft options land in
  Unit 2; final choice is a taste call to be made once the neighboring copy is
  visible on screen. Defaults to "Deploy into the account your ops team
  already runs" unless visual QA flags it.

## Implementation Units

- [ ] **Unit 1: Prune AWS from middle-of-page touchpoints**

**Goal:** Remove the three middle-of-page repetitions of "AWS account your
team already operates" so the reader doesn't hear the same sentence at
proofStrip, journey step 4, and controls card 1 in sequence.

**Requirements:** R1, R2, R4, R5

**Dependencies:** None

**Files:**
- Modify: `apps/www/src/lib/copy.ts`

**Approach:**
- `proofStrip[3].label` (line 71): `"Your AWS account"` → `"Your boundary"`
  — pairs with existing detail "inside your boundary" and makes the card's
  voice consistent with other labels ("Start small", "Visible work").
- `journey.steps[3].lede` (line 116): Replace
  `"Your runtime, data, audit trail, and memory stay inside the AWS account your team already operates."`
  with
  `"Your runtime, data, audit trail, and memory stay inside your boundary."`
  — the step is already titled "Keep the harness yours"; saying AWS here is
  restating what the title implied.
- `controls.items[0].desc` (line 164): Replace
  `"The runtime deploys into the account your team already operates. Your data, IAM, and network boundaries stay yours."`
  with
  `"The runtime deploys into your account. Your data, IAM, and network boundaries stay yours."`
  — the card title "Runs in your AWS" already establishes the account; the
  desc can be shorter and crisper.

**Patterns to follow:**
- Voice guardrails at top of `apps/www/src/lib/copy.ts` (lines 1–8).
- Existing shorter proofStrip labels ("Start small", "Visible work", "Governed
  expansion") — single-noun cadence.

**Test scenarios:**
- Integration: `pnpm --filter @thinkwork/www build` succeeds — TypeScript
  exports still resolve and Astro renders the updated strings.
- Visual QA (desktop + mobile): scan proofStrip → journey section 4 → controls
  card 1 and confirm no reader ear-flag on repeated "AWS … your team already
  operates" phrasing.
- Grep guard: `grep -c "your team already operates" apps/www/src/lib/copy.ts`
  returns ≤ 2 (the runner-up `ledeCandidates[3]` entry and the untouched
  `ownership.lede` which is handled in Unit 2).

**Verification:**
- None of the three edited touchpoints use the word "AWS" after the change.
- Proof-strip card 4 reads naturally with its unchanged detail line.

---

- [ ] **Unit 2: Tighten the "ownership home" sections so AWS lands once per section**

**Goal:** Fix the two remaining repetitions — `ownership.lede` says the
ownership claim twice within a single sentence, and `finalCta.lede` restates
the same claim right after the eyebrow already stamped it.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** Unit 1 (same file, cleaner diff if sequenced)

**Files:**
- Modify: `apps/www/src/lib/copy.ts`

**Approach:**
- `meta.description` (line 28): Drop "AWS" — the hero lede carries it on the
  next scroll. Candidate:
  `"The path from AI experiments to trusted AI work. Visible work, governed expansion, and a deployment boundary you own."`
  (drops one word; same meaning; social preview still communicates ownership.)
- `ownership.lede` (line 353): Currently stacks "AWS account your team already
  operates" + "boundary your ops team already enforces" inside one lede.
  Replace with:
  `"ThinkWork deploys into the AWS account your team already runs. As AI becomes part of operations, your runtime, data, audit trail, and memory stay inside the boundary your ops team already enforces."`
  — rotates "operates" → "runs" so the ear doesn't hit the same verb four
  times page-wide, and keeps the distinctive "ops team already enforces"
  clause. The AWS mention stays because this *is* the ownership section's
  home sentence.
- `finalCta.lede` (line 382): The eyebrow already stamps "Your AWS · Your
  rules"; the lede doesn't need to restate "AWS account". Replace with:
  `"Deploy into the account your ops team already runs. Every agent, thread, cost event, and memory stays inside your boundary — under the IAM and governance your ops team already enforces."`
  — drops "AWS" from this sentence (kept in eyebrow), varies phrasing from
  ownership.lede so the closing beat doesn't mirror the section it closes.

**Patterns to follow:**
- Parallel rhythm already used in `ownership.points` ("Stays in your AWS
  account.", "Stays in your boundary.", "Stays inspectable.") — varies noun
  anchors so the idea reinforces through variety, not repetition.

**Test scenarios:**
- Integration: `pnpm --filter @thinkwork/www build` succeeds.
- Visual QA at desktop + mobile: confirm `finalCta` eyebrow + headline +
  lede read as a rhythmic stack (eyebrow = AWS stamp, headline = call,
  lede = detail), not three beats of the same claim.
- Grep guard: `grep -c "AWS account your team already operates" apps/www/src/lib/copy.ts`
  returns 0 in any rendered section (runner-up `ledeCandidates[3]` still
  contains a similar phrase; that's fine — it's not rendered).
- Grep guard: `grep -c "\"AWS" apps/www/src/lib/copy.ts` + human scan confirms
  rendered AWS count is in the 6–8 range (hero, controls pillar title,
  ownership anchor, quickStart headline, finalCta eyebrow, plus 3 AgentCore
  product-name mentions = OK).

**Verification:**
- Reading the full page top-to-bottom, AWS appears in the hero once, as a
  pillar label in governance, in the ownership section once (with the distinct
  "ops team already enforces" clause), in the quickStart headline, and in the
  finalCta eyebrow — five spotlighted beats instead of six near-duplicates.
- `ownership.lede` reads as one claim, not two.
- `finalCta.lede` reads as a resolution of the eyebrow, not a repeat of it.

## System-Wide Impact

- **Interaction graph:** `apps/www/src/components/*` sections re-render with
  updated strings; no prop-shape changes, so no component edits needed.
- **API surface parity:** N/A — this is static marketing copy.
- **Integration coverage:** `pnpm --filter @thinkwork/www build` is the only
  wire test needed. Prettier format:check should pass since we're only
  changing string contents within existing lines.
- **Unchanged invariants:**
  - `hero.lede` stays as shipped in PR #384 (winner of the locked candidate
    set).
  - `hero.ledeCandidates` / `hero.headlineCandidates` stay as stored alternates.
  - All AWS Bedrock AgentCore product-name mentions stay exactly as they are.
  - `controls.items[0].title` "Runs in your AWS" — unchanged.
  - `ownership.points[0]` "Stays in your AWS account." — unchanged.
  - `quickStart.headline` "Five commands. One AWS account." — unchanged.
  - `finalCta.eyebrow` "Your AWS · Your rules" — unchanged.
  - Section order, screenshots, component structure — all unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Softening the AWS differentiator too far | Five spotlighted AWS placements + three AgentCore product mentions remain. Ownership section still has "AWS account" in the anchor point. Hero lede unchanged. |
| Voice drift ("your boundary" feeling generic) | "Your boundary" already appears in proofStrip detail, ownership.points, and ownership.lede — the phrase is established in the page's vocabulary, not new. |
| Social preview (`meta.description`) losing the AWS signal | The preview still communicates ownership ("deployment boundary you own") and the landing hero delivers AWS within the first screen. Acceptable tradeoff — the preview's job is to get the click, not repeat the hero. |
| Reviewer taste call on `finalCta.lede` rotation | The rewrite swaps "operates" → "runs" to vary the verb. If it reads flat in visual QA, fall back to: "Deploy into the AWS account your ops team already runs." — re-adds AWS but with a rotated verb. User-approved at QA time. |

## Documentation / Operational Notes

- No docs, runbook, or operational impact — marketing copy only.
- Rollout is the www deploy pipeline (Astro → Cloudflare Pages or equivalent)
  that PR #384 used. No infra touched.
- Visual QA pass: local dev (`pnpm --filter @thinkwork/www dev`) + screenshots
  at desktop + mobile breakpoints before merge, same as PR #384.

## Sources & References

- Working file: `apps/www/src/lib/copy.ts`
- Prior copy-polish plan: `docs/plans/2026-04-22-002-docs-www-homepage-copy-polish-plan.md`
- Most recent shipping precedent: PR #384 (commit `c716285`,
  `docs(www): polish homepage copy on top of the journey reframe`)
- Voice guardrails: `apps/www/src/lib/copy.ts` lines 1–8
