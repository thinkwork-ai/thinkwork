---
title: "fix: www section headlines orphan last word (Templates + friends)"
type: fix
status: active
date: 2026-04-20
---

# fix: www section headlines orphan last word (Templates + friends)

## Overview

The Templates section headline on thinkwork.ai (`apps/www`) wraps with `do.` stranded on its own line at common desktop widths. Two coordinated changes resolve it for Templates and prevent the same failure mode on every other section heading:

1. Apply `text-wrap: balance` (Tailwind `text-balance`) to the shared `SectionHeader` H2, mirroring the convention already in use on `Hero.astro`.
2. Rewrite the Templates headline so the tail token is not a fragile two-character orphan candidate. The lede already says "Define a template once..." so the headline does not need the verb "is allowed to" — it's redundant.

## Problem Frame

- Live at `thinkwork.ai`, Templates section. Headline reads: *"You decide what each agent is allowed to do."*
- Rendered via `apps/www/src/components/SectionHeader.astro` (centered, `max-w-4xl`, `text-3xl md:text-5xl`). The 9-word sentence wraps across ~1100–1400px viewports with "do." alone on line 2. Screenshot confirms.
- The Hero headline already uses `text-balance`, so the codebase has a convention for this — `SectionHeader` just didn't adopt it when it was introduced.
- Adjacent section headlines (e.g. `adoption`, `systemModel`) will benefit from balanced wrapping too, but only Templates currently produces a visible two-letter orphan.

## Requirements Trace

- R1. Templates headline no longer strands `do.` on its own line at any viewport ≥ 360px.
- R2. Fix applies to every section headline, not only Templates — this is a shared typography primitive, not a one-off.
- R3. No regression to Hero typography (Hero uses its own markup and already balances).

## Scope Boundaries

- In scope: `SectionHeader.astro` H2 class, `agentTemplates.headline` string in `copy.ts`.
- Not in scope: Hero headline, FinalCTA headline, CapabilityShowcase feature grid, the broader "looks like shit" visual polish pass the user hinted at in the second screenshot. If that work lands, it gets its own plan.
- Not in scope: rewriting other section headlines prophylactically. `text-balance` alone handles them; copy edits only happen where the current wording also reads clunky.

## Context & Research

### Relevant Code and Patterns

- `apps/www/src/components/SectionHeader.astro` — shared eyebrow+headline+lede lockup, used by every non-Hero section via `CapabilityShowcase` and other wrappers. Currently: `<h2 class="mt-5 text-3xl font-bold leading-[1.1] tracking-tight md:text-5xl">`.
- `apps/www/src/components/Hero.astro` — already applies `text-balance` to the H1 and `text-pretty` to the lede. This is the precedent to follow.
- `apps/www/src/lib/copy.ts` — single source of truth for homepage copy. `agentTemplates.headline` is the string to rewrite.
- `apps/www/tailwind.config.mjs` — stock Tailwind 3.4 config; `text-balance` / `text-pretty` ship as built-in utilities, no plugin or config change needed.

### Institutional Learnings

- None directly applicable from `docs/solutions/`. This is a small, self-contained typography fix.

### External References

- MDN: [`text-wrap: balance`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-wrap) — browser-distributed line balancing for headings. Chrome, Edge, Safari, and Firefox all ship it; falls back to normal wrap on older browsers, which is the current behavior.

## Key Technical Decisions

- **Prefer `text-balance` over `<br>`, `&nbsp;`, or hand-tuned breakpoints.** Hard-coded breaks lock the line shape to one viewport; `text-balance` adapts across widths and future copy edits. The Hero already uses it, so this aligns the two headings under one convention.
- **Rewrite the Templates headline in addition to balancing.** Two-character tail tokens ("do.") are the worst case for line-wrap — even `text-balance` can orphan them under certain font/container ratios. Dropping the redundant "is allowed to" also tightens the sentence, which the surrounding copy already supports.
- **Chosen wording: "You decide what each agent can do."** (34 chars, 8 words). Alternatives considered: "Decide what each agent is allowed to do." (loses the "You" framing that pairs with the rest of the page voice); "You set what each agent can do." (reads too passive). The chosen phrasing keeps the existing subject, trims the redundant verb phrase, and ends on a word with enough character weight to anchor the line.

## Open Questions

### Resolved During Planning

- *Does Tailwind 3.4 ship `text-balance`?* Yes — built-in utility in 3.3+. No config change needed.
- *Should we also rewrite adjacent headlines (adoption, systemModel, etc.)?* No. They read fine and `text-balance` handles their wrapping. Copy edits only where wording is also the weak link.

### Deferred to Implementation

- Visual verification at mobile breakpoints (360–430px). `text-balance` at narrow widths occasionally produces awkward 4-word / 4-word splits on short headlines. If the Templates headline looks worse balanced than unbalanced at mobile widths, the fallback is to keep `text-balance` on desktop only via a media-query variant. This can only be judged with eyes on the rendered page.

