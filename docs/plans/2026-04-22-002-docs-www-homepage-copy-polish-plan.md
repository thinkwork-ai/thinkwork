---
title: "docs: polish www homepage copy — hero, templates legibility, lower-page repetition"
type: docs
status: active
date: 2026-04-22
origin: docs/plans/2026-04-21-009-docs-www-journey-messaging-rewrite-plan.md
---

# docs: polish www homepage copy — hero, templates legibility, lower-page repetition

## Overview

One more copy-polish pass on `apps/www` on top of the journey reframe that shipped in PR #380. Reviewer signoff on the new structure was positive — the story arc (journey → governance → ownership) and the four new/reframed sections (Journey, HowItWorks, Governance, Ownership) are working. Three focused issues remain:

1. The **hero subhead** is still too dense with product jargon ("visible threads, durable memory, capability-granted templates, deployment boundary") for a top-of-page buyer.
2. **"Templates"** is jargon-y at several touchpoints and needs business-legible translation for non-technical buyers.
3. The **lower half** (Audit → CostControl → SystemModel → MobileApp → Ownership area) has drift toward repetition — CostControl partially repeats the governance story and SystemModel's intro re-explains the four primitives that HowItWorks just covered.

Plus a placement/framing question on **MobileApp**: it currently reads as a side quest off the main enterprise-adoption spine.

Scope is copy-only inside `apps/www/src/lib/copy.ts`. No structural rebuild, no new components, no new imagery. Components themselves stay untouched.

## Problem Frame

- The reframe in PR #380 fixed the *narrative structure* but did not retune every sentence against the new story. A handful of strings still carry product-surface language (hero lede, SystemModel intro) or redundancy (CostControl features overlap with governance).
- Enterprise buyers scanning the page should be able to understand the boundary story without knowing internal terms like "threads" or "capability-granted templates". Developers will decode them anyway; non-technical buyers bounce off.
- MobileApp currently sits between CostControl and Ownership. In the new arc, the beat immediately before Ownership is *"governance lets you expand safely."* A mobile-app features block here reads as a feature tangent rather than a proof that expansion creates a real end-user surface.

## Requirements Trace

