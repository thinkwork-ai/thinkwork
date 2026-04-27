---
title: "feat: Replace www hero headline noun \"runtime\" with \"platform\""
type: feat
status: active
date: 2026-04-27
---

# feat: Replace www hero headline noun "runtime" with "platform"

## Overview

The www homepage hero currently reads **"The runtime for AI agents at work."** User feedback: readers don't understand "runtime" in this sentence. Change the leading noun to **"platform"** so the headline reads **"The platform for AI agents at work."** This is a one-word copy change in the homepage hero only — no other surfaces are touched in this plan.

## Problem Frame

"Runtime" is a load-bearing word in the hero headline but lands as jargon for non-technical buyers. The rest of the homepage already uses more familiar framing (`nav.label = "Platform"`, `meta.description` and `hero.lede` both lead with "infrastructure to run AI agents in production"), so the headline is the outlier. Swapping the noun to "platform" aligns the headline with the surrounding language without changing the architectural, noun-first voice required by the file's voice guardrails (`apps/www/src/lib/copy.ts:1-8`).

## Requirements Trace

- R1. Hero `<h1>` on the www homepage reads "The platform for AI agents at work." after the change.
- R2. Voice guardrails at the top of `apps/www/src/lib/copy.ts` (noun-first, architectural; no verb-forward marketing language) remain satisfied.
- R3. No other homepage section, page, or surface copy is changed in this plan — body copy, FAQ, services page, and cloud page references to "runtime" are out of scope.

## Scope Boundaries

- Other occurrences of "runtime" in `apps/www/src/lib/copy.ts` (lede candidates, services/cloud page copy, AWS Bedrock AgentCore feature label, FAQ answers) are **explicit non-goals** for this plan. They use "runtime" as accurate technical vocabulary in body context, not as the hero category framing, and the user feedback was specifically about the hero headline.
- `headlineCandidates` runner-up list (`copy.ts:49-55`) stays untouched — it's a parking lot for future iteration.
- The internal comment block on `copy.ts:42-45` ("The lede names the runtime pieces first, then explains the operating model") describes the *lede's* content order, not the headline word, so it stays.
- No copy changes to `meta.title`, `meta.description`, or any section other than `hero`.

### Deferred to Follow-Up Work

- A broader audit of "runtime" usage across www marketing copy (10+ occurrences across services/cloud/FAQ): out of scope here; revisit only if the user asks for a follow-up sweep after this change ships.

## Context & Research

### Relevant Code and Patterns

- `apps/www/src/lib/copy.ts:36-63` — `hero` export. The headline is split into four parts (`headlinePart1` / `headlinePart2` / `headlineAccentPart1` / `headlineAccentPart2`) so the design can wrap on small screens (`<br class="md:hidden" />`) and accent the second half (`<span class="text-brand">`).
- `apps/www/src/components/Hero.astro:21-28` — sole consumer of `hero.headlinePart*`. No layout, font, or wrap behavior needs to change: "The platform" has the same word count as "The runtime" and a similar character length.
- Voice guardrails: `apps/www/src/lib/copy.ts:1-8`. "Platform" is noun-first and architectural — passes the guardrail bar.
- Surrounding consistency: `nav` label "Platform" (`copy.ts:25`), `meta.description` "Infrastructure to run AI agents in production" (`copy.ts:32-33`), `hero.lede` "Use the open-source platform yourself or run on ThinkWork Cloud" (`copy.ts:46`). The headline already trails the rest of the page in plain-language framing.

### Institutional Learnings

- None directly applicable. The `docs/solutions/` corpus targets engineering and platform learnings, not marketing copy.

## Key Technical Decisions

- **Noun choice: "platform" over "harness", "infrastructure", or "system".** Confirmed with the user (2026-04-27). Aligns with the existing top-nav label and lede language; avoids the same-class jargon problem "harness" would inherit; reads tighter than "infrastructure" at the typeset hero size.
- **Edit `headlinePart1` only.** The headline is built from four parts — only the first noun phrase changes. `headlinePart2` ("for"), `headlineAccentPart1` ("AI agents"), and `headlineAccentPart2` ("at work.") all stay so the responsive wrap behavior in `Hero.astro` is preserved unchanged.
- **No comment refactor.** The internal comment on `copy.ts:42-45` describes the *lede's* content sequencing, not the headline word, so the change does not invalidate it. Leaving it avoids unrelated diff noise.

## Open Questions

### Resolved During Planning

- Which noun replaces "runtime"? → "platform" (user-confirmed 2026-04-27).
- Is a broader sweep of "runtime" across www in scope? → No. Hero-only per the user's feedback signal.

### Deferred to Implementation

- None — this plan is fully resolved.

## Implementation Units

- U1. **Update hero `headlinePart1` from "The runtime" to "The platform"**

**Goal:** Change the homepage hero's leading noun phrase so the rendered `<h1>` reads "The platform for AI agents at work."

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Modify: `apps/www/src/lib/copy.ts` (line 38: `headlinePart1: "The runtime"` → `headlinePart1: "The platform"`)

**Approach:**
- Single string edit in the `hero` export. No structural changes to the export shape, no new fields, no removed fields.
- Do not touch `headlinePart2`, `headlineAccentPart1`, `headlineAccentPart2`, `headlineCandidates`, or the internal comment block.

**Patterns to follow:**
- Existing `hero` export structure (`copy.ts:36-63`) — preserve part-splitting so the responsive wrap in `Hero.astro:21-28` continues to render correctly.
- Voice guardrails comment (`copy.ts:1-8`) — "platform" is noun-first and architectural.

**Test scenarios:**
- Test expectation: none — `apps/www` has no automated test suite (no `*.test.*` / `*.spec.*` files under `apps/www/`); marketing copy is verified by visual inspection of the rendered page.

**Verification:**
- `pnpm --filter @thinkwork/www dev` (or the repo-standard www dev command) renders the homepage with the headline "The platform for AI agents at work." at desktop breakpoints, and "The platform" / "for" / "AI agents" / "at work." wrapping correctly on the mobile breakpoint where `md:hidden` `<br>`s engage.
- The accent span (`text-brand` color on "AI agents at work.") still renders unchanged.
- `pnpm format:check` and `pnpm -r --if-present typecheck` pass — typecheck is the meaningful gate here since `copy.ts` is consumed as a typed import.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Other www surfaces (services, cloud, FAQ) still say "runtime" and create a mixed-message read for someone scanning the whole site. | Explicit non-goal in this plan; revisit as a follow-up sweep if the user asks. The user's feedback was specifically about hero comprehension, and the body copy uses "runtime" as accurate technical vocabulary inside fully-explanatory paragraphs, where the comprehension problem is far weaker. |
| The internal comment on `copy.ts:42-45` mentions "the runtime pieces first" and could read as stale after the change. | Leave it. The comment refers to the *lede's* enumeration ("threads, memory, sandboxing, tools, controls, cost, and audit"), not the headline noun. Editing it widens the diff without tightening the docstring. Revisit only during a future broader sweep. |

## Sources & References

- Relevant code: `apps/www/src/lib/copy.ts:36-63` (hero export), `apps/www/src/components/Hero.astro:21-28` (sole consumer).
- Voice guardrails: `apps/www/src/lib/copy.ts:1-8`.
