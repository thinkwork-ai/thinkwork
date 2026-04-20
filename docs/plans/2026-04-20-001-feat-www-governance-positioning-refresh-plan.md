---
title: "feat(www): Reposition public site around governed AI adoption for enterprise CTOs"
type: feat
status: active
date: 2026-04-20
---

# feat(www): Reposition public site around governed AI adoption for enterprise CTOs

## Overview

Rewrite the narrative and refresh the UI of `apps/www` so the public site speaks to enterprise CTOs in AI-skeptical organizations, not just developers evaluating open-source infrastructure. The current site leads with *"AI infrastructure in your AWS. Without the black box."* — this positions "runs in your AWS" as **the** headline. Based on prior-art research, that slot is actually an unoccupied trust *proof*, not a headline — it works much harder as supporting evidence under a governance-led narrative.

The new narrative argues that organizations are being asked to either ban AI entirely or adopt it naively, and ThinkWork is the third option: a governed path to adoption. Five existing, production-shipped capabilities back this: AWS containment, agent templates with capability grants, centralized management, cost control and analysis, and security/accuracy evals. The current home also under-markets Wiki Memories and the mobile app as benefits that follow the trust story.

Scope is tight: keep the Astro + Tailwind bones, brand system, and section-card visual vocabulary; replace or add ~6 components; capture 3 new admin screenshots; tighten copy everywhere; run a visual-polish pass. No new pages, no CTA changes, no backend work.

The driver is a conference this week where the sales lead meets external CTOs. The plan is sized to ship in days, not weeks.

## Problem Frame

The current `apps/www/src/pages/index.astro` home page was written for developers discovering the project: the Hero talks about "open agent infrastructure," pillars describe self-hostability, and the system model assumes the reader already wants to run agents. That framing leaves the real strategic question unanswered for a CTO audience: *why should we let our organization use AI agents at all, and why via ThinkWork rather than banning it?*

Three specific gaps:

1. **Wrong headline burden.** "Runs in your AWS" is a differentiator but not a *reason to care*. It answers "where does it live" before the reader has decided AI adoption is safe at all.
2. **Under-marketed controls.** Agent templates, capability grants, centralized admin, cost controls, and evals are all production-shipped (confirmed by codebase audit — see Context & Research) and barely mentioned. Those are exactly what a skeptical CTO needs to see.
3. **Benefits undersold.** Wiki Memories, the mobile app, and the unified thread/memory model are shown but not tied to "what employees actually gain from adopting this rather than banning it."

Conference constraint: the sales lead is meeting CTOs this week. The plan must produce a ship-ready site in a few days, not a multi-week redesign.

## Requirements Trace

- R1. Replace the site's implicit thesis from *"self-hosted agent infrastructure"* to *"governed AI adoption that enterprise controls can sign off on."*
- R2. Feature five existing capabilities as the core governance story: **AWS containment, agent templates / capability grants, centralized management, cost control & analysis, security + accuracy evals**.
- R3. Retain and reframe Wiki Memories, the mobile app, and the unified threads/memory model as *benefits* of adopting ThinkWork, placed after the trust story.
- R4. Keep developer entry paths intact: docs link, GitHub link, Quick Start section, and `admin.thinkwork.ai` login button remain the only CTAs. No new contact form, no Calendly, no lead capture.
- R5. Framing is industry-agnostic. Do not name specific verticals (healthcare, financial services, legal) in hero or proof copy.
- R6. Preserve the existing Astro/Tailwind structure, brand color (`#38bdf8`), section-card vocabulary, and animation utilities. No framework changes, no new dependencies.
- R7. Add three new admin-UI screenshots (templates editor, cost analytics, evaluation run) under `apps/www/public/images/admin/` and use them as evidence in the new capability sections.
- R8. The result must look tighter and more "enterprise-trustable" than the current site — not flashier. Visual polish runs under the `frontend-design` skill as the last pass, not the first.
- R9. Update SEO/meta in `apps/www/src/layouts/Base.astro` and the OG image so social previews match the new story.
- R10. Ship to `main` in time for the conference.

## Scope Boundaries

- Marketing copy, layout, and screenshots of the `apps/www` single-page site only.
- No new routes, no blog, no resource library, no case studies, no customer logos.
- No changes to `docs.thinkwork.ai`, `admin.thinkwork.ai`, the mobile app, or any backend.
- No brand-color change, no typography swap, no logo rework. The `BrainMark` component stays.
- No new dependencies. Stay on Astro 5, Tailwind 3, and the existing component pattern.
- No telemetry/analytics additions.
- No lead-capture forms, Calendly embeds, or pricing page.
- No changes to the five commands in `QuickStart.astro` unless the CLI itself has changed (it has not per current `package.json` — verify at implementation time).
- English only; no i18n changes.

### Deferred to Separate Tasks

- A dedicated "For enterprises" page, pricing, or /security subpage: may follow if the conference surfaces demand.
- Lead capture form or book-a-demo flow: explicitly decided against for this pass.
- Rename of the `@thinkwork/www` Astro app or hosting changes: out of scope.
- Compliance attestation badges (SOC2 / HIPAA / ISO) — can be added later when actually earned; showing them without certification would contradict the "don't overclaim" principle.