## Implementation Units

- [ ] **Unit 1: Add `text-balance` to SectionHeader H2**

**Goal:** Make every section-level headline wrap with balanced lines, matching the Hero convention.

**Requirements:** R2, R3

**Dependencies:** None

**Files:**
- Modify: `apps/www/src/components/SectionHeader.astro`

**Approach:**
- Add the `text-balance` utility to the existing H2 class list. Keep all other classes (`mt-5 text-3xl font-bold leading-[1.1] tracking-tight md:text-5xl`) unchanged.
- Do not touch the lede paragraph — `text-pretty` is a separate decision and the lede already reads fine with default wrapping.

**Patterns to follow:**
- `apps/www/src/components/Hero.astro` — `text-balance` is applied directly as a class on the H1, no variant prefix, no config plugin.

**Test scenarios:**
- Happy path: Templates section at 1440px viewport — headline wraps on a balanced two-line split with no orphan.
- Edge case: narrow desktop (~1100–1280px) — verify `do.` no longer lands alone on line 2.
- Edge case: mobile (360–430px) — headline wraps to 3+ lines; verify no regression vs. current rendering and no single-word final line.
- Integration: other sections that route through `SectionHeader` (Adoption, Controls, Audit, Cost, Evals, System, Memory, Mobile, Quick Start) — verify none regress (i.e. none gain a worse orphan than they had before).

**Verification:**
- Run `pnpm --filter @thinkwork/www dev`, open the homepage, resize through the mobile → desktop range, and confirm all section headlines balance cleanly. No orphaned final word on Templates at any width.

---

- [ ] **Unit 2: Rewrite `agentTemplates.headline` in copy.ts**

**Goal:** Replace the Templates headline with a shorter phrasing that reads tighter and is not vulnerable to a two-character tail orphan.

**Requirements:** R1

**Dependencies:** None (independent of Unit 1 — either change helps on its own, together they are belt-and-suspenders)

**Files:**
- Modify: `apps/www/src/lib/copy.ts`

**Approach:**
- Change `agentTemplates.headline` from `"You decide what each agent is allowed to do."` to `"You decide what each agent can do."`.
- Leave `eyebrow`, `lede`, `features`, `caption`, `imagePath` unchanged. The lede already frames templates as "the contract between a policy decision and the agents that enforce it," which carries the "is allowed to" connotation — removing it from the headline is de-duplication, not loss of meaning.

**Patterns to follow:**
- Every other `headline` field in `copy.ts` trends short and declarative ("Every turn leaves a trace.", "Cost attributed where it happens."). The rewrite brings Templates into that register.
- Voice guardrails at the top of `copy.ts` — the rewrite stays noun/verb-plain, no marketing verbs.

**Test scenarios:**
- Happy path: The Templates headline renders as "You decide what each agent can do." at all viewports; no orphaned `do.`.
- Integration: grep the repo for the old string to confirm no other file referenced it. The only expected hit is `docs/plans/archived/*` if any, which does not affect runtime.

**Verification:**
- Reload the running dev server after edit; confirm the new headline renders and wraps on one or two balanced lines across viewports.

## System-Wide Impact

- **Interaction graph:** None. Pure presentational change. No JS, no data flow, no API.
- **API surface parity:** N/A.
- **Unchanged invariants:** Hero H1 typography, FinalCTA typography, section feature grids, screenshot frames. This plan does not touch anything beyond the two listed files.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| `text-balance` produces a worse split than default wrap at some narrow width | Verify at 360/430/768/1024/1280/1440/1920px during implementation; if a specific breakpoint regresses, scope balance to `md:` and up. |
| Copy change conflicts with content review elsewhere (marketing, README) | The string lives only in `copy.ts`; grep confirms no cross-file duplication. If a future content review wants a different phrasing, it's a one-line edit. |
| Uncommitted local work in main tree (apps/admin/src/routes/__root.tsx) | Not related to this change. Implement in a fresh worktree off `origin/main` to keep the two efforts isolated (per standing guidance). |

## Documentation / Operational Notes

- No docs or ops impact. Single `pnpm --filter @thinkwork/www build` check + dev-server visual sweep is the whole verification surface.
- PR targets `main`, single squash-merge. No staging gate beyond local visual verification.

## Sources & References

- Screenshot of the rendered page with the orphan `do.` — provided inline by user, 2026-04-20.
- `apps/www/src/lib/copy.ts` (origin/main) — source of the current headline and voice guardrails.
- `apps/www/src/components/SectionHeader.astro` (origin/main) — target of the typography change.
- `apps/www/src/components/Hero.astro` (origin/main) — precedent for `text-balance` usage.
