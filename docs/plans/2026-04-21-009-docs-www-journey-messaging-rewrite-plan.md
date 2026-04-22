---
title: "docs: reframe www homepage around the AI adoption journey"
type: docs
status: active
date: 2026-04-21
---

# docs: reframe www homepage around the AI adoption journey

## Overview

Rewrite the `apps/www` marketing homepage around one story arc: **AI adoption is a journey, not a switch.** The site currently leads with "The admin console for governed AI adoption" — a product-surface claim. The new lead is "Start small. Build trust. Scale AI safely." — an adoption-posture promise, with governance and ownership as the reasons that posture is believable.

The work is mostly copy rewrites inside `apps/www/src/lib/copy.ts`, plus three new section components (Journey, HowItWorks summary, Ownership) and a reorder of `index.astro`. No backend, no schema, no runtime changes.

## Problem Frame

- **Current messaging** leads with product-surface language ("admin console", "governance primitives"). It describes what ThinkWork *is*, not how a company *adopts* it. The existing sections are individually strong but read as a features catalog rather than a narrative arc.
- **What the user wants instead:** a homepage organized around how a company gets started, builds trust, expands, and keeps ownership — with ThinkWork's primitives (Threads, Memory, Templates, Controls) framed as the *reason* that adoption path feels safe, and ownership (runs in your AWS) as the *closing* argument rather than a scattered proof point.
- **No upstream brainstorm exists** for this change. The feature-description block submitted with this plan contains both the requirements (what to sell, in what order, with what emphasis) and draft copy for most sections. It is treated as the origin document.
- **Scale context:** enterprise prospects evaluating ThinkWork will number roughly 4 enterprises × 100+ agents × ~5 templates in the near term (see memory: `project_enterprise_onboarding_scale`). The site should read to security/ops buyers first, developer curiosity second.

## Requirements Trace