## Context & Research

### Relevant Code and Patterns

Current `apps/www` structure:

- `apps/www/src/pages/index.astro` — the only page; composes all components.
- `apps/www/src/layouts/Base.astro` — shared head/meta, body background, global animation keyframes (`fade-in-up` + `delay-100/200/300/400`).
- `apps/www/src/components/` — eight section components plus `Header.astro`, `Footer.astro`, `BrainMark.astro`.
- `apps/www/tailwind.config.mjs` — brand palette (`#38bdf8` default with 50–900 shades). No custom plugins.
- `apps/www/astro.config.mjs` — Astro 5 + `@astrojs/tailwind`.
- `apps/www/public/images/admin/{dashboard,memories-graph}.png` — existing screenshots used today.
- `apps/www/public/images/mobile/{threads-list,tasks-list}.png` — existing mobile screenshots.
- `apps/www/public/og-image.png` — current social preview.

Established visual vocabulary to reuse:

- Section container: `<section class="border-t border-white/5"><div class="mx-auto max-w-6xl px-6 py-24 md:py-32">…`.
- Eyebrow label: `<p class="text-xs font-semibold uppercase tracking-[0.24em] text-brand/90">…`.
- Card pattern: `rounded-2xl border border-white/5 bg-white/[0.02] p-7`.
- Accent card (hero-adjacent): `rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/[0.06] to-transparent p-8`.
- Glow blur pseudo-illumination: absolutely-positioned `bg-brand/8 blur-[160px]` circles behind the section content.
- Typography rhythm: `text-3xl md:text-5xl` for section H2, `text-lg md:text-xl` for lede body, `text-sm leading-6 text-slate-400` for card body.
- Fade-in animation: `animate-fade-in-up` with `delay-100/200/300` class utilities defined in `Base.astro`.

Admin-UI capabilities confirmed to exist and be screenshot-worthy (from code audit):

- **Agent templates editor** at `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx` — shows `blocked_tools`, guardrail picker, skill assignments, KB attachments.
- **Cost analytics** — `apps/admin/src/routes/_authed/_tenant/-analytics/CostView.tsx` with GraphQL `CostSummaryQuery`, `CostByAgentQuery`, `CostByModelQuery`, `CostTimeSeriesQuery`, and per-agent budget via `SetAgentBudgetPolicyMutation`.
- **Evaluations run detail** — `/evaluations/$runId` with pass-rate chart + per-test breakdown; test cases link to `agentcore_evaluator_ids` (AWS Bedrock AgentCore built-ins) and custom assertions in `packages/database-pg/src/schema/evaluations.ts`.
- **Wiki memories graph** — existing screenshot already used.

### Institutional Learnings

- No matches in `docs/solutions/` (directory does not exist). This plan does not build on prior compound learnings for `apps/www`.
- Frontmatter + MEMORY.md notes confirm: `pnpm` in workspace (not npm); PRs target `main`, never stack; worktree isolation for any in-flight work.

### External References

Prior-art survey of the enterprise-governance-for-AI category (web research, April 2026):

- **Credal** leads with *"The Control Plane for Enterprise Agents"* — noun-first architecture language, neutral tone.
- **Cohere** uses *"Enterprise AI: Private, Secure, Customizable"* + VPC/on-prem framing in the sub-copy.
- **Writer / LangSmith / Portkey / Arize** are all in the same category but lead with different lanes: aspiration (Writer), observability (LangSmith/Arize), production control plane (Portkey).
- None of the surveyed competitors leads with *"runs in your AWS account"* as a **primary trust signal**. That is an unoccupied position ThinkWork can legitimately own.
- Pattern that works for a CTO audience: **noun-first architecture language** ("control plane", "your VPC", "governed") outperforms verb-forward aspirational copy ("transform", "unlock", "empower").
- Compliance badge rows (SOC2 / HIPAA / ISO) read as trust anchors *below* the fold; placing them in-hero looks like compliance-consulting templating. Since ThinkWork does not currently hold these attestations, we omit the row entirely rather than gesturing at it.
- Useful cross-domain analogy: "Ban AI vs. adopt with guardrails" mirrors 2010–2014 cloud adoption (Dropbox ban → Box "your tenant"). Worth keeping in the voice even if not literal in copy.
- Strong supporting stats exist (Writer 2026 survey on shadow AI, Deloitte 2026 governance maturity, etc.), but the user's chosen framing is **industry-agnostic** — we will lean on *patterns* rather than cited statistics in the copy, to avoid stat-bait hero design.

### Conference Posture

- Deadline: end of this week.
- Audience: CTOs from multiple regulated industries, meeting a sales lead in person.
- The site's job is to *back up* the in-person conversation: it must look credible at a glance, the five capabilities must be legible within 30 seconds of scrolling, and nothing on it should read as aspirational vaporware.

## Key Technical Decisions