- **R1.** `hero.lede` simplifies away product-jargon ("visible threads, durable memory, capability-granted templates") toward business language while keeping "AWS" anchored on the hero for enterprise buyer legibility. `meta.description` is updated to match (≤160 chars).
- **R2.** "Templates" gets business-legible translations at 3 touchpoints where a non-technical buyer would stumble: `proofStrip[2].detail`, `controls.items[1].desc`, and `howItWorks.primitives[2].detail`. The dedicated `agentTemplates` section can keep "Templates" as the engineering noun since that section *is* the deep-dive on the primitive.
- **R3.** `costControl` compresses — reduce from 4 features to 3 (fold "Real-time attribution" and "Events in your database" together since both are about ownership of the cost ledger), and tighten the lede so the section earns its place as one governance dimension's deep-dive rather than a replay of the governance story.
- **R4.** `systemModel` intro copy (eyebrow/headline/lede) stops re-announcing "four primitives" (HowItWorks owns that introduction) and shifts to what SystemModel actually shows — the primitives *connecting* in one admin surface. The 4-node grid stays.
- **R5.** `mobile` section reframes to explicitly serve the main adoption story: "Governed AI is not just an admin surface. End users get a real work surface too." Highlights trim from 4 to 3; "On TestFlight today" folds into the lede as a closing credibility phrase. Position stays (between CostControl and Ownership).
- **R6.** Voice guardrails in `apps/www/src/lib/copy.ts` (noun-first, no verb-forward marketing, no unearned compliance claims, every capability maps to a shipped surface) apply to every new string.
- **R7.** No regressions on what's working: hero headline "Start small. Build trust. Scale AI safely." stays; "third option" framing stays; Journey section untouched; HowItWorks primitives copy untouched except the one Templates detail sentence; Ownership section untouched; FinalCTA untouched.
- **R8.** No headline orphans at 360px / 768px / 1100px / 1440px (SectionHeader `text-balance` from plan #016 still covers non-hero headlines; new hero lede must be wrap-safe as plain prose).

## Scope Boundaries

**In scope:**
- `apps/www/src/lib/copy.ts` — copy field edits only (`meta`, `hero.lede`, `proofStrip[2]`, `controls.items[1]`, `howItWorks.primitives[2]`, `costControl` features + lede, `systemModel.eyebrow/headline/lede`, `mobile.eyebrow/headline/lede/highlights`).
- Visual QA on the result at the standard breakpoints.

**Out of scope:**
- Any Astro component file changes (`.astro`). Every copy field being touched here is already rendered by an existing component shape.
- `adoption`, `journey`, `howItWorks` structural fields (eyebrow/headline/lede), `audit`, `memory`, `agentTemplates`, `ownership`, `quickStart`, `finalCta` — these read as working per the reviewer.
- Nav structure, anchor IDs, `index.astro` composition order. No reordering of sections in this pass.
- New screenshots, illustrations, or image assets. Any deletion of `mobile.highlights[3]` does not remove the section's existing imagery.
- SEO tooling, sitemap, analytics, Tailwind config, Astro config.
- Docs site (`docs/` / Starlight).

### Deferred to Separate Tasks

- **A/B testing** between hero lede candidates — if the user wants live experimentation, that's a separate experimentation-infrastructure task.
- **Bespoke imagery** for the reframed MobileApp section — if the new framing ("end-user surface, not a side quest") wants a different visual treatment, follow-up visual-design pass.

## Context & Research

### Relevant Code and Patterns

- `apps/www/src/lib/copy.ts` — single source of truth for homepage copy. Header comment codifies voice guardrails. Every edit here renders automatically through an existing component.
- `apps/www/src/components/Hero.astro` — consumes `hero.eyebrow`, `hero.headlinePart1`, `hero.headlineAccent`, `hero.lede`. Only `hero.lede` changes in this plan; the split-headline shape stays.
- `apps/www/src/components/SystemModel.astro` — renders `systemModel.{eyebrow, headline, lede, controlLabel, controlDetail, nodes, dashboardCaption}`. Only intro copy fields change; `nodes` and screenshot stay.
- `apps/www/src/components/CostControl.astro` — thin wrapper around `CapabilityShowcase` driven by `costControl.{eyebrow, headline, lede, features, imagePath, caption}`. `features` array length is flexible — 3 items renders fine in the showcase grid.
- `apps/www/src/components/MobileApp.astro` — renders `mobile.highlights` as a 2-column grid (`sm:grid-cols-2`). 3 items renders cleanly (one row of 2 + one row of 1, or wraps without empty cells on all breakpoints per Tailwind's default grid behavior).
- `apps/www/src/components/SectionHeader.astro` — applies `text-balance` to headlines, per plan `2026-04-20-016-fix-www-headline-orphan-plan.md`. Hero uses its own H1, also with `text-balance`.

### Institutional Learnings

- **Plan #016 (`2026-04-20-016-fix-www-headline-orphan-plan.md`)** applied `text-balance` to `SectionHeader` H2s and to `Hero.astro` H1, so every headline in scope is wrap-safe. Hero lede is plain prose (not a headline) — must still be read-tested at narrow breakpoints for widow lines.
- **Voice guardrails at top of `copy.ts`** — noun-first, architectural. No "transform / unlock / empower / revolutionize / accelerate / streamline / seamless". Reviewer's suggested drafts ("ThinkWork helps organizations…") are verb-forward; tighten to noun-first where possible without losing the reviewer's intent.
- **Origin plan (`2026-04-21-009`)** — the journey reframe intentionally made HowItWorks the introduction layer for the four primitives and SystemModel the architectural zoom-out. This plan enforces that distinction at the copy level (R4).
- **Enterprise onboarding scale** (memory: `project_enterprise_onboarding_scale`) — the site reads to security/ops buyers first, developer curiosity second. Keeping "AWS" visible on the hero lede serves that priority. Dropping "templates" jargon at scan-first touchpoints (proofStrip, controls item) serves the same buyer.
- **AWS-native preference** (memory: `feedback_aws_native_preference`) — the deployment boundary is the default, not a contingency. Preserve "AWS" visibility on hero and `costControl` ownership phrasing.

### External References

None needed. Reviewer's feedback block provides suggested drafts; the existing voice guardrails and origin plan provide the tone and structural reference.

## Key Technical Decisions

- **Hero lede — noun-first hybrid, not either reviewer draft verbatim.** Reviewer's drafts both start with "ThinkWork helps organizations…" which is verb-forward. Keep the current lede's noun-first shape but swap the inside-baseball phrase-list ("visible threads, durable memory, capability-granted templates") for the reviewer's business-legible phrase-list ("visible work, governed expansion, AWS deployment boundary"). Winner pinned as first entry in a new `hero.ledeCandidates` field, mirroring the existing `hero.headlineCandidates` convention. Default winner: **"The path from AI experiments to trusted AI work — visible work, governed expansion, and an AWS deployment boundary you own."** User may swap to a candidate during Unit 1.
- **Keep "Templates" as an engineering noun in its own section.** The `agentTemplates` section is the deep-dive; swapping its eyebrow to "Approved capabilities" would break the mental handle engineering and admin users already have. Instead, translate at the scan-first touchpoints (proofStrip bullet, controls grid card, howItWorks detail sentence) where a non-technical buyer meets the word first.
- **Compress CostControl rather than delete it.** CostControl is the one deep-dive on a single governance dimension (cost). Deleting it removes a concrete evidence section. Compressing (4→3 features + tighter lede) removes the feeling of replaying the governance story without losing the proof that cost is handled with first-class infrastructure.
- **Retune SystemModel intro, not its structure.** The 4-node diagram is the architectural zoom-out — it earns its place. What's broken is the intro copy re-announcing "four primitives" that HowItWorks just told. Change eyebrow/headline/lede only; nodes stay.
- **MobileApp stays in place.** Moving it earlier makes it fight HowItWorks for attention; moving it later (between Ownership and QuickStart) breaks the close. Position between CostControl and Ownership is correct — governance + cost proof → end-user surface proof → ownership close. The issue is framing, not placement.
- **No `index.astro` changes in this pass.** Every change is a field edit in `copy.ts`.

## Open Questions

### Resolved During Planning

- **Which hero lede ships?** Noun-first hybrid (recommended) is pinned as first entry in `hero.ledeCandidates`. Reviewer's draft A (keeps AWS) and draft B (mirrors "small wins") are runner-ups. User picks during Unit 1 if they prefer another.
- **Do we drop CostControl entirely?** No — it earns its spot as the cost deep-dive. Compress to 3 features + tighter lede.
- **Do we move MobileApp?** No — position is correct; framing is the issue. Reframe in place.
- **Do we rename `agentTemplates.eyebrow` from "Templates" to "Approved capabilities"?** No. The dedicated section is the right place to use the engineering noun. Business-legible translation happens at the scan-first touchpoints only.
- **Do we touch the `howItWorks` headline "Four primitives, one system"?** No — the reviewer explicitly called HowItWorks "more digestible" and "in the right place." Only the Templates detail sentence inside it shifts.

### Deferred to Implementation

- **Exact trimmed CostControl feature list** — the merge of "Real-time attribution" and "Events in your database" needs the final sentence picked during Unit 3; both first drafts are sketched below but the tighter noun-first version lands in code.
- **Whether the dropped MobileApp highlight ("On TestFlight today") needs a replacement placement** — plan is to fold it into `mobile.lede` as a trailing credibility clause; if the lede feels cluttered, the clause can move to a small caption under the phone screenshots instead (no component change needed — it's a copy-only placement decision).
- **Whether `proofStrip[2]` should keep its `label` ("Governed expansion") or switch** — label feels right as-is; only the `detail` sentence has inside-baseball language to trade out. Final wording pinned in Unit 2.

## Implementation Units

- [ ] **Unit 1: Simplify hero lede and meta description**

**Goal:** Replace the product-jargon phrase-list in `hero.lede` with business-legible phrasing while keeping the current noun-first sentence shape and keeping "AWS" visible for enterprise buyers. Update `meta.description` to match, staying under 160 characters for SERP rendering.

**Requirements:** R1, R6, R7, R8

**Dependencies:** None

**Files:**
- Modify: `apps/www/src/lib/copy.ts` — `hero.lede`, new `hero.ledeCandidates` field, `meta.description`
- Test: visual QA; no unit test

**Approach:**
- New `hero.lede` (default): "The path from AI experiments to trusted AI work — visible work, governed expansion, and an AWS deployment boundary you own."
- Add `hero.ledeCandidates` array mirroring existing `hero.headlineCandidates` pattern. First entry is the winner; keep reviewer's two drafts and current lede as runner-ups for easy rotation:
  1. Noun-first hybrid (recommended winner)
  2. "ThinkWork helps organizations move from AI experiments to trusted AI work through visible workflows, governed expansion, and an AWS deployment boundary they own." (reviewer draft A)
  3. "ThinkWork helps organizations adopt AI through small wins, visible work, governed expansion, and a deployment boundary they own." (reviewer draft B)
  4. Current lede (kept for rollback). Strip after 1 week if no regret.
- New `meta.description`: "The path from AI experiments to trusted AI work. Visible work, governed expansion, and an AWS deployment boundary you own." (≈135 chars — under the 160-char Google SERP truncation threshold.)
- Leave `meta.title`, `hero.eyebrow`, `hero.headlinePart1`, `hero.headlineAccent`, `hero.headlineCandidates`, `hero.primaryCta`, `hero.secondaryCta` untouched.

**Patterns to follow:**
- `apps/www/src/lib/copy.ts:38–44` — existing `hero.headlineCandidates` shape; mirror for `hero.ledeCandidates`.
- Voice guardrails comment at top of `copy.ts` — noun-first, no marketing verbs.

**Test scenarios:**
- Happy path: dev server renders the hero with the new lede under the existing two-part headline; CTAs do not shift below the fold at 1440px.
- Edge case: at 360px, the new lede wraps without a one-word widow on the final line (`—` dash and "you own" closing clause should not leave "own" alone on a line).
- Content: `meta.description` stays ≤160 characters when measured in the built HTML's `<meta name="description">` tag.
- Content: no forbidden marketing verbs in the new lede ("transform", "unlock", "empower", "revolutionize", "accelerate", "streamline", "seamless").
- Content: the phrase "AWS" appears in the new lede.

**Verification:**
- `pnpm --filter @thinkwork/www build` succeeds.
- Screenshot at 1440px shows the hero eyebrow, two-line headline, new lede, and CTAs all above the fold.
- Screenshot at 360px shows clean wrap of the new lede with no widow words.

---

- [ ] **Unit 2: Translate "templates" to business language at 3 scan-first touchpoints**

**Goal:** Three places on the page (proof strip, governance grid, how-it-works detail) meet non-technical buyers before the dedicated `agentTemplates` section. Swap product-jargon phrasing there for business-legible language ("approved capabilities", "what each agent is allowed to do") without renaming the Templates primitive anywhere it matters as an engineering term.

**Requirements:** R2, R6, R7

**Dependencies:** None (parallelizable with Unit 1)

**Files:**
- Modify: `apps/www/src/lib/copy.ts` — `proofStrip[2].detail`, `controls.items[1].desc`, `howItWorks.primitives[2].detail`
- Test: visual QA

**Approach:**
- `proofStrip[2].detail` — current: "Template capability grants, per-agent budgets, and evaluations that scale with usage." New: "Approved capabilities per agent, budgets that cap spend, and evaluations that scale with usage." (Label "Governed expansion" stays.)
- `controls.items[1].desc` — current: "Templates pin the model, allow-list tools, attach guardrails, and gate knowledge access. Agents inherit the boundary." New: "Each agent inherits an approved set of tools, models, and knowledge — policy becomes code, not paperwork." (Title "Capability-granted templates" stays, so the engineering noun is still locatable in the grid.)
- `howItWorks.primitives[2].detail` — current: "You decide which tools, models, and knowledge each agent can use. Agents inherit the boundary — policy becomes code, not paperwork." New: "You decide what each agent is allowed to do — which tools, models, and knowledge it can use. Agents inherit that boundary." (OneLiner "Templates enforce boundaries." stays because it is the primitive's name + verb.)
- Do not change `agentTemplates.eyebrow`, `agentTemplates.headline`, `agentTemplates.lede`, or `agentTemplates.features` — the deep-dive section is the right place for the engineering noun.

**Patterns to follow:**
- Voice guardrails — noun-first. "Each agent inherits…" is noun-led via "Each agent" which keeps the shape.
- `apps/www/src/lib/copy.ts:47–68` — `proofStrip` item shape; both fields are flexible strings.

**Test scenarios:**
- Happy path: dev server renders all three touchpoints with new phrasing and no layout change.
- Content: each of the three edited strings uses one of these business-legible phrases at least once: "approved capabilities", "what each agent is allowed to do", "approved set of tools", "policy becomes code".
- Content: the word "Templates" still appears as a section eyebrow (`agentTemplates.eyebrow`) and as a primitive title (`howItWorks.primitives[2].title`) — engineering readers don't lose the mental handle.
- Content: no forbidden marketing verbs introduced.

**Verification:**
- `grep -n "Templates\|template" apps/www/src/lib/copy.ts` output shows "Templates" / "templates" still present in expected places (eyebrow, primitive title, agentTemplates section) and absent from the three scan-first touchpoints' body copy.
- Screenshot of the proof strip, the governance grid card #2, and the HowItWorks Templates card at 1440px and 768px — layout unchanged, copy updated.

---

- [ ] **Unit 3: Compress CostControl and retune SystemModel intro**

**Goal:** Cut redundancy between CostControl and the governance story, and stop SystemModel's intro copy from re-pitching "four primitives" that HowItWorks already introduced.

**Requirements:** R3, R4, R6

**Dependencies:** None (parallelizable with Units 1–2)

**Files:**
- Modify: `apps/www/src/lib/copy.ts` — `costControl.lede`, `costControl.features`, `systemModel.eyebrow`, `systemModel.headline`, `systemModel.lede`
- Test: visual QA

**Approach:**
- **CostControl compression:**
  - Keep `costControl.eyebrow` ("Cost") and `costControl.headline` ("Cost attributed where it happens.") — both land.
  - New `costControl.lede` (tighter, one-sentence): "Every model call emits a cost event tagged by tenant, agent, and model. Per-agent budgets pause execution before overruns compound." (Trimmed from 3 sentences to 2.)
  - Collapse 4 features → 3 by merging "Real-time attribution" + "Events in your database" into one feature about owning the cost ledger. Dropped "30-day trendlines" (implicit in the dashboard screenshot that renders below).
    - **New feature 1:** "Owned cost ledger — Every invocation emits a cost event tagged by tenant, agent, and model, written to the Postgres you deployed."
    - **New feature 2:** "Enforced budgets — Per-agent hard caps pause execution before a runaway loop compounds into a bill." (Unchanged from current.)
    - **New feature 3:** "Evaluated in context — Cost shows up next to the turn that produced it, so spend and quality travel together."
  - `costControl.caption` and `costControl.imagePath` stay.
- **SystemModel intro retune:**
  - `systemModel.eyebrow`: keep "One admin console" — it names the *unique* claim (one surface, not fragmented toolchain) that SystemModel is qualified to make.
  - New `systemModel.headline`: "One surface where the primitives connect." (Drops the listing of "agents, templates, cost, evaluations, and memory" — that listing was re-explaining HowItWorks.)
  - New `systemModel.lede`: "Threads, memory, agents, and connectors meet in one admin surface. Governance, audit, and spend travel with them — no fragmented toolchain, no per-tool control plane." (Shifts from "here are the primitives" to "here's how the primitives connect + why that matters.")
  - `systemModel.controlLabel`, `systemModel.controlDetail`, `systemModel.nodes`, `systemModel.dashboardCaption` — all stay.

**Patterns to follow:**
- `apps/www/src/lib/copy.ts:227–251` — `costControl` export shape; `features` array length is flexible.
- `apps/www/src/lib/copy.ts:271–296` — `systemModel` export shape; only string fields change.
- `apps/www/src/components/CapabilityShowcase.astro` — renders arbitrary-length `features`; 3 items is within its existing render range.

**Test scenarios:**
- Happy path: CostControl renders with 3 feature cards, tighter lede, same screenshot and caption.
- Happy path: SystemModel renders with new headline and lede, same 4-node grid, same dashboard screenshot.
- Content: SystemModel's new headline/lede does not contain the phrase "four primitives" (HowItWorks owns that).
- Content: CostControl's new features do not each independently re-state the governance story — each feature names a distinct angle (ledger ownership, budget enforcement, context).
- Edge case: CostControl with 3 features still renders cleanly at 360px and 768px — no empty grid cells, no layout regression (CapabilityShowcase tolerates this).
- Edge case: SystemModel's new headline is wrap-safe at 1440px, 1100px, 768px, 360px (SectionHeader `text-balance` handles orphans).

**Verification:**
- Visual diff at 1440px and 768px confirms both sections look tighter and no layout breaks.
- `grep -c "governance\|Governance" apps/www/src/lib/copy.ts` does not increase meaningfully — we are reducing repetition, not adding new mentions.
- Read-through: scanning from HowItWorks → Audit → Memory → AgentTemplates → SystemModel → FiveControls → CostControl, the flow no longer feels like the same point is being re-made.

---

- [ ] **Unit 4: Reframe MobileApp to serve the main story + trim highlights**

**Goal:** Change MobileApp's framing from "feature tangent" to "end-user consequence of governed adoption" — matching the reviewer's suggested line: *"Governed AI is not just an admin surface. End users get a real work surface too."* Trim highlights from 4 to 3 so the section is lighter and reads closer to a proof beat than a mini-features-page.

**Requirements:** R5, R6, R7

**Dependencies:** None (parallelizable with Units 1–3)

**Files:**
- Modify: `apps/www/src/lib/copy.ts` — `mobile.eyebrow`, `mobile.headline`, `mobile.lede`, `mobile.highlights`
- Test: visual QA

**Approach:**
- `mobile.eyebrow`: change from "End-user app" to "End-user surface" — aligns with the reviewer's framing ("admin surface … work surface").
- `mobile.headline`: change from "Your users get a real mobile app." to the reviewer's explicit reframe: **"Governed AI is not just an admin surface. End users get a real work surface too."** Long for a headline, but it is the section's entire thesis and SectionHeader's `text-balance` should render it cleanly across the standard breakpoints.
- `mobile.lede`: compress from 2 sentences to 1, and fold in the TestFlight credibility clause that gets freed up by dropping highlight #4: "The operator story lives in the admin web. The user story is a native iOS app on the same threads, agents, and connectors — live on TestFlight today."
- `mobile.highlights`: trim from 4 to 3 by dropping `highlights[3]` ("On TestFlight today"); its credibility content moves into the lede. Keep in order:
  1. "Assigned work, one place" (unchanged)
  2. "Native GenUI, not markdown" (unchanged)
  3. "Realtime by default" (unchanged)
- Do not touch images, captions, or `MobileApp.astro` component.

**Patterns to follow:**
- `apps/www/src/lib/copy.ts:315–337` — `mobile` export shape; `highlights` array length is flexible.
- `apps/www/src/components/MobileApp.astro` — grid is `sm:grid-cols-2`; 3 items renders as one full row + one half row, which wraps cleanly.

**Test scenarios:**
- Happy path: MobileApp renders with new headline, shorter lede (with "live on TestFlight today" trailing), and 3 highlight cards.
- Happy path: reading top-to-bottom, the section now feels like a proof point for governed expansion rather than a standalone features mini-page.
- Edge case: new headline (2 sentences) wraps cleanly at 1440px, 1100px, 768px, 360px — no orphans, no awkward mid-sentence wrap (SectionHeader `text-balance` should handle it, but a 2-sentence headline is an unusual shape and needs the breakpoint check).
- Edge case: at 768px the 3-card highlights grid does not leave a single awkward orphan card alone on the second row (Tailwind `sm:grid-cols-2` handles this as `[2, 1]` with the final card spanning half — acceptable).
- Content: `mobile.lede` still contains "TestFlight" (credibility preserved) and still names "admin web" as the operator surface.

**Verification:**
- Screenshot at 1440px shows the reframed headline above the phone screenshots, lede shorter, 3 highlight cards.
- Screenshot at 768px and 360px confirms no layout regressions with the 3-card grid.
- Read-through: the full-page story flow now reads *problem → journey → how → evidence (audit/memory/templates/system/governance/cost) → end-user surface → ownership → quick start → adopt*, with MobileApp earning its spot rather than feeling like a side quest.

---

- [ ] **Unit 5: Visual QA pass — breakpoints, orphans, voice, build**

**Goal:** Confirm the polish pass reads as one coherent story without regressions.

**Requirements:** R6, R7, R8

**Dependencies:** All prior units

**Files:**
- No file modifications expected. Issues found here feed back into Units 1–4.

**Approach:**
- Run `pnpm --filter @thinkwork/www build` — must succeed with no warnings.
- Run `pnpm --filter @thinkwork/www dev` (port 5173 or the configured www port; concurrent admin servers on 5174+ are unrelated) and screenshot the new homepage at 360px, 768px, 1100px, 1440px.
- **Orphan audit:** inspect hero lede, SystemModel headline, MobileApp 2-sentence headline, reworded `controls.items[1].desc` card. Every other headline is covered by `SectionHeader`'s `text-balance`.
- **Voice pass:** `grep -iE "transform|unlock|empower|revolutionize|accelerate|streamline|seamless" apps/www/src/lib/copy.ts` should return nothing.
- **Redundancy pass:** read from HowItWorks → SystemModel and from FiveControls → CostControl top-to-bottom. The reviewer's felt repetition should be gone; if it still lingers, flag which unit to revisit.
- **SEO smoke-check:** built HTML `<meta name="description">` matches the new `meta.description`, length ≤160 chars.
- **Don't-regress check:** confirm hero headline, Journey section, Ownership section, FinalCTA are byte-identical to pre-plan state (`git diff docs/plans/2026-04-21-009 --stat` should show zero touches on those fields).

**Test scenarios:**
- Visual: no headline or lede orphan (≤3-letter trailing word alone on a line) at any of the four breakpoints.
- Visual: MobileApp's 3-card grid at 768px does not leave a widow card looking broken.
- Voice: zero forbidden-verb hits across the full diff.
- Content: every edited string maps to a shipped surface (voice guardrail from `copy.ts` header).
- Build: `pnpm --filter @thinkwork/www build` succeeds; `pnpm format:check` passes on the changed files.
- Don't-regress: `git diff apps/www/src/lib/copy.ts` shows edits only in `meta`, `hero` (lede + new candidates field), `proofStrip[2]`, `controls.items[1]`, `howItWorks.primitives[2]`, `costControl`, `systemModel` (intro fields), `mobile`. No edits in `adoption`, `journey`, `howItWorks` (headline/lede/eyebrow), `audit`, `memory`, `agentTemplates`, `ownership`, `quickStart`, `finalCta`.

**Verification:**
- All four screenshots reviewed (or sent to the user for review before merging).
- No guardrail violations remain.
- Page loads with no console errors.

## System-Wide Impact

- **Interaction graph:** static marketing site. No downstream monorepo consumer imports from `apps/www/src/lib/copy.ts`.
- **Error propagation:** none; Astro build errors caught at build time.
- **State lifecycle risks:** none; no runtime state.
- **API surface parity:** none touched.
- **Integration coverage:** anchor IDs (`#journey`, `#how-it-works`, `#controls`, `#ownership`, `#quick-start`, `#mobile`, `#cost`, `#system`) are all preserved — no nav or deep-link regressions.
- **Unchanged invariants:** voice guardrails; `SectionShell` / `SectionHeader` API; `text-balance` on headlines; Hero two-part headline shape; FinalCTA copy; anchor IDs and nav order from PR #380; Journey, Ownership, FinalCTA content.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Hero lede choice regret — we ship the noun-first hybrid and later prefer one of the reviewer's drafts. | Add `hero.ledeCandidates` array with all four options. Rotation is a 2-line change. |
| Dropped "30-day trendlines" feature in CostControl is a credibility point we miss post-ship. | The trendlines visual is still present as the screenshot below the feature grid. If copy needs to reference it, lede sentence 1 can carry the implication ("time-series attribution"). Reintroduce the bullet only if the section reads thin. |
| MobileApp 2-sentence headline breaks at narrow breakpoints in a way `text-balance` can't fix. | Unit 5 breakpoint check catches this. Do **not** preemptively shorten. Reviewer-approved fallback (kept ready, applied only if Unit 5 surfaces ugly wrapping): use headline **"End users get a real work surface too."** and move the **"Governed AI is not just an admin surface."** clause into `mobile.lede`. |
| Non-technical buyer still finds "Templates" confusing even after the three translations. | The three translation points are the scan-first surfaces; if it's still confusing, the next polish pass can touch `agentTemplates.headline` or `howItWorks.primitives[2].title` itself. Deferred. |
| SystemModel's reworded lede reads too abstract without "four primitives" anchor. | The node grid ("Threads / Memory / Agents / Connectors") visually re-anchors the reader two lines below the lede; the intro sentence doesn't need to spell out the count. Verify in Unit 5. |
| Headline `meta.title` and new `meta.description` trigger short-term SEO re-index dip. | Core query terms ("AI adoption", "AWS", "governance"-adjacent "governed expansion") stay in the meta. Accept short-term fluctuation. |

## Documentation / Operational Notes

- **No operational deploy requirements.** `apps/www` is a static Astro site; PR + merge to main triggers the marketing-site deploy pipeline.
- **Coordinate with ongoing docs rewrite** (plan `2026-04-21-008`) only if the docs rewrite is re-anchoring homepage-linked terminology. Templates translation here should not conflict — the docs rewrite can adopt the same "approved capabilities" phrasing for consistency if it hasn't already.
- **Post-ship:** watch search console (if configured) for the `meta.description` reindex; expect 1–2 weeks for Google SERP to pick up.

## Sources & References

- **Origin plan:** [docs/plans/2026-04-21-009-docs-www-journey-messaging-rewrite-plan.md](./2026-04-21-009-docs-www-journey-messaging-rewrite-plan.md) — the journey reframe this pass polishes.
- **Current copy source of truth:** `apps/www/src/lib/copy.ts`
- **Current composition:** `apps/www/src/pages/index.astro`
- **Related plan (headline orphans):** `docs/plans/2026-04-20-016-fix-www-headline-orphan-plan.md` — `text-balance` applied to `SectionHeader` and hero H1.
- **Reviewer feedback:** user's feature-description block on this `ce:plan` invocation — authoritative requirements source for this pass.
- **Voice guardrails:** comment header of `apps/www/src/lib/copy.ts` (noun-first, no verticals, no unearned compliance claims, no unverifiable stats, every capability maps to a shipped surface).
- **Enterprise scale context:** memory `project_enterprise_onboarding_scale`.
- **AWS-native preference:** memory `feedback_aws_native_preference`.