- **R1.** Hero reframes from "admin console for governed AI adoption" to a journey-posture headline. Shortlist: "Start small. Build trust. Scale AI safely." / "From AI experiments to trusted AI work." / "Adopt AI. Keep control." (FinalCTA already owns the last one — pick one of the first two for hero).
- **R2.** Add a new AI-adoption-journey section as the narrative center of the page: *start with small wins → build trust through visible work → expand as confidence grows → keep the harness yours.*
- **R3.** Add a new "How ThinkWork works" summary section that introduces the four primitives (Threads, Memory, Templates, Controls) in business language — a quick orientation that sets up the existing deeper sections below.
- **R4.** Reframe the existing `FiveControls` section as **Governance that grows with usage** (budgets, audit, evaluations, approvals). Keep the five items; change the eyebrow, headline, and lede so the section reads as "the controls that let you expand safely," not as "the product's primitives."
- **R5.** Add a focused **Ownership** section just before QuickStart so ownership is a moment in the story rather than a proof-strip bullet: "Keep the harness yours — your runtime, your data, your audit trail, your memory."
- **R6.** Keep the existing `adoption` section ("You shouldn't have to choose between banning AI and betting the company on it.") — it is already on-message; rewrite bullets only to match the two-bad-options framing and set up the journey that follows.
- **R7.** FinalCTA copy ("Adopt AI. Keep control.") stays — it's the right close for the new narrative.
- **R8.** Meta title/description, proof strip, and nav anchors all update to match the new framing.
- **R9.** Voice guardrails in `apps/www/src/lib/copy.ts` (noun-first, no verticals, no unearned compliance claims, no unverifiable stats, every capability maps to a shipped surface) apply to every new string.
- **R10.** No regressions to typography — `SectionHeader` uses `text-balance` (plan #016). Any new headline must still be wrap-safe at 360px–1440px.

## Scope Boundaries

**In scope:**
- `apps/www/src/lib/copy.ts` — all copy rewrites and new exports
- `apps/www/src/components/*.astro` — 3 new components, 1 reframed component, 0 deletions
- `apps/www/src/pages/index.astro` — composition reorder
- Visual QA pass on the result (dev server, key breakpoints)

**Out of scope:**
- Rewriting `Audit`, `CostControl`, `AgentTemplates`, `SystemModel`, `MemoryWedge`, `MobileApp` section interiors. Their eyebrows/headlines may get light edits to fit the new arc; the feature bullets stay.
- New screenshots, illustrations, or image assets. Any reference to `/images/admin/*.png` keeps its existing path; the new sections use typographic layout, not new imagery.
- Marketing-site infrastructure (Astro config, Tailwind config, SEO tooling, sitemap, analytics).
- Docs site (`docs/` / Starlight) — covered by plan `2026-04-21-008-docs-full-rewrite-thinkwork-docs-site-plan.md`.

### Deferred to Separate Tasks

- **Hero A/B between the two surviving headline candidates:** A decision between "Start small. Build trust. Scale AI safely." and "From AI experiments to trusted AI work." should be made by the user during Unit 1; we do not ship both.
- **New imagery to accompany Journey + Ownership sections:** if the user wants bespoke art, it's a separate visual-design pass.
- **Analytics instrumentation** for the new section anchors (scroll depth, CTA conversion on the new CTA moments) — follow-up if/when analytics land.

## Context & Research

### Relevant Code and Patterns

- `apps/www/src/lib/copy.ts` — **single source of truth** for homepage copy. Header comment already codifies voice guardrails; reuse them. Every section is a named typed export consumed by exactly one component.
- `apps/www/src/pages/index.astro` — composes 12 components in order: `Hero`, `ProofStrip`, `AdoptionProblem`, `Audit`, `CostControl`, `FiveControls`, `AgentTemplates`, `SystemModel`, `MemoryWedge`, `MobileApp`, `QuickStart`, `FinalCTA`. Reorder happens here.
- `apps/www/src/components/SectionShell.astro` + `SectionHeader.astro` — the shared lockup every non-hero section uses (eyebrow + headline + lede + glow). New sections should reuse this rather than invent new shells.
- `apps/www/src/components/AdoptionProblem.astro` — reference pattern for a copy-only section with three numbered cards (matches the shape the new Journey section will use for its four steps).
- `apps/www/src/components/FiveControls.astro` — reference pattern for a five-item grid with icon + title + desc. Will be reframed (copy-only), not rewritten.
- `apps/www/src/components/Hero.astro` — uses `headlinePart1 + headlineAccent` split so the accent word is colored `text-brand`. New hero copy must keep this split shape.
- `apps/www/src/components/FinalCTA.astro` — mirror of Hero shape for the closing CTA. Already says "Adopt AI. Keep control."; no change needed.

### Institutional Learnings

- **Plan #016 (`2026-04-20-016-fix-www-headline-orphan-plan.md`)** applied `text-balance` to `SectionHeader` and reworded the Templates headline to eliminate a two-letter orphan wrap. Any new headlines drafted here must be tested at the same breakpoints — orphans still possible without `text-balance` coverage.
- **Voice guardrails (comment at top of `copy.ts`):** noun-first, architectural. Avoid verb-forward marketing language ("transform", "unlock", "empower"). The user's draft copy is mostly on-voice; watch for softer phrasing ("useful wins", "move forward without losing control") and reshape noun-first where the surrounding sentences allow.
- **ThinkWork supersedes maniflow** (memory: `project_thinkwork_supersedes_maniflow`) — do not let any old positioning or naming leak back into the copy.
- **AWS-native preference** (memory: `feedback_aws_native_preference`) — the ownership moment should frame AWS-resident as the *default*, not a contingency. The user's draft already does this.

### External References

None needed. The user's feature-description block is the authoritative requirements source; the voice guardrails and existing proof-strip language provide the tone reference. No external marketing research adds value for a pure internal messaging rewrite.

## Key Technical Decisions

- **Composition strategy:** add new sections rather than rewriting existing ones in place. `AdoptionJourney`, `HowItWorks`, and `Ownership` are new components; `FiveControls` gets a copy reframe (eyebrow/headline/lede) but keeps its grid and icons. This preserves rollback ease and keeps the diff reviewable.
- **Journey-first order, not governance-first:** the new `index.astro` order is `Hero → ProofStrip → AdoptionProblem → AdoptionJourney → HowItWorks → (deep sections) → FiveControls (as Governance) → Ownership → QuickStart → FinalCTA`. The "deep sections" — `Audit`, `CostControl`, `AgentTemplates`, `SystemModel`, `MemoryWedge`, `MobileApp` — become the evidence layer nested between the narrative arcs, not the narrative itself.
- **Four primitives, not five:** the user's spec names *Threads, Memory, Templates, Controls.* The site's existing `FiveControls` mixes primitives (Templates) with governance moments (Evals, Cost, Runs in AWS, Centralized management). Resolve this by using **Threads, Memory, Templates, Controls** in the new `HowItWorks` summary and reframing `FiveControls` as the Governance section (keeping its five items, which correctly map to governance: AWS boundary, template capabilities, central admin, cost, evals).
- **Ownership as a component, not a proof bullet:** the user specified ownership as its own moment. Create a compact `Ownership.astro` with five "your X stays yours" lines (runtime, data, audit, memory, harness) and place it just before `QuickStart`. `FinalCTA` stays as the close.
- **Hero headline candidate list:** update `hero.headlineCandidates` to the four new options and pin winner as first entry (matching existing convention at `copy.ts:37–42`). User must pick the first entry before Unit 1 lands.
- **No new dependencies.** No new Astro integrations, Tailwind plugins, or npm packages.
- **Nav anchors follow the new order:** `nav` in `copy.ts:17–22` updates to match — `Journey`, `How it works`, `Governance`, `Ownership`, `Quick start`. Anchor IDs on the matching `SectionShell` components follow.

## Open Questions

### Resolved During Planning

- **Which hero headline to ship?** Four candidates exist. Plan pins the winner as first entry in `hero.headlineCandidates` and renders from position 0. User picks before Unit 1 ships. Default: "Start small. Build trust. Scale AI safely."
- **Should `MobileApp` move earlier in the flow (under "Expand as confidence grows")?** No — keep it near the end. Mobile is an end-user *consequence* of trusted adoption, not a journey step. Placement after Governance and before Ownership reads correctly.
- **Do we remove `ProofStrip`?** No. It earns its position right after the hero: a scannable five-bullet grounding before the longer narrative. Copy updates to support the new arc.
- **Is `SystemModel` redundant with the new `HowItWorks`?** They're different zoom levels. `HowItWorks` is a one-liner-per-primitive orientation; `SystemModel` is the architectural diagram showing how the primitives connect. Both stay.

### Deferred to Implementation

- **Exact per-primitive one-liners** for the new `HowItWorks` section. The user's draft gives strong starting points ("Threads keep work visible. Memory carries context forward. Templates enforce boundaries. Controls make adoption governable.") — refine during Unit 3 to match voice guardrails and stay wrap-safe.
- **Whether `Ownership` needs an illustration.** First pass is typography-only. If it feels thin next to adjacent sections, flag during Unit 5 QA and open a follow-up for a simple AWS-boundary diagram.
- **Exact nav label wording** ("How it works" vs "System" vs "Primitives"). Current nav has four labels; the new nav should stay ≤5 labels. Final choice made during Unit 6 in context.

## High-Level Technical Design

> *This illustrates the intended composition shape for review. It is directional guidance, not implementation specification.*

New homepage composition order (`apps/www/src/pages/index.astro`):

```
Header
  Hero                    ← reframed copy (Unit 1)
  ProofStrip              ← refreshed copy (Unit 1)
  AdoptionProblem         ← light copy refresh (Unit 2)
  AdoptionJourney   NEW   ← the narrative centerpiece (Unit 2)
  HowItWorks        NEW   ← four primitives summary (Unit 3)
  Audit                   ← unchanged (evidence for Threads)
  MemoryWedge             ← unchanged (evidence for Memory)
  AgentTemplates          ← unchanged (evidence for Templates)
  SystemModel             ← unchanged (zooms out to architecture)
  FiveControls            ← reframed copy → "Governance that grows with usage" (Unit 4)
  CostControl             ← unchanged (evidence for budgets within governance)
  MobileApp               ← unchanged (end-user consequence)
  Ownership         NEW   ← keep the harness yours (Unit 5)
  QuickStart              ← unchanged
  FinalCTA                ← unchanged ("Adopt AI. Keep control.")
Footer
```

Copy-layer shape in `apps/www/src/lib/copy.ts` (new exports marked NEW):

```
meta                      ← updated title + description
nav                       ← updated anchors
hero                      ← reframed headline/lede
proofStrip                ← 5 bullets, journey-aligned
adoption                  ← light edit: "two bad options" → "third option"
journey              NEW  ← 4 steps × {title, desc, examples?}
howItWorks           NEW  ← 4 primitives × {title, oneLiner, detail}
controls                  ← reframed as "Governance that grows with usage"
ownership            NEW  ← 5 portability lines + lede
quickStart                ← unchanged
finalCta                  ← unchanged
```

## Implementation Units

- [ ] **Unit 1: Reframe hero, meta, and proof strip copy**

**Goal:** Shift the opener from product-surface framing ("admin console for governed AI adoption") to adoption-posture framing ("Start small. Build trust. Scale AI safely."). Update `meta` and `proofStrip` so the top-of-page messaging is internally consistent.

**Requirements:** R1, R8, R9

**Dependencies:** None

**Files:**
- Modify: `apps/www/src/lib/copy.ts` — `meta`, `hero`, `proofStrip`
- Test: `apps/www/src/components/Hero.astro` is rendered via visual QA; no unit test

**Approach:**
- Update `hero.headlinePart1` + `hero.headlineAccent` to split the chosen winning headline on a natural color-accent boundary (e.g., `Start small. Build trust.` + `Scale AI safely.` — accent carries the payoff).
- Update `hero.eyebrow` from "Governed AI adoption" to a journey-posture eyebrow (e.g., "A controlled path to AI work" or "Adopt AI, keep control").
- Rewrite `hero.lede` to the user's draft subhead: "ThinkWork helps organizations introduce AI through small, useful wins, keep the work visible and governed, and expand adoption as trust grows, all inside the AWS account they already operate." — then tighten noun-first per voice guardrails.
- Update `hero.headlineCandidates` — pin winner as position 0, keep 3 runner-ups.
- Update `meta.title` — move away from "admin console for governed AI adoption" to a journey phrasing that still contains "AI" and "governance" for SEO.
- Update `meta.description` — two-sentence version of the new lede; under 160 chars.
- Rewrite `proofStrip` to support the journey arc: one bullet per step (small wins, visible work, governed expansion, owned boundary, plus one credibility bullet). Keep the 5-bullet shape so `ProofStrip.astro` doesn't need layout changes.
- Keep `hero.primaryCta` and `hero.secondaryCta` — they're already correct.

**Patterns to follow:**
- `apps/www/src/lib/copy.ts:30–43` — existing `hero` export shape (keep all fields).
- Voice guardrail comment at top of `copy.ts` — noun-first, no marketing verbs.

**Test scenarios:**
- Happy path: dev server renders hero with new headline accent-colored on `text-brand`; lede fits under the headline without pushing CTAs below the fold at 1440px.
- Edge case: at 360px viewport width, new headline does not produce a one-word orphan on the accent line (confirm `text-balance` on Hero H1 already handles this per `Hero.astro:22`).
- Edge case: `meta.description` stays under 160 characters (Google SERP truncation threshold).
- Content: every bullet in the new `proofStrip` maps to a real shipped surface — nothing aspirational.

**Verification:**
- `pnpm --filter @thinkwork/www build` completes without errors.
- Dev server screenshot at 1440px, 768px, 360px confirms no orphaned words, no layout regression.
- Voice pass: no occurrence of "unlock", "transform", "empower", "revolutionize" anywhere in the new strings.

---

- [ ] **Unit 2: Refresh adoption-problem copy and add the new adoption-journey section**

**Goal:** The existing `adoption` section (`AdoptionProblem.astro` / `adoption` in copy.ts) already carries the "third option" framing but its three bullets currently enumerate ThinkWork's posture ("not a SaaS control plane", "not a policy document", "one system at every scale"). Rewrite bullets to frame the two bad options the user identified (block-and-watch-shadow-adoption vs adopt-too-fast) plus the third-option close. Then build the new `AdoptionJourney` section as the narrative centerpiece.

**Requirements:** R2, R6

**Dependencies:** None (parallelizable with Unit 1)

**Files:**
- Modify: `apps/www/src/lib/copy.ts` — refresh `adoption`; add new `journey` export
- Create: `apps/www/src/components/AdoptionJourney.astro`
- Modify: `apps/www/src/pages/index.astro` — add `<AdoptionJourney />` after `<AdoptionProblem />` (final reorder happens in Unit 6; this unit just wires in the new section after the existing one)
- Test: visual QA; no unit test

**Approach:**
- `adoption` export: keep eyebrow "The third option" and the current headline "You shouldn't have to choose between banning AI and betting the company on it." Rewrite `adoption.lede` and the 3 bullets so the section now reads as **problem → two bad options → third option**, matching the user's "Problem section" draft verbatim (then voice-tightened).
- New `journey` export in `copy.ts`: four steps, each with `{ title, lede, examples? }`:
  1. **Start with small wins** — one assistant, one workflow, one team. Examples list: triage inbound requests, draft responses, summarize work, route tasks, assist inside a defined process.
  2. **Build trust through visible work** — threads carry history and attribution, memory carries context, templates enforce boundaries, budgets and evaluations keep adoption grounded.
  3. **Expand as confidence grows** — more responsibility, more system access, bigger workflows, same governance model.
  4. **Keep the harness yours** — your AWS account, your network, your data, your controls.
- New `AdoptionJourney.astro` component: uses `SectionShell` (id `#journey`, glow appropriate for mid-page) + `SectionHeader` (eyebrow "The AI adoption journey", headline "A practical path to AI adoption"), then renders a 4-step layout. Reference `AdoptionProblem.astro` (3-card grid) for the card shape; scale to 4 cards or use a 2×2 grid for readability. Each card shows step number (01–04), title, lede, and (when present) a compact examples list.
- Register section anchor `#journey` so nav (Unit 6) can link to it.

**Patterns to follow:**
- `apps/www/src/components/AdoptionProblem.astro` — numbered-card grid, `SectionShell` + `SectionHeader` composition.
- `apps/www/src/components/SectionShell.astro` — glow placement convention (`top` / `bottom` / none).
- `copy.ts:68–78` — shape of existing `adoption` export as a model.

**Test scenarios:**
- Happy path: `AdoptionJourney` renders four cards in order, step 01 through 04, each card shows its title, lede, and (for step 1) the five example bullets.
- Happy path: the new `adoption` bullets map cleanly to the "two bad options" framing — one bullet covers blocking and shadow adoption, one covers moving too fast, the third states ThinkWork as the alternative.
- Edge case: at 768px the 4-card grid collapses to 2×2 or 1×4 without layout breakage.
- Edge case: step 1's examples list does not overflow its card at 360px (examples can stack or truncate with "…" if needed).
- Content: step 4 "Keep the harness yours" does not duplicate the Ownership section (Unit 5) verbatim — step 4 is a one-sentence preview; Ownership is the full moment.

**Verification:**
- Dev server shows the journey section immediately after AdoptionProblem, visually distinct but typographically consistent.
- All four steps readable at 360px, 768px, 1440px with no overlap.
- Anchor `#journey` resolves from a temporary test link in Header.

---

- [ ] **Unit 3: Add "How ThinkWork works" four-primitives summary section**

**Goal:** Between the journey and the deeper product sections, insert a compact orientation section that names the four primitives (Threads, Memory, Templates, Controls) in business language. This functions as a table of contents for the evidence sections below (Audit, MemoryWedge, AgentTemplates, FiveControls-as-Governance).

**Requirements:** R3, R9

**Dependencies:** Units 1–2 (copy voice already established by then; easier to match tone)

**Files:**
- Modify: `apps/www/src/lib/copy.ts` — add `howItWorks` export
- Create: `apps/www/src/components/HowItWorks.astro`
- Modify: `apps/www/src/pages/index.astro` — add `<HowItWorks />` after `<AdoptionJourney />`
- Test: visual QA; no unit test

**Approach:**
- `howItWorks` export shape: `{ eyebrow, headline, lede, primitives: [{ title, oneLiner, detail }] }` × 4.
- User's draft lines are the starting point, then voice-tightened noun-first:
  - **Threads** — "Threads keep work visible. Every request, action, and outcome lives in one system of record."
  - **Memory** — "Memory carries context forward. Agents do not start from zero every time. Useful context, decisions, and knowledge stay available."
  - **Templates** — "Templates enforce boundaries. You decide which tools, models, and knowledge each agent can use."
  - **Controls** — "Controls make adoption governable. Budgets, guardrails, evaluations, and audit trails keep AI accountable as usage grows."
- Component `HowItWorks.astro`: `SectionShell` (id `#how-it-works`) + `SectionHeader` (eyebrow "How ThinkWork works", headline something like "Four primitives, one system"). Body: 4-card or 2×2 grid, each card has title + one-liner, with the `detail` text as a smaller block below. No icons required for v1 — kept lean typographically.
- Each card optionally deep-links to the matching evidence section below: Threads → `#audit`, Memory → `#memory`, Templates → `#templates`, Controls → `#controls` (reframed to governance). Anchor wiring happens in Unit 6.

**Patterns to follow:**
- `apps/www/src/components/FiveControls.astro` — multi-card grid with title + description. Use as shape reference; strip icons for v1.
- `apps/www/src/components/SystemModel.astro` — this section is *adjacent* in purpose. Keep `HowItWorks` deliberately lighter than `SystemModel` so the two sections don't duplicate weight.

**Test scenarios:**
- Happy path: four cards render, Threads / Memory / Templates / Controls in that order.
- Happy path: each card's one-liner reads noun-first and has no marketing verbs.
- Edge case: 4-card grid collapses cleanly on narrow viewports.
- Edge case: the section is visually distinct from `SystemModel` — reviewer scanning the page should not confuse them.
- Content: each primitive maps to an existing evidence section below (Threads→Audit, Memory→MemoryWedge, Templates→AgentTemplates, Controls→FiveControls-as-Governance).

**Verification:**
- Dev server shows `HowItWorks` between Journey and the deep sections.
- Clicking a primitive card (if deep-link is wired) scrolls to the matching evidence section's anchor.
- Voice: no occurrence of the forbidden verb list in any of the eight strings.

---

- [ ] **Unit 4: Reframe FiveControls → "Governance that grows with usage"**

**Goal:** The existing `controls` / `FiveControls` section has the right five items (Runs in your AWS, Capability-granted templates, Centralized management, Cost control, Security + accuracy evaluations) but its framing ("Governance primitives, not bolted-on guardrails") is too product-surface. Reframe the eyebrow + headline + lede so the section reads as *"the controls that let adoption grow without losing control"* — matching the user's "Governance that grows with usage" section.

**Requirements:** R4, R9

**Dependencies:** Unit 3 (the HowItWorks "Controls" card deep-links here — anchor and framing must agree)

**Files:**
- Modify: `apps/www/src/lib/copy.ts` — update `controls.eyebrow`, `controls.headline`, `controls.lede`; leave the five `items` untouched except for optional one-sentence phrasing refinements
- Test: visual QA

**Approach:**
- New `controls.eyebrow`: "Governance that grows with usage" (or "Governance that grows with adoption" — pick whichever reads tighter).
- New `controls.headline`: a single sentence framing governance as the enabling condition for safe expansion — e.g., "Budgets, approvals, audit, and evaluations — enforced in code, scaled with usage." Voice-tighten until wrap-safe.
- New `controls.lede`: two sentences. First sentence names the four governance dimensions (budgets, audit, evaluations, approvals). Second sentence makes the *grows-with-usage* point — as agent count, spend, and scope increase, the controls scale without the team re-architecting.
- The five `items` stay; optionally lightly tweak each `desc` so the first clause points at a governance outcome rather than a primitive (e.g., "Capability-granted templates" card could open with "Boundaries enforced at the template layer, not at the prompt").
- `FiveControls.astro` component needs **no structural changes** — it already renders `controls.eyebrow / headline / lede / items`.
- Anchor on the `SectionShell` stays `#controls` so the HowItWorks "Controls" card can deep-link to it.

**Patterns to follow:**
- `apps/www/src/lib/copy.ts:80–111` — existing `controls` shape.
- `apps/www/src/components/FiveControls.astro` — icon + 5-card layout is correct for the new framing; nothing to change.

**Test scenarios:**
- Happy path: dev server renders the section with new eyebrow "Governance that grows with usage", new headline, new lede; five cards and icons unchanged.
- Happy path: new headline wraps without orphaned words at 1440px, 1100px, 768px, 360px (remember `SectionHeader` uses `text-balance` per plan #016).
- Content: every `items[i].desc` still maps to a real shipped surface — no aspirational claims introduced.
- Content: new lede contains the four governance dimensions (budgets, audit, evaluations, approvals) so a reader can skim and orient.

**Verification:**
- Diff on `copy.ts` shows `controls.eyebrow`, `controls.headline`, `controls.lede` changed; `controls.items` mostly unchanged.
- `FiveControls.astro` untouched.
- Screenshot at desktop + mobile confirms the section now reads as the governance chapter of the story.

---

- [ ] **Unit 5: Add Ownership section**

**Goal:** Ownership ("Keep the harness yours.") currently only appears as the FinalCTA eyebrow ("Your AWS · Your rules") and as scattered proof-strip bullets. Give it its own section between Governance and QuickStart so ownership reads as a discrete moment in the story.

**Requirements:** R5, R9

**Dependencies:** Unit 4 (ordering decisions depend on Governance framing being settled)

**Files:**
- Modify: `apps/www/src/lib/copy.ts` — add `ownership` export
- Create: `apps/www/src/components/Ownership.astro`
- Modify: `apps/www/src/pages/index.astro` — add `<Ownership />` between `<MobileApp />` and `<QuickStart />` (final position confirmed in Unit 6)
- Test: visual QA

**Approach:**
- `ownership` export shape: `{ eyebrow, headline, lede, points: [{ title, desc }] }`.
  - Eyebrow: "Ownership"
  - Headline: "Keep the harness yours."
  - Lede: user's draft — "ThinkWork deploys into the AWS account your team already operates, so your runtime, data, audit trail, and memory stay inside your boundary as AI becomes more important to the business."
  - Points (5 items, short title + one-line desc):
    - Your **runtime** stays in your AWS account.
    - Your **data** stays in your boundary.
    - Your **audit trail** stays inspectable.
    - Your **memory** stays portable.
    - Your **harness** stays yours.
- Component `Ownership.astro`: `SectionShell` (id `#ownership`) + `SectionHeader` + a single vertical list or tight 5-row grid. Keep it typographically spare — this is the "closing argument" moment before the CTA, not another feature grid.
- Do not duplicate the `finalCta.lede` phrasing; `finalCta` is a different beat (call to action), this is a conceptual closing.

**Patterns to follow:**
- `apps/www/src/components/AdoptionProblem.astro` — compact, one-section-header-plus-list shape.
- `apps/www/src/lib/copy.ts:292–299` — `finalCta` export is the tonal neighbor; ownership copy should set up `finalCta` without echoing it.

**Test scenarios:**
- Happy path: Ownership section renders five points, each with a bolded "your X" and a short completion clause.
- Happy path: the section visually closes the governance/expansion narrative and flows into QuickStart without repetition.
- Edge case: Ownership copy does not re-state `finalCta.lede` — reader should not feel déjà vu when scrolling past.
- Content: every "your X" clause maps to a real deployable surface (runtime = AgentCore/Lambda, data = Aurora, audit = threads, memory = Hindsight/AgentCore memory engines, harness = the whole CLI + Terraform stack).

**Verification:**
- Dev server shows Ownership just before QuickStart, visually distinct but quiet.
- Reading the page top-to-bottom feels like: *problem → journey → how → evidence → governance → ownership → adopt*.

---

- [ ] **Unit 6: Reorder `index.astro` composition and update nav anchors**

**Goal:** Make the final composition order match the target narrative arc, update nav labels and anchors in `copy.ts`, and ensure every section's `SectionShell` id matches what nav links to.

**Requirements:** R2–R5, R8

**Dependencies:** Units 2, 3, 5 (all new sections exist; reorder requires them)

**Files:**
- Modify: `apps/www/src/pages/index.astro` — reorder component imports and JSX
- Modify: `apps/www/src/lib/copy.ts` — update `nav` array to new labels + anchors
- Modify: `apps/www/src/components/*.astro` — ensure `SectionShell id` matches nav href for any section whose id we've newly introduced or renamed
- Test: click-through QA

**Approach:**
- Final order in `index.astro`: `Hero → ProofStrip → AdoptionProblem → AdoptionJourney → HowItWorks → Audit → MemoryWedge → AgentTemplates → SystemModel → FiveControls (Governance) → CostControl → MobileApp → Ownership → QuickStart → FinalCTA`.
- Rationale for this specific order:
  - `AdoptionProblem` and `AdoptionJourney` form the narrative opening.
  - `HowItWorks` is the quick orientation.
  - `Audit`, `MemoryWedge`, `AgentTemplates` are the evidence for Threads/Memory/Templates (in that primitive order).
  - `SystemModel` bridges from "four primitives" into "how they connect" — a natural zoom-out before the governance chapter.
  - `FiveControls` (as Governance) + `CostControl` are the governance chapter (FiveControls = overview, CostControl = deep dive on one governance dimension).
  - `MobileApp` is the end-user consequence of trusted expansion.
  - `Ownership` closes the narrative argument.
  - `QuickStart` is the credibility + conversion step.
  - `FinalCTA` is the call.
- Update `nav` in `copy.ts` to reflect top-of-funnel labels: `Journey` (#journey), `How it works` (#how-it-works), `Governance` (#controls), `Ownership` (#ownership), `Quick start` (#quick-start). Keep nav to ≤5 labels.
- Verify `SectionShell` `id` on each new component matches exactly: `#journey`, `#how-it-works`, `#ownership`. Verify existing ids on `FiveControls`/`AdoptionProblem`/`SystemModel`/`MemoryWedge`/`QuickStart`/`Audit` are unchanged.

**Patterns to follow:**
- `apps/www/src/pages/index.astro:20–36` — existing composition pattern; preserve the `<main class="overflow-x-clip">` wrapper.
- `apps/www/src/components/SectionShell.astro` — how `id` is passed and rendered.

**Test scenarios:**
- Happy path: page renders in the new order with no missing components, no runtime errors, no duplicate ids.
- Happy path: clicking each nav link scrolls to the correct section and the correct section-shell id.
- Edge case: if a user deep-links to an old anchor (e.g., `/#system`), it still resolves to `SystemModel` — no broken external links from docs or past tweets.
- Edge case: `grep -r "href=\"#" apps/www/src` finds no dangling anchor references.
- Content: nav label count ≤5; no duplicate anchors across sections.

**Verification:**
- `pnpm --filter @thinkwork/www build` completes with no Astro errors.
- `pnpm --filter @thinkwork/www dev` run; click every nav item and confirm correct scroll target.
- Anchor audit: list of `SectionShell id=` across all sections vs. list of `href="#..."` across nav, hero CTAs, and footer — no mismatches.

---

- [ ] **Unit 7: Visual QA pass — breakpoints, orphans, voice guardrails, build, screenshots**

**Goal:** Confirm the rewritten homepage reads as one coherent story at every breakpoint, without layout regressions, orphaned words, voice-guardrail violations, or broken build.

**Requirements:** R9, R10

**Dependencies:** All prior units

**Files:**
- No file modifications expected; this unit surfaces issues that feed back into Units 1–6.
- If issues are found, fix in the originating unit and re-verify.

**Approach:**
- Run `pnpm --filter @thinkwork/www build` — must succeed with no warnings in newly-added components.
- Run `pnpm --filter @thinkwork/www dev` and screenshot the new homepage at 360px (mobile), 768px (tablet), 1100px (narrow laptop), 1440px (desktop).
- **Orphan-word audit:** inspect every section headline for two-or-three-letter trailing orphans. `SectionHeader` has `text-balance` (per plan #016), but new sections using a different layout still need a manual check.
- **Voice pass:** `grep -i` through the new copy for forbidden marketing verbs (transform, unlock, empower, revolutionize, accelerate, streamline, seamless). User's original draft had a few soft phrasings — those should have been tightened during Units 1–5; verify.
- **Consistency pass:** read the page top-to-bottom as a first-time visitor. The arc should feel: *problem → journey → how → evidence → governance → ownership → adopt.* If any section breaks the flow, flag which unit to revisit.
- **Anchor audit:** confirm every nav link resolves to a rendered section-shell id.
- **SEO smoke-check:** verify `<title>` and `<meta name="description">` in the built HTML match `meta.title` / `meta.description`.
- **No screenshots required for the plan** — they are ephemeral verification artifacts, not deliverables.

**Test scenarios:**
- Visual check: no headline wraps with a ≤3-letter orphan at any of the four breakpoints.
- Visual check: the three new sections (Journey, HowItWorks, Ownership) are visually distinct from their neighbors but share the existing `SectionShell` vocabulary.
- Voice check: zero occurrences of the forbidden verb list across the full diff of `copy.ts`.
- Content check: every capability claim maps to a shipped surface or schema (voice-guardrail rule from `copy.ts` header).
- Build check: `pnpm --filter @thinkwork/www build` succeeds; `pnpm format:check` passes on the changed files.

**Verification:**
- All four screenshots look right and have been reviewed by the user (or by a direct feedback loop with the user before shipping).
- No guardrail violations remain.
- Page loads cleanly with no console errors.

## System-Wide Impact

- **Interaction graph:** `apps/www` is a static marketing site. No downstream consumers in the monorepo import from `apps/www/src/lib/copy.ts`, and the only anchors that reference the homepage externally are docs links and inbound traffic. Deep-link compatibility matters (see Unit 6).
- **Error propagation:** none — Astro static build errors are caught at build time.
- **State lifecycle risks:** none. No runtime state, no persistence, no caching beyond CDN.
- **API surface parity:** none. This change does not touch GraphQL, Lambda handlers, or any API contract.
- **Integration coverage:** the only cross-surface consideration is **docs deep links**. If any `docs/` page links into a specific homepage anchor (e.g., `/#controls`), confirm that anchor still resolves after Unit 6. `grep -r "thinkwork.ai/#" docs/` will surface any such references.
- **Unchanged invariants:** voice guardrails at `apps/www/src/lib/copy.ts` header stay; `SectionShell` / `SectionHeader` component API stays; `text-balance` on `SectionHeader` H2 (plan #016) stays; `Hero.astro` and `FinalCTA.astro` component structure (two-part headline with accent word) stays; `FiveControls.astro` component stays; `finalCta` copy ("Adopt AI. Keep control.") stays.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Headline choice regret — we ship "Start small. Build trust. Scale AI safely." and later wish we'd gone with another candidate. | Keep all four candidates in `hero.headlineCandidates` per existing convention. Rotation is a 2-line change later. |
| Collision with plan #016 (`fix-www-headline-orphan-plan`) if both land in parallel — Templates headline may be edited in both. | Before starting Unit 4, `git log` on `apps/www/src/lib/copy.ts` and `SectionHeader.astro`. If #016 has merged, no conflict. If it's mid-flight, land #016 first or rebase this work on top of it. |
| SEO impact from `meta.title` / `meta.description` rewrite — Google may take weeks to re-index; short-term ranking dip possible. | Keep core query terms ("AI adoption", "governance", "AWS") in the new meta. Accept the short-term dip; the new framing is better long-term. |
| New sections read as redundant against existing `SystemModel` / `FiveControls` if voice and weight aren't carefully calibrated. | Unit 3 explicitly calls out the weight difference vs `SystemModel`; Unit 4 reframes (not duplicates) `FiveControls`; Unit 7 visual pass is where redundancy gets caught. |
| Draft copy drifts toward verb-forward marketing during rewriting ("useful wins", "move forward without losing control" in the user's prompt are borderline). | Voice guardrail check is a gate in Unit 7. Run `grep -i` for the forbidden verb list before declaring the pass complete. |
| External deep-links to homepage anchors break if Unit 6 renames anchors without a compatibility alias. | Before renaming any existing anchor, `grep -r` the whole repo and known external destinations (docs, blog drafts if any). Prefer adding new anchors over renaming old ones. |
| User prefers an A/B test on hero messaging before committing. | Out of scope for this plan. If raised, revisit as a separate experiment — this plan ships one version and iterates on copy, not on experimentation infrastructure. |

## Documentation / Operational Notes

- **No operational deploy requirements.** `apps/www` is a static Astro site; shipping is a PR + merge to main, which triggers the existing marketing-site deploy pipeline.
- **Coordinate with docs site rewrite** (plan `2026-04-21-008`). The docs rewrite may re-anchor its own internal links; make sure both rewrites agree on terminology (Threads, Memory, Templates, Controls).
- **Post-ship:** watch `search.google.com/search-console` (if configured) for the `meta.title` reindex. Expect 1–2 weeks.
- **Consider a follow-up** for adding visual assets to Journey and Ownership sections if typography-only feels thin after ship (see Open Questions).

## Sources & References

- **Origin input:** user's feature-description block on the `ce:plan` invocation (no upstream brainstorm doc — the prompt itself is the requirements source).
- **Current copy source of truth:** `apps/www/src/lib/copy.ts`
- **Current composition:** `apps/www/src/pages/index.astro`
- **Adjacent plan (potential conflict on Templates headline):** `docs/plans/2026-04-20-016-fix-www-headline-orphan-plan.md`
- **Adjacent plan (terminology alignment):** `docs/plans/2026-04-21-008-docs-full-rewrite-thinkwork-docs-site-plan.md`
- **Voice guardrails:** comment header of `apps/www/src/lib/copy.ts` (noun-first, no verticals, no unearned compliance claims, no unverifiable stats, every capability maps to a shipped surface)
- **Enterprise scale context:** memory `project_enterprise_onboarding_scale` (4 enterprises × 100+ agents × ~5 templates)
- **Product positioning memory:** memory `project_thinkwork_supersedes_maniflow`, `feedback_aws_native_preference`