- **Keep the Astro/Tailwind bones.** Rewriting the scaffold is not a good use of the conference week, and the existing visual vocabulary is already solid. Replace components in place.
- **Single-page site stays single-page.** Every new section lives as a sibling `.astro` component composed in `apps/www/src/pages/index.astro`. No routing work.
- **Narrative is a single copy document, locked first.** All component changes read from one canonical copy source (embedded in this plan's Copy Lock unit). This avoids the common failure mode where six components drift to six subtly different voices.
- **No new npm/pnpm dependencies.** The current site ships with only `astro` + `@astrojs/tailwind` + `tailwindcss`. Anything new (icons, charts, fonts) has to justify itself against the conference deadline — default answer is "inline SVG, reuse Tailwind."
- **Admin screenshots are static PNGs, not interactive embeds.** Capture cleanly in a realistic demo tenant, check them into `apps/www/public/images/admin/`, reference as `<img src="/images/admin/…">`. Same pattern as `dashboard.png` and `memories-graph.png` today.
- **No compliance badges in v1.** ThinkWork does not currently hold SOC2/HIPAA/ISO attestations; showing the icons would contradict the "don't overclaim" bar CTOs are trained to spot.
- **Headline voice: noun-first, not aspirational.** E.g. "The governed path to AI adoption" outperforms "Unlock safe AI" for this audience.
- **`frontend-design` skill runs last, not first.** It polishes a finished narrative; it doesn't drive the narrative. This keeps the design work from rewriting copy that the business has already locked.
- **Section-ordering optimizes for a CTO's scan pattern:** (1) Hero → (2) proof strip → (3) the adoption problem → (4) five controls → (5) three detailed capability showcases → (6) centralized admin → (7) memory/wiki benefit → (8) mobile benefit → (9) quick start → (10) final CTA. Developer-oriented material (Quick Start, GitHub link) sits after the governance story so both audiences get what they came for, in the right order.
- **Do not change the five CLI commands** in `QuickStart.astro` unless the CLI itself has changed. Verify at implementation time by reading `apps/cli/README.md` or `apps/cli/package.json`.

## Open Questions

### Resolved During Planning

- *Add a sales/demo CTA for the conference?* → No. User chose "keep docs/GitHub only." In-person sales is doing the lead capture; the site backs it up.
- *Name the target industry (e.g., healthcare)?* → No. Industry-agnostic framing only; conference audience is mixed.
- *Full visual overhaul vs. targeted polish?* → Targeted polish + new sections. Preserve brand and layout; replace and add components; use `frontend-design` as the last pass.
- *Lead with "runs in your AWS"?* → No. It becomes the first pillar of the governance story, not the hero headline.
- *Cite hard stats in hero?* → No. The user's industry-agnostic choice plus the "don't overclaim" bar argues for pattern-framing, not stat-bait.

### Deferred to Implementation

- **Final hero copy wording.** The Copy Lock unit produces 2–3 candidate headlines; the implementer picks after reading both on-screen. Candidates are directionally constrained but not yet word-locked.
- **Exact admin-screenshot tenant state.** The implementer decides which demo tenant produces the cleanest shots (templates editor needs real template data; analytics needs >1 week of cost events; evals needs a recent successful run). This depends on what demo data is currently available.
- **Whether to retain the `BrainMark` glow in the hero.** Visual polish pass decides after seeing the new copy on-screen.
- **Exact component split of the "Three detailed capability showcases" section** — one component with three sub-sections vs. three sibling components. Decided when the copy length for each section is known.
- **Whether `MemoryWedge.astro` is renamed or reframed in place.** If the component becomes a "Wiki Memories benefit" section rather than "the wedge," rename during implementation to keep git history legible.

## Output Structure

Only new files are listed; modified existing files are called out per implementation unit below.

```
apps/www/
  public/
    images/
      admin/
        agent-templates.png      # new — capabilities editor screenshot
        cost-analytics.png       # new — cost view with per-agent breakdown
        evals-run.png            # new — evaluation run detail with pass rate
      og-image.png               # replaced — new governance-led social preview
  src/
    components/
      AdoptionProblem.astro      # new — the "ban or adopt" framing section
      FiveControls.astro         # new — the five governance pillars (replaces WhyThinkWork)
      AgentTemplates.astro       # new — capability-grant showcase w/ admin screenshot
      CostControl.astro          # new — cost attribution + budgets w/ admin screenshot
      Evals.astro                # new — security + accuracy evals w/ admin screenshot
```

`WhyThinkWork.astro` is removed once `FiveControls.astro` supersedes it.

## High-Level Technical Design

> *This illustrates the intended narrative and section flow for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

New index composition, top to bottom:

```
Header
Hero                       — new headline + lede + CTAs; reuse BrainMark glow
ProofStrip                 — reframed to the 5 governance proof points
AdoptionProblem            — NEW: "the third option" framing, no stats, noun-first
FiveControls               — NEW: 5 pillar cards (replaces WhyThinkWork)
AgentTemplates             — NEW: screenshot + "you decide what each agent can do"
CostControl                — NEW: screenshot + "attribution + budgets"
Evals                      — NEW: screenshot + "AgentCore built-ins + custom assertions"
SystemModel                — reframed: "One admin surface for all of it"
MemoryWedge (reframed)     — moved AFTER the control story, positioned as benefit
MobileApp                  — unchanged
QuickStart                 — copy tightened only
FinalCTA                   — copy relanding the governance story
Footer
```

Narrative arc, in one sentence per section:

```
Hero          : Organizations shouldn't have to choose between banning AI or adopting it naively.
ProofStrip    : Five specific controls make ThinkWork safe to say yes to.
AdoptionProblem: The ban-or-adopt question is false — here's the third option.
FiveControls  : The five controls, enumerated.
AgentTemplates: Template-level capability grants — one specific control, with proof.
CostControl   : Spend attribution and per-agent budgets — a second specific control, with proof.
Evals         : Security + accuracy gates — a third specific control, with proof.
SystemModel   : All of the above live inside one admin surface.
MemoryWedge   : And your organization gets portable, inspectable memory as a durable asset.
MobileApp     : And your end users get a native app, not a web-form experience.
QuickStart    : Here's how your team starts.
FinalCTA     : Ownership stays yours.
```

## Implementation Units

- [ ] **Unit 1: Lock the narrative and copy doc**

**Goal:** Produce a single authoritative copy source for every new and reframed section so downstream units don't drift.

**Requirements:** R1, R2, R3, R5, R6

**Dependencies:** None — blocks every other component unit.

**Files:**
- Create: `apps/www/src/content/copy.md` (or a `const copy = {...}` module in `src/lib/copy.ts` — implementer picks; `.md` if the content is prose-heavy, `.ts` if sections want typed arrays)
- No Astro components touched in this unit.

**Approach:**
- Write final headline + 2 runner-up candidates for the Hero.
- Write eyebrow + H2 + lede for each section: AdoptionProblem, FiveControls, AgentTemplates, CostControl, Evals, and reframed SystemModel / MemoryWedge / FinalCTA.
- Write card-level copy for FiveControls (5 short entries) and ProofStrip (4 short entries).
- Write screenshot captions for the three capability showcases.
- Voice guardrails to encode in the doc itself: noun-first, no verticals, no unearned compliance claims, no unverifiable stats, no "transform/unlock/empower" verbs.
- Decide final section IDs (`#system`, `#controls`, `#templates`, `#cost`, `#evals`, `#memory`, `#mobile`, `#quick-start`) for the Header nav anchors.

**Patterns to follow:**
- Current copy tone in `apps/www/src/components/Hero.astro` and `WhyThinkWork.astro` — terse, declarative, minimal marketing adjectives. Keep that voice; sharpen the thesis.

**Test scenarios:**
- Happy path: the locked copy renders cleanly at 320px, 768px, and 1280px when dropped into the existing card grids (verified in Unit 7, but length-budget this unit so it can).
- Edge case: each FiveControls entry stays ≤ 24 words of card body so the 5-up grid does not wrap unevenly.
- Edge case: no headline or H2 exceeds 60 characters (ensures `text-3xl md:text-5xl` stays on two lines max at desktop).
- Test expectation: none for this unit beyond length/readability review — no behavioral code changes.

**Verification:**
- Copy doc exists, every downstream component unit can import or reference it by key.
- Three CTOs-at-the-conference persona review sentences ("would this make you feel ok defending the decision to your board?") pass a dry read.

---

- [ ] **Unit 2: Capture the three new admin screenshots**

**Goal:** Produce clean, marketing-grade PNGs of the agent-templates editor, cost-analytics view, and evaluation-run detail page in `apps/www/public/images/admin/`.

**Requirements:** R2, R7

**Dependencies:** None — runs in parallel with Unit 1. Blocks Units 5a–5c.

**Files:**
- Create: `apps/www/public/images/admin/agent-templates.png`
- Create: `apps/www/public/images/admin/cost-analytics.png`
- Create: `apps/www/public/images/admin/evals-run.png`

**Approach:**
- Run the admin app locally against a tenant that has: ≥ 3 agent templates with varied capability grants; ≥ 1 week of cost events across multiple agents and models; ≥ 1 recent evaluation run covering tool-safety + accuracy evaluators. If the current dev tenant is thin, consider pointing at the demo tenant instead (see MEMORY.md `Admin worktree Cognito callbacks` for the port-vs-callback-URL gotcha).
- Match the existing screenshot sizing and aspect ratio of `dashboard.png` and `memories-graph.png` so the homepage's existing figure styling continues to work unchanged.
- Remove or obscure any PII, real tenant names, or customer data before committing.
- Prefer wide, single-screen shots (no stitched scrolls) so they compose well in the capability-showcase sections.

**Patterns to follow:**
- `apps/www/public/images/admin/dashboard.png` as the format and density reference.
- `apps/www/src/components/MemoryWedge.astro`'s `<figure>` + `<figcaption>` pattern is the target render shape.

**Test scenarios:**
- Happy path: each PNG loads at full width in a `max-w-6xl` container without visible aliasing at 2x DPI.
- Edge case: no PII, no debug banners, no "localhost:5175" URL bars visible.
- Edge case: file size stays under ~400 KB each so LCP is not degraded.
- Test expectation: none — static asset capture, no runtime behavior to test.

**Verification:**
- All three files exist, are committed, and are free of sensitive content.
- When dropped into a throwaway Astro page, each renders crisp at desktop widths.

---

- [ ] **Unit 3: Hero, Header, Base meta**

**Goal:** Deliver the new hero and supporting chrome so the top 1.5 screens of the site teach the new thesis in under 10 seconds.

**Requirements:** R1, R2, R6, R9

**Dependencies:** Unit 1 (copy lock).

**Files:**
- Modify: `apps/www/src/components/Hero.astro` — new headline, lede, eyebrow; keep BrainMark, keep the two primary CTAs (`Read the docs`, `View on GitHub`), keep the glow blurs.
- Modify: `apps/www/src/components/Header.astro` — update the nav anchors to the new section IDs locked in Unit 1; no new links.
- Modify: `apps/www/src/layouts/Base.astro` — update the default `description` prop to the new thesis.
- Modify: `apps/www/src/pages/index.astro` — update the `<Base title>` to match the new voice.
- Replace: `apps/www/public/og-image.png` — new social preview echoing the hero thesis at 1200×630.

**Approach:**
- Hero keeps structure: eyebrow pill → H1 → lede → two CTAs. Swap the copy, not the layout. Expect H1 to wrap to two lines at desktop (matches the current `md:text-6xl lg:text-7xl` rhythm).
- Decide whether the `BrainMark` glow stays at hero intro or graduates — default is keep; reconsider only in Unit 7 polish.
- Header nav must not exceed the current six-link desktop layout; if the new section IDs overflow, drop `#mobile` rather than `#quick-start` (developers still need a direct line to it).
- OG image can be rebuilt with the same brand palette in whatever tool is fastest (Figma, a tiny Astro-rendered page, or manual Photoshop). Must match 1200×630 dimensions that `Base.astro` already advertises.

**Patterns to follow:**
- Existing Hero component's `pointer-events-none absolute` blur stack — reuse exactly.
- Existing Header's `md:flex` nav + mobile menu toggle — leave the toggle behavior untouched.

**Test scenarios:**
- Happy path: Hero headline renders on two lines at ≥ 1280px and three lines at 375px without overflow. Both CTAs remain tappable at 44×44px minimum.
- Happy path: Header nav anchors scroll to the correct sections once Unit 5/6/7 land — spot-check each link.
- Edge case: new `description` in `Base.astro` is ≤ 160 characters (search-snippet cap).
- Edge case: OG image renders correctly in a Twitter/X card validator and Slack unfurl.
- Error path: missing OG image file falls back to the existing 1200×630 asset shape, not a broken image.

**Verification:**
- Astro dev preview shows new hero, new nav, and new meta in `<head>`.
- Social-card preview (Slack paste or Twitter validator) returns the new title + description + OG image.

---

- [ ] **Unit 4: `ProofStrip` reframe + `AdoptionProblem` new section**

**Goal:** Install the mid-hero proof strip echoing the five controls, then introduce the "the ban-or-adopt question is a false choice" framing before the reader hits the detailed capability sections.

**Requirements:** R1, R2, R6

**Dependencies:** Unit 1 (copy).

**Files:**
- Modify: `apps/www/src/components/ProofStrip.astro` — replace the four current bullets with the five governance proof points (reduce to four if five cannot fit the `md:grid-cols-4` without wrapping — decision made when copy is tried on-screen).
- Create: `apps/www/src/components/AdoptionProblem.astro`.
- Modify: `apps/www/src/pages/index.astro` — compose `<AdoptionProblem />` between `<ProofStrip />` and the to-be-added `<FiveControls />`.

**Approach:**
- `ProofStrip` stays structurally identical; only the `points` array changes. If the copy forces five tiles instead of four, switch to `md:grid-cols-5` and shorten each bullet.
- `AdoptionProblem` is a single-column section: eyebrow, H2, a short lede paragraph, and a 3-line "the third option is this" claim set. No cards, no screenshots — it is a *framing* section, not a feature section. Its visual job is to slow the eye before the five-up grid hits.
- Background alternation: since `ProofStrip` already uses `bg-white/[0.02]`, `AdoptionProblem` uses the default page background and a border-t divider, matching `WhyThinkWork`'s rhythm today.

**Patterns to follow:**
- `WhyThinkWork.astro` layout shell (eyebrow → H2 → lede → body) is the structural template for `AdoptionProblem`.
- `ProofStrip.astro` grid layout stays — only data changes.

**Test scenarios:**
- Happy path: at desktop, ProofStrip renders as four or five evenly-sized tiles without wrap. AdoptionProblem reads as one calm paragraph block without visual noise.
- Edge case: at 375px, ProofStrip collapses to `grid-cols-2` the same way it does today (still legible). AdoptionProblem H2 wraps to ≤ 3 lines.
- Edge case: copy under each ProofStrip label stays ≤ 2 lines at 375px.
- Test expectation: none for AdoptionProblem beyond visual/length review — static content, no behavior.

**Verification:**
- Dev preview shows the new ProofStrip, then AdoptionProblem, with no layout break at mobile/tablet/desktop breakpoints.

---

- [ ] **Unit 5: `FiveControls` (replaces `WhyThinkWork`)**

**Goal:** Enumerate the five governance controls as the backbone of the new narrative — the anchor that every later section pays off.

**Requirements:** R1, R2, R6

**Dependencies:** Unit 1 (copy).

**Files:**
- Create: `apps/www/src/components/FiveControls.astro`.
- Delete: `apps/www/src/components/WhyThinkWork.astro` (after `FiveControls` is in place and index.astro references it).
- Modify: `apps/www/src/pages/index.astro` — replace `<WhyThinkWork />` with `<FiveControls />`.

**Approach:**
- Five cards: AWS containment, Agent templates, Centralized management, Cost control, Security + accuracy evals. Each with an inline-SVG icon (no icon library — draw the five icons with `<path>` following the existing MemoryWedge pattern of `stroke="currentColor" stroke-width="2"` line-art at 20–24px).
- Section header mirrors the current `WhyThinkWork` shell: eyebrow "Controls" → H2 (from copy doc) → lede paragraph → grid of five cards.
- Card grid: `md:grid-cols-2 lg:grid-cols-5` so the five-up lockup is only enforced at large screens; at medium it's two columns with a balanced wrap.
- Each card: inline SVG icon top-left, short card H3, 2–3 line description, no "Learn more" link (the capability showcases below *are* the learn-more).
- Keep card body copy ≤ 24 words per Unit 1's length budget.

**Patterns to follow:**
- `MemoryWedge.astro`'s inline-SVG icon styling is the template for the five icons.
- `WhyThinkWork.astro`'s card shell (`rounded-2xl border border-white/5 bg-white/[0.02] p-7`) is the reference shape — reuse verbatim.

**Test scenarios:**
- Happy path: five cards render `lg:grid-cols-5` on desktop, wrap to `md:grid-cols-2` on tablet, and stack at mobile.
- Happy path: each card's icon + title + body sits on the same baseline at each breakpoint (no card taller than siblings by ≥ 40px).
- Edge case: if the copy forces a 6th control (future), the component accepts N cards without breaking the lockup.
- Edge case: focus state on each card is visible if the card becomes a link in Unit 7 polish.
- Test expectation: none beyond layout — static content.

**Verification:**
- Dev preview: five cards read cleanly at all three breakpoints, icon set feels consistent, no stray spacing.
- `WhyThinkWork.astro` is deleted and nothing else references it (grep check).

---

- [ ] **Unit 6: Three capability showcases — `AgentTemplates`, `CostControl`, `Evals`**

**Goal:** For the three most defensible controls, pair concrete admin-screenshot proof with 3–5 bullet claims each, so a CTO scrolling past sees the product doing the thing, not a promise to do it.

**Requirements:** R2, R6, R7

**Dependencies:** Unit 1 (copy), Unit 2 (screenshots).

**Files:**
- Create: `apps/www/src/components/AgentTemplates.astro`.
- Create: `apps/www/src/components/CostControl.astro`.
- Create: `apps/www/src/components/Evals.astro`.
- Modify: `apps/www/src/pages/index.astro` — compose the three in order after `<FiveControls />`.

**Approach:**
- Each showcase follows one consistent layout: eyebrow + H2 + lede on the left; admin screenshot in a figure on the right (at desktop, `lg:grid-cols-2`). On mobile, screenshot stacks below the copy.
- Under the lede, 3–4 specificity bullets (e.g., for AgentTemplates: "Allow-list of tools per template", "Per-template model pin", "Guardrail attachment by reference", "Promote-to-agent sync"). These are the *proof* that backs the pillar's one-sentence claim in FiveControls.
- Screenshots use the existing `<figure>` / `<img>` / `<figcaption>` lockup from `MemoryWedge.astro`. Captions cite the admin route (e.g., "Admin web · agent-templates editor").
- Alternate background tone per section so the three showcases don't read as a wall: default bg, `bg-white/[0.015]`, default bg. Matches the existing alternating rhythm.
- Do not embed live product data: screenshots are static PNGs from Unit 2.
- Call out the **AWS Bedrock AgentCore** relationship in the Evals section's bullets so the "runs in your cloud using your AWS Bedrock" story lands as a second proof-of-containment.

**Patterns to follow:**
- `MemoryWedge.astro`'s two-column grid with figure is the primary template.
- `SystemModel.astro`'s eyebrow + H2 + lede + evidence-figure structure is the reference for hierarchy.

**Test scenarios:**
- Happy path: each showcase renders two-up at desktop, stacked at mobile, with screenshot below copy on mobile.
- Happy path: each screenshot's `<img>` has a descriptive `alt` attribute (> 10 chars, describes what the admin view shows).
- Edge case: if one screenshot is much taller than another, the grid column does not collapse or produce large blank space — verified visually.
- Edge case: caption text matches the actual admin route; link/route references do not drift from `apps/admin`'s real paths.
- Edge case: LCP image on the first showcase uses `loading="eager"`; the other two use `loading="lazy"`.
- Test expectation: none beyond layout — static content.

**Verification:**
- Dev preview: scrolling from FiveControls through the three showcases feels like a single consistent argument — screenshot, claim, screenshot, claim, screenshot, claim.
- Alt text survives an accessibility-tree spot check in DevTools.

---

- [ ] **Unit 7: Reframe `SystemModel`, `MemoryWedge`, `FinalCTA`, `QuickStart`; remove stale references**

**Goal:** Bring the existing sections into voice alignment with the new narrative. These sections stay structurally but get tightened copy, updated eyebrows, and (for `MemoryWedge`) a narrative relocation from "wedge" to "durable benefit."

**Requirements:** R1, R3, R6

**Dependencies:** Unit 1 (copy), Units 3–6 in place (so the surrounding rhythm is visible when editing).

**Files:**
- Modify: `apps/www/src/components/SystemModel.astro` — reframe eyebrow from "System model" to something like "One admin surface"; keep the four primitive cards; update lede to pay off the "centralized management" pillar specifically.
- Modify: `apps/www/src/components/MemoryWedge.astro` — retitle from "The wedge" framing to a benefit framing ("Your memory, portable and inspectable"); keep the graph screenshot and two-column content; leave component name in place if git history legibility outweighs semantic rename (decide at implementation time).
- Modify: `apps/www/src/components/FinalCTA.astro` — new copy that relands the governance thesis; CTAs unchanged.
- Modify: `apps/www/src/components/QuickStart.astro` — tighten lede, confirm the five CLI commands still match the current `apps/cli/` interface (verify against `apps/cli/package.json` + `apps/cli/README.md`; update only if the CLI has actually changed).
- Modify: `apps/www/src/pages/index.astro` — confirm final section order matches the High-Level Technical Design.

**Approach:**
- Voice-only edit, not structural. Each section keeps its DOM shape.
- For `MemoryWedge`, move the section **after** the capability showcases and `SystemModel` so the narrative reads: "here are the controls → here is the admin surface → here is the durable benefit (memory) → here is the end-user benefit (mobile)."
- If the CLI commands in `QuickStart` are out of date (they may not be — verify), fix them in this unit.
- Do not touch `MobileApp.astro` in this unit — it already reads as a benefit and its copy doesn't need realignment.

**Patterns to follow:**
- Match the new section voice locked in Unit 1 exactly — if copy disagreement shows up here, escalate back to Unit 1 rather than diverging.

**Test scenarios:**
- Happy path: the index page scrolls top-to-bottom in a single coherent argument with no section feeling like it belongs to a different product.
- Edge case: CLI commands still match `apps/cli`'s actual surface — a smoke run of `thinkwork --help` should reproduce the same five verbs.
- Edge case: MemoryWedge's graph screenshot still makes sense in the new section location (it does — the feature is real and the shot is current).
- Test expectation: none for structural tests — content-only changes.

**Verification:**
- A cold re-read of the homepage start-to-finish yields a single-voice narrative.
- `grep -r "WhyThinkWork" apps/www/src` returns zero results (sanity-check the Unit 5 delete).
- `thinkwork --help` (or equivalent) confirms the Quick Start commands are accurate.

---

- [ ] **Unit 8: Frontend-design polish + cross-device verification**

**Goal:** With the full narrative and components in place, invoke the `frontend-design` skill for a targeted polish pass: typography rhythm, vertical spacing, card depth, hover states, blur-glow balance, and mobile density. Confirm the site looks *tighter and more enterprise-trustable*, not flashier.

**Requirements:** R6, R8, R10

**Dependencies:** Units 1–7 complete.

**Files:**
- Potentially modify any `apps/www/src/components/*.astro` touched in earlier units.
- Potentially modify: `apps/www/src/layouts/Base.astro` — only if the polish pass surfaces an animation or global style issue worth fixing centrally.
- Do not modify: `apps/www/tailwind.config.mjs` unless a brand-color refinement is explicitly requested — default is leave it alone.

**Approach:**
- Run `pnpm --filter @thinkwork/www dev` (per MEMORY.md: pnpm in workspace, never npm) and review every section at 375px, 768px, 1280px, and 1920px.
- Invoke the `frontend-design` skill on the assembled site, framed with: "Conference-ready polish for enterprise CTOs. Keep the existing brand. Do not rewrite copy. Tighten vertical rhythm, card depth, and hover/focus states."
- Separately, consider a single pass by the `compound-engineering:design:design-iterator` agent if the polish pass produces more than a few small findings.
- Accessibility spot checks: every interactive element has a visible focus ring; every image has `alt`; color contrast meets AA on the brand accents against the dark background.
- LCP sanity check: Hero + first capability screenshot are `loading="eager"`; all later screenshots are `loading="lazy"`.
- Deliberately *do not* add new animation, new fonts, or new color stops unless they fix a specific, visible problem.

**Execution note:** This is the only unit where the `frontend-design` skill drives changes. Earlier units use only the existing visual vocabulary.

**Patterns to follow:**
- Existing card + blur + eyebrow vocabulary — any changes stay within it.
- Existing animation utilities `animate-fade-in-up` + `delay-100/200/300` — do not add new ones.

**Test scenarios:**
- Happy path: all sections render without horizontal scroll at 320px, 375px, 768px, 1280px.
- Happy path: Lighthouse (or comparable) desktop score ≥ 90 for Performance and Accessibility on the built `dist/` output.
- Edge case: hover and focus states are visible and consistent across CTAs, nav links, and card targets.
- Edge case: reduced-motion users (`@media (prefers-reduced-motion: reduce)`) do not see the fade-in animations jerk — add a gated override if the polish pass finds it.
- Integration: the site still builds cleanly with `pnpm --filter @thinkwork/www build` and `pnpm --filter @thinkwork/www preview`.
- Test expectation: manual visual + Lighthouse verification; no automated tests in this app.

**Verification:**
- Manual scroll-through on desktop + mobile produces a conference-ready first impression.
- `pnpm --filter @thinkwork/www build` completes without warnings.
- Lighthouse (or equivalent) confirms Performance + Accessibility thresholds.

## System-Wide Impact

- **Interaction graph:** Header anchor links target new section IDs — a stale anchor anywhere (e.g., in docs or external links) would 404-in-page. Scope: low; we control the header and no external linking strategy currently leans on these anchors.
- **Error propagation:** None beyond standard Astro build errors. The site is fully static.
- **State lifecycle risks:** None — no client-side state.
- **API surface parity:** No API changes. Docs site, admin, and mobile are unaffected.
- **Integration coverage:** Admin screenshots are product-aware — if the admin UI changes substantially before the conference, the screenshots may look stale. Mitigation: capture as late as the calendar allows, and flag this in a follow-up note to refresh after any admin UX rework.
- **Unchanged invariants:** The `@thinkwork/www` package name, the Astro + Tailwind scaffold, the brand palette, the `BrainMark` logo, the docs/GitHub URL constants, and the `admin.thinkwork.ai` login button — all stay as they are. This PR is a narrative and component redesign, not a platform change.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Copy drift across sections during parallel work | Unit 1 is a hard blocker; every later component unit reads from one `copy.md`/`copy.ts`. |
| Admin screenshots leak PII or unpolished demo data | Unit 2 requires a PII sweep and uses a known-clean demo tenant. Reviewer checks each PNG before merge. |
| `frontend-design` polish pass enlarges scope beyond the conference timeline | Unit 8 is explicitly framed as "tighten, don't redesign"; any finding that requires a new font, new color stop, or new component goes on a follow-up list, not into this PR. |
| Headline lands as preachy or overclaims | Unit 1 produces 2–3 candidates and the implementer reviews them on-screen; a separate "CTO cold-read" pass is the acceptance gate. |
| Over-claiming governance features ThinkWork does not actually ship | Every capability claim in Units 3–7 maps to a codebase-audited feature documented in Context & Research. If a claim cannot be backed by a visible admin surface or schema, it must not appear on the page. |
| CLI commands in `QuickStart` are stale | Unit 7 explicitly verifies against `apps/cli/README.md` before publishing. |
| Conference deadline slips if the plan grows | Scope is locked to `apps/www` + screenshots. Any out-of-scope follow-up (enterprise page, compliance badges, case studies) is in Deferred to Separate Tasks. |
| Social-card preview breaks because OG image dimensions differ | Unit 3 keeps OG image at 1200×630, matching what `Base.astro` already advertises. |

## Documentation / Operational Notes

- No docs site changes. If the conference surfaces enterprise follow-up demand, a `/security` or `/for-enterprises` page is the likely next artifact — tracked in Deferred to Separate Tasks.
- Deploy: the site builds via Astro's static output. Confirm the current hosting target (the repo suggests `dist/` is the artifact). Redeploy after merge following the existing `apps/www` publish workflow — do not introduce a new pipeline in this PR.
- Post-conference: gather feedback from the sales lead on which parts of the page CTOs asked about most, and feed that into a follow-up trim/expand pass.
- Consider writing a `docs/solutions/2026-04-XX-governance-positioning-pattern.md` learning once the site ships, so the "noun-first, industry-agnostic, five-controls" narrative arc is reusable for future marketing surfaces.

## Sources & References

- Current site: `apps/www/src/pages/index.astro` and all components under `apps/www/src/components/`.
- Admin proof surfaces audited:
  - `apps/admin/src/routes/_authed/_tenant/agent-templates/` (list + `$templateId.tsx` editor)
  - `apps/admin/src/routes/_authed/_tenant/-analytics/CostView.tsx`
  - `apps/admin/src/routes/_authed/_tenant/evaluations/` (studio + `$runId` detail)
  - `apps/admin/src/routes/_authed/_tenant/wiki/index.tsx`
- Schema evidence:
  - `packages/database-pg/src/schema/agent-templates.ts`
  - `packages/database-pg/src/schema/cost-events.ts`
  - `packages/database-pg/src/schema/evaluations.ts`
- Prior-art references (category positioning, April 2026):
  - [Credal — The Control Plane for Enterprise Agents](https://www.credal.ai/)
  - [Cohere — Enterprise AI: Private, Secure, Customizable](https://cohere.com/)
  - [Writer — Enterprise AI Adoption 2026](https://writer.com/blog/enterprise-ai-adoption-2026/)
  - [Deloitte — State of AI in the Enterprise 2026](https://www.deloitte.com/us/en/what-we-do/capabilities/applied-artificial-intelligence/content/state-of-ai-in-the-enterprise.html)
- Related memory entries:
  - `pnpm in workspace` — always `pnpm`, never `npm`, for scripts in this monorepo
  - `PRs target main, never stack` — open one PR against `main`
  - `Worktree isolation for PRs` — use `.claude/worktrees/<name>` off `origin/main` for this work
