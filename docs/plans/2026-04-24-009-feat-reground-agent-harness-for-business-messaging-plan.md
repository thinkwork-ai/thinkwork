---
title: "feat: Reground public messaging around Agent Harness for Business"
type: feat
status: active
date: 2026-04-24
deepened: 2026-04-24
---

# feat: Reground public messaging around Agent Harness for Business

## Overview

Reframe every public-facing surface (marketing site, documentation, OSS repo root, footer/nav/SEO meta) around the master positioning **Agent Harness for Business**, articulated through the four R.E.S.T. anchors (Reliability, Efficiency, Security, Traceability), the PPAF agent loop (Perception, Planning, Action, Feedback), and the horse/reins metaphor introduced in the *Definitive Guide to Harness Engineering*.

The Thinkwork wordmark stays. "Agent Harness" becomes the **category** — the new explanatory frame for what the product is — and "for Business" signals the operated tier of the three-tier deployment ladder we are committing to:

- **ThinkWork** — the open Agent Harness (Apache 2.0, self-host on AWS)
- **ThinkWork for Business** — Agent Harness, operated (managed deployment, Stripe-billed)
- **ThinkWork Enterprise** — services + SLA + dedicated support

This work is the next regrounding pass on top of the prior positioning arc (governance refresh `2026-04-20-001`, journey rewrite `2026-04-21-009`, homepage polish `2026-04-22-002`, AWS-repetition cut `2026-04-22-004`, docs↔www visual coherence `2026-04-23-001`). It deliberately supersedes the "AI adoption journey" framing, retires the banned word "journey" from www voice (closing a long-standing voice gap with `docs/STYLE.md`), and restructures pricing from scale-laddered (Starter / Team / Enterprise) to deployment-laddered (Open / For Business / Enterprise) — pre-launch, so no migration cost.

---

## Problem Frame

Public messaging today is internally inconsistent across surfaces and lags the product framing the team uses internally:

- **www** leads with "AI adoption journey" — a verb-heavy, journey-shaped narrative that violates `docs/STYLE.md` (which bans the word "journey") and undersells the technical specificity of the harness.
- **docs landing + README** already lead with "production-grade open agent harness" — closer to where we want to be, but disconnected from the marketing voice and missing the explicit ladder.
- **package.json** says "agent platform" — drifts from "agent harness" used in README and docs.
- **Pricing** ladders by *scale* (Starter / Team / Enterprise within a single self-host model). We have committed to a three-tier *deployment-model* ladder, and the services-page FAQ already (incorrectly, given that commitment) describes the operated tier as "the same platform, just operated by us."
- **No first-class vocabulary** for the harness mechanics. R.E.S.T. and PPAF are how the team thinks about the system; nothing on a public surface signals it.

The article *The Definitive Guide to Harness Engineering* names the category we already build for. Adopting "Agent Harness for Business" as master positioning closes the voice gap, retires "journey," reconciles the ladder commitment with pricing structure, and lifts the harness mechanics into language buyers and contributors can grab onto.

The audience is dual: AWS-shop platform/CTO buyers who need the operated-or-self-hosted clarity, and OSS contributors who need the GitHub face to match what the docs and product say. Both surfaces have to land the same story.

---

## Requirements Trace

- R1. Every public surface (apps/www homepage, services, pricing, docs landing, docs getting-started, docs architecture, docs roadmap, README, CONTRIBUTING, package.json, GitHub repo description, footer/nav/OG meta) leads with "Agent Harness for Business" master positioning, not "AI adoption journey" or "AI infrastructure."
- R2. The three-tier ladder is articulated identically on www, docs, and README: ThinkWork (open) → ThinkWork for Business (operated) → ThinkWork Enterprise (services).
- R3. Pricing tier IDs in `packages/pricing-config` map to the deployment ladder (`open`, `business`, `enterprise`), Stripe products + prices reflect the new tiers in test and prod, mobile onboarding renders the new plans, and `.github/workflows/deploy.yml` `STRIPE_PRICE_IDS_JSON` is updated.
- R4. R.E.S.T. (Reliability, Efficiency, Security, Traceability) is canonical vocabulary on www's governance section and in `docs/concepts/control` framing — supplementing, not replacing, the FiveControls implementation surface.
- R5. PPAF (Perception, Planning, Action, Feedback) is canonical vocabulary in `docs/architecture.mdx` and surfaces lightly elsewhere where it fits (e.g., concepts/agents intro). It is not pushed onto www homepage marketing copy.
- R6. The horse/reins metaphor appears at most once per surface, framed as a sidebar/explainer rather than a structural device — preserving `docs/STYLE.md` voice (no extended marketing metaphors).
- R7. The word "journey" is retired from www voice; replacement vocabulary ("rollout path," "adoption arc," or specific phase names like "pilot → expansion → operations") is documented in `docs/STYLE.md` and applied across www copy.
- R8. AWS de-emphasis from `2026-04-22-004` is preserved — total "AWS" mentions on the homepage stay at 3–4 well-placed anchors, not re-inflated by the rewrite.
- R9. `docs/STYLE.md` is updated with the new canonical names ("Agent Harness," "Agent Harness for Business," R.E.S.T., PPAF) so future PRs can be reviewed against an enforced glossary.
- R10. The five open residuals in `docs/residual-review-findings/feat-www-services.md` — (a) ServiceCard `Props` duplication (gated_auto), (b) `services.astro` prop forwarding (gated_auto), (c) FinalCTA duplication (manual), (d) dead `ServicePackage.cta` field (gated_auto), (e) `ServicesMailto` type alias (gated_auto) — are resolved or explicitly closed as part of this regrounding. **Closure scope:** U5 fixes the four `gated_auto` items as part of the services rewrite; the one `manual` item (FinalCTA duplication) is deferred to a follow-up refactoring pass with rationale recorded in the residual file. U11 audits closure via grep; U5 owns edits.
- R11. The OSS repo's GitHub-discoverable surfaces (README H1 + tagline, package.json `description`, GitHub repo description, GitHub topics, npm description for `thinkwork-cli`) all reflect the new master positioning.
- R12. No surface introduces unearned compliance claims, vertical-specific marketing, verb-forward marketing language ("transform," "unlock," "empower," "leverage," "seamlessly"), or stacked adjectives — `apps/www/src/lib/copy.ts` voice guardrails are honored throughout. **Data-custody accuracy is part of R12:** every "operated by us" surface (For Business tier copy, services FAQ, README ladder paragraph) is reviewed before publish to verify the data-residency claim is accurate (data stays in customer AWS) — misleading copy here is a compliance liability, not just a style nitpick.
- R13. **Documentation is product, not vocabulary polish.** Every harness component (the six concepts: Threads, Agents, Memory, Connectors, Automations, Control — and their leaves) ships docs treatment of the same quality bar as the admin web app. Each concept page carries: (a) **Why this component exists in the harness** — its role under the harness frame; (b) **What it does** — the canonical behavior + canonical names; (c) **How to configure it** — concrete admin-surface mapping or CLI flags; (d) **Common patterns / runbooks** — at least one worked-through scenario; (e) **Cross-link to admin route** — every concept page links to its admin page so operators move between docs and the running console without losing context.
- R14. **The harness skeleton is the docs information architecture.** Top-level docs structure mirrors the harness mental model: an "Architecture" intro that names PPAF + R.E.S.T. + the harness category; a "Components" branch covering the six concepts with the R13 treatment; a "Configure" branch covering deploy/connectors/skills/evaluations/memory; a "Reference" branch covering API + SDKs + CLI. The Starlight sidebar (`docs/astro.config.mjs`) is restructured to reflect this; concept pages within each branch follow the consistent harness skeleton template.
- R15. **Worktree-isolated execution.** Per `feedback_worktree_isolation` and `feedback_cleanup_worktrees_when_done`, this work runs in a dedicated worktree at `.claude/worktrees/agent-harness-for-business` off `origin/main`. Dev servers (`pnpm --filter @thinkwork/www dev` for the marketing site at Astro default port 4321, `pnpm --filter @thinkwork/docs dev` for the docs site) run from the worktree. www and docs are static Astro sites with no Cognito auth — no callback-URL pre-step required (admin is out of scope for this plan).

---

## Scope Boundaries

- **In scope:** apps/www (homepage, services, pricing, checkout-complete, layout/components/copy.ts), docs Starlight (landing, getting-started, architecture, roadmap, concept hubs), OSS root (README, CONTRIBUTING, package.json `description`), shared `packages/pricing-config`, `apps/mobile/app/onboarding/payment.tsx` (rendering of new plan IDs), `.github/workflows/deploy.yml` (STRIPE_PRICE_IDS_JSON), `docs/STYLE.md` glossary additions, GitHub repo description + topics (manual UI step).
- **Explicit non-goals:**
  - Visual/design changes — palette, typography, component layout, BrainMark logo, OG image artwork. The 2026-04-23-001 docs↔www visual coherence pass is preserved as-is. (The OG default *text* in `Base.astro` does change; the artwork does not.)
  - Full rewrite of every docs leaf in a single PR (`concepts/agents/code-sandbox.mdx`, `concepts/threads/auto-channel.mdx`, etc.). The new R13/R14 framing brings concept *hubs* and their nearest leaves into scope; deeper-leaf reference content is sequenced in U13a/b/c by concept area so each lands as a focused unit. The 22 admin / 6 mobile / 2 cli applications pages remain out of scope (operator-facing surface, not the harness's product face).
  - Mobile app UI copy beyond the pricing screen (`payment.tsx`). Inbox, threads, wiki, settings, agent assignment screens are out of scope.
  - Admin web UI copy. Operator surface is internal-facing, not public messaging.
  - SDK reference docs (`docs/sdks/react-native/*`).
  - Migration of existing customers between pricing tiers (we are pre-launch; no customers to migrate).
  - Renaming the GitHub repo, the npm package (`thinkwork-cli`), the Terraform Registry module name (`thinkwork-ai/thinkwork/aws`), or any AWS resource names. Brand stays "ThinkWork."
  - New ADRs. Existing `docs/adrs/per-tenant-aws-resource-fanout.md` is unaffected.

### Deferred to Follow-Up Work

- **Per-app READMEs (`apps/admin/README.md`, `apps/mobile/README.md`, `packages/api/README.md`, etc.) beyond apps/cli/README.md:** light vocabulary pass to follow in a separate PR once master positioning has settled. apps/cli/README.md is in scope here because it ships with the npm package.
- **Blog / changelog / external content:** if and when we publish, will follow this voice. Not authored in this plan.
- **Marketing collateral (PDFs, sales decks, partner one-pagers):** not in repo, out of scope here. Will be regenerated against the new positioning brief once landed.
- **Email templates (transactional, marketing):** if Stripe Checkout templates carry copy, those edits move into a follow-up. The post-checkout bounce page (`apps/www/src/pages/m/checkout-complete.astro`) **is** in scope.
- **`apps/cli/README.md` deep rewrite:** light pass in U9 (tagline + ladder mention only). Full per-command voice pass deferred.

---

## Context & Research

### Relevant Code and Patterns

**Single source of truth for marketing copy** — `apps/www/src/lib/copy.ts` (699 lines) holds nav, meta, hero, proofStrip, journey, howItWorks, controls, agentTemplates, audit, costControl, evals, systemModel, memory, mobile, quickStart, finalCta, pricing, services. Components (`Hero.astro`, `FiveControls.astro`, `SystemModel.astro`, etc.) read from this file. Editing copy.ts is the leverage point — components are display logic only.

**Single source of truth for pricing** — `packages/pricing-config/src/plans.ts` is consumed by `apps/www/src/pages/pricing.astro` via `apps/www/src/lib/copy.ts` (`pricing.plans = sharedPlans`) **and** by `apps/mobile/app/onboarding/payment.tsx`. Tier rename ripples to both surfaces. Adding/renaming a plan also requires `packages/pricing-config/src/types.ts` (`PlanId`), Stripe product + price (test and prod), and `STRIPE_PRICE_IDS_JSON` in `.github/workflows/deploy.yml`.

**Docs landing pattern** — `docs/src/content/docs/index.mdx` uses Starlight's splash template with `hero.tagline` in frontmatter and prose body sections (`## What ThinkWork is`, `## Six core concepts, one deploy`, `## Quick start`). The six-concept card grid uses `<Card>` and `<CardGrid>` from `@astrojs/starlight/components`.

**Voice authority** — `docs/STYLE.md` enforces "noun-first, architectural" voice and bans "journey," "seamlessly," "leverage" (verb), "harness your agents with unprecedented ease," "Welcome to," "In this guide we will," "Without further ado," "transform," "unlock," "empower." Canonical names locked in: Threads, Agents, Memory, Connectors, Automations, Control, Compounding memory, Managed agents, Connected agents.

**copy.ts voice header** — same constraints inline at the top of `apps/www/src/lib/copy.ts` lines 1–8: noun-first, no specific verticals, no unearned compliance claims, no unverifiable stats, every capability claim must map to an admin surface or schema that ships.

**Cross-surface drift points** — logo SVG path data is duplicated (`apps/www/src/lib/brain-path.mjs` + `docs/src/lib/brain-path.mjs`); brand color tokens duplicated (`apps/www/tailwind.config.mjs` + `docs/src/styles/custom.css`); OG asset (`apps/www/public/og-image.png`) is www-only. None block this plan but are noted in System-Wide Impact.

### Institutional Learnings

`docs/solutions/` has **no** entries on marketing copy, positioning, STYLE rationale, or pricing tier wording — confirmed by Phase 1 search. The institutional knowledge for this rewrite lives in `docs/plans/` (prior positioning history) and `docs/STYLE.md`/`docs/STYLE-AUDIT.md` (voice enforcement). Capturing master-positioning decisions in `docs/solutions/` after this lands is itself a valuable follow-up — flagged in the closing CTA.

### Prior Plans (Inherit, Do Not Re-Litigate)

- **`docs/plans/2026-04-20-001-feat-www-governance-positioning-refresh-plan.md`** — moved AWS containment from headline to trust-proof; established five governance controls as proof spine. **Inherit:** governance-as-proof framing.
- **`docs/plans/2026-04-21-008-docs-full-rewrite-thinkwork-docs-site-plan.md`** — full rewrite of all 73 docs pages against STYLE.md. **Inherit:** existing voice; do not redo leaves.
- **`docs/plans/2026-04-21-009-docs-www-journey-messaging-rewrite-plan.md`** — locked in "Start small. Build trust. Scale AI safely." and the Journey + HowItWorks + Ownership component triad. **Supersede the journey framing**; preserve the component triad (Journey component repurposed into rollout-path narrative).
- **`docs/plans/2026-04-22-002-docs-www-homepage-copy-polish-plan.md`** — tightened hero subhead, made "templates" business-legible, deduped lower-half repetition, repositioned MobileApp from side-quest to spine. **Inherit** all of these.
- **`docs/plans/2026-04-22-004-refactor-www-reduce-aws-repetition-plan.md`** — cut "AWS" from ~10 verbatim repetitions to 3–4 well-placed anchors. **Hard inherit** — do not undo.
- **`docs/plans/2026-04-22-008-feat-stripe-pricing-and-post-checkout-onboarding-plan.md`** — Stripe Checkout flow, `packages/pricing-config`, mobile + www both render the same plans, post-checkout bounce. **Inherit infrastructure**; the tier *names + IDs* change in U4.
- **`docs/plans/2026-04-23-001-refactor-docs-site-visual-coherence-with-www-plan.md`** — palette, chrome, font alignment between docs and www. **Hard inherit** — visual layer untouched in this plan.

### External References

- *The Definitive Guide to Harness Engineering* (article supplied by Eric in the planning prompt) — primary external grounding for vocabulary (R.E.S.T., PPAF, REPL harness, horse/reins, Control Plane / Data Plane, the Three Constraints / Six Principles, the Cognitive-Loop × Context-Efficiency matrix). Treated as the canonical reference; all derivative copy on Thinkwork surfaces should be traceable to a section of this article.
- Mitchell Hashimoto's introduction of "Harness Engineering" (HashiCorp co-founder, 2026) and the OpenAI report that popularized it — referenced in the article. **Attribution decision (locked in U1):** name the *category* ("Agent Harness," "Harness Engineering"), do not name Hashimoto or OpenAI in marketing copy. Naming individuals risks dating the page and implying endorsement we don't have.

---

## Key Technical Decisions

- **"Agent Harness" is a category, "ThinkWork" is the brand.** Wordmark stays. Tier naming uses ThinkWork as the prefix on every tier (`ThinkWork`, `ThinkWork for Business`, `ThinkWork Enterprise`). Rationale: zero churn on npm, Stripe, GitHub repo, domains; full master-positioning lift on the public surfaces; preserves brand equity from prior positioning passes.
- **Pricing restructures fully in this plan** (deployment-laddered, not scale-laddered). Pre-launch is the only cheap moment to rename Stripe products. Tier IDs become `open` / `business` / `enterprise`; tier names become `ThinkWork` / `ThinkWork for Business` / `ThinkWork Enterprise`. Old `starter` / `team` / `enterprise` are deleted, not aliased — pre-launch, no aliases needed. The `enterprise` ID survives but is reframed (services-led, not scale-led).
- **R.E.S.T. supplements FiveControls; it does not replace it.** R.E.S.T. is the *language* (the four anchors a buyer can grab); FiveControls is the *implementation* (the five controls that ship in admin). The www governance section gets an R.E.S.T. lens introducing the controls; the controls themselves stay 5, mapped 1:N to the four R.E.S.T. anchors.
- **PPAF is a docs-only structural device.** Surfaces in `docs/architecture.mdx`. Optionally surfaces in `docs/concepts/agents.mdx` if it fits naturally. **Not** pushed to www homepage. Rationale: PPAF is mechanism vocabulary; buyers don't need it; contributors do.
- **Horse/reins is a single sidebar in `docs/architecture.mdx`, not a structural device anywhere.** STYLE.md voice would reject extended metaphor. One callout earns the article reference; more is marketing slop. **Single-use enforcement is a CI grep hook in U11**, not just reviewer discipline — `grep -rEi "horse|reins" apps/ docs/ README.md` runs as a pre-merge gate; >1 hit fails the check.
- **R.E.S.T. acronym homonym with HTTP REST is acknowledged.** The four anchors share an acronym with Representational State Transfer, the most common networking-protocol acronym in software. Mitigation: spell out "Reliability · Efficiency · Security · Traceability" on first use on every public surface; use the acronym only in secondary contexts (chip labels, sidebar titles, control-card tags). Do not lead a homepage section header with bare "R.E.S.T." — buyers Googling the term will land on REST API content.
- **U1 positioning brief is a pre-flight checklist, not a long-form deliverable.** Document review surfaced that the 8 sections originally specified for U1 are already present in this plan (Decisions, Requirements Trace, Open Questions). U1 is restructured as a one-page pre-flight checklist confirming the plan's locked positioning before Phase 2 starts; the long-form brief was redundant scaffolding.
- **U4 is split into U4a (typed code change) and U4b (Stripe operations).** U4a covers `packages/pricing-config` rename, types, mobile type-follow — pure TypeScript, fully testable in CI. U4b covers Stripe product creation in test+prod, `STRIPE_PRICE_IDS_JSON` GitHub vars update, and `deploy.yml` fallback edit — sequential to U4a, gated on Stripe IDs being captured out-of-repo before opening the PR.
- **U10 is folded into Operational Notes**, not its own unit. Manual GitHub UI step (description, topics, social preview) is a runbook checklist; tracking it as a unit added apparent phase complexity without code-level scope.
- **Retire "journey" from www.** Replacement vocabulary: "rollout path" (system-level), explicit phase names ("pilot → expansion → operations") in narrative copy, "adoption arc" only when discussing the engagement shape with leadership audience (services page). Document the swap in STYLE.md so it's enforceable.
- **`AdoptionJourney.astro` component is repurposed, not deleted.** The 4-step component already supports any 4-step narrative; rewrite the steps. Renaming the file (`AdoptionJourney` → `RolloutPath`) is a follow-up — too much component churn for one PR. Component file name is internal; users don't see it.
- **Three-tier articulation pattern is identical on every surface.** Every place we say "ThinkWork ladder" / "three tiers" / "deployment options," the language is the same: open + for-business + enterprise. Defined in U1 brief and lifted verbatim into U3, U5, U7, U9. No paraphrasing.
- **Article attribution is to the category, not the individuals.** No "Mitchell Hashimoto," no "OpenAI report" in copy. We can link the article in a docs footnote if we want a citable source.
- **GitHub repo metadata change is a manual UI step.** No automation file to edit; it lands in U10 as a runbook checklist. Documented so it is not forgotten.

---

## Open Questions

### Resolved During Planning

- **Brand split** — ThinkWork is the brand; Agent Harness is the category. (User-confirmed.)
- **Pricing scope** — full structural restructure now. (User-confirmed.)
- **Tier names** — `ThinkWork` / `ThinkWork for Business` / `ThinkWork Enterprise` with IDs `open` / `business` / `enterprise`. (Resolved in this plan; finalized in U1 brief.)
- **R.E.S.T. role** — supplemental vocabulary over FiveControls implementation. (Resolved.)
- **PPAF scope** — docs-only. (Resolved.)
- **Horse/reins scope** — single sidebar in `docs/architecture.mdx`. (Resolved.)
- **"Journey" retirement** — yes, retire from www; document replacement vocabulary in STYLE.md. (Resolved.)
- **Article attribution** — category only, no individuals. (Resolved.)
- **Component renames** — deferred to follow-up; component filenames stay even when copy semantics shift. (Resolved.)

### Deferred to Implementation

- **Tier feature lists** — exactly what each of the three tiers includes (limits, support, SLA shape) is finalized in U1 pre-flight checklist and ratified in U4a. The current Starter/Team/Enterprise feature splits do not map cleanly to Open/Business/Enterprise; U1 names the new feature splits and U4a ships them.
- **Stripe product IDs and price IDs (test + prod)** — created during U4b out-of-repo; can't be guessed in advance because Stripe assigns the IDs.
- **Final tagline phrasing** — U1 pre-flight will produce 2–3 candidates and lock one. Working candidate: "Agent Harness for Business — production-grade AI work, on AWS you own."
- **OG image text overlay** — `apps/www/public/og-image.png` artwork is preserved (per non-goals); whether the *text overlay* needs regen is a U6 implementation-time call once the new tagline is locked.
- **Concept-hub depth** — U8 is a vocabulary *pass*, not a rewrite. Exact word-count delta per file is implementation-time.

### From 2026-04-24 ce-doc-review (deferred)

Five strategic / framing questions surfaced by document review that don't have concrete fixes — defer for an explicit decision before or during Phase 2:

- **Category education cost not budgeted.** Adopting "Agent Harness" as master frame while refusing to attribute Hashimoto/OpenAI gives buyers no third-party validation when they Google the term. Decide: commit to category-creation (cite source, ship explainer + sustained SEO/blog presence), OR hedge by leading with a buyer-typed phrase ("AI agent platform") and using "Agent Harness" as distinctive descriptor only.
- **OSS contributors vs AWS buyers conflicting signals.** README/GitHub face leading with "for Business" reads as open-core trap to OSS contributors. Decide: keep R2's "identical articulation" or allow the README/GitHub face to lead with the open tier ("Open Agent Harness — self-host on AWS, with operated and services tiers available") while www leads with the paid surface.
- **Master positioning over-indexes on one supplied article.** Vocabulary stack (category, R.E.S.T., PPAF, horse/reins) sourced from one article without buyer-interview validation. Decide: validate the category with N customer conversations before the master rewrite ships, OR accept source-fragility and prepare a hedge surface as Plan B.
- **Stability gate / stopping condition.** This is the 9th positioning/messaging plan in 5 days. Operational Notes records the 30-day no-master-rewrite gate; decide whether the gate should be tighter (e.g., 60 days) or whether component-level polish should also pause.
- **"For Business" excludes individual developers.** Master positioning targets "Business"; individuals/hobbyists/solo founders get no name for their use case. Decide: explicitly exclude the segment (CONTRIBUTING-style "AWS-native is the scope" framing), OR add an explicit Open-tier identity that names individual developers ("ThinkWork Community" / "ThinkWork solo" / etc.).

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Three-Tier Ladder × Surface Matrix

| Surface | Tier articulation | Vocabulary anchors |
|---|---|---|
| **www homepage** | Hero leads with category ("Agent Harness for Business"); ladder appears in pricing + footer; FiveControls reframed under R.E.S.T. lens | R.E.S.T. (primary), category one-liner, ladder phrase |
| **www services** | Tier articulation in FAQ (replaces "same platform, just operated by us"); services packages mapped to ThinkWork Enterprise tier | Three-tier ladder; Enterprise tier framing |
| **www pricing** | Three-column grid by *deployment model* (Open / For Business / Enterprise), not scale | Tier names (ThinkWork / ThinkWork for Business / ThinkWork Enterprise); deployment-model framing |
| **docs landing** | Reframed "What ThinkWork is" → "ThinkWork is an open Agent Harness, with an operated tier (ThinkWork for Business) and Enterprise services on top" | Category, ladder, six-concept model, R.E.S.T. (light) |
| **docs architecture** | PPAF agent loop diagram + R.E.S.T. anchors mapped to architecture sections; horse/reins sidebar | PPAF (primary), R.E.S.T., horse/reins (one callout) |
| **docs concept hubs** | R.E.S.T. mentioned in `concepts/control.mdx`; PPAF mentioned in `concepts/agents.mdx`; rest get vocabulary pass only | Category, R.E.S.T. (control hub), PPAF (agents hub) |
| **README** | H1 keeps "Thinkwork"; tagline reframed as Agent Harness for Business; ladder paragraph added below tagline | Category, ladder, "production-grade open agent harness" |
| **CONTRIBUTING** | "AWS-native by design" preserved; ladder mentioned in scope statement | Ladder; AWS-native scope |
| **package.json `description`** | Single line: "Agent Harness for Business — production-grade AI work, on the AWS account you own" | Category, AWS framing |
| **Header / Footer / OG meta** | Wordmark "ThinkWork" stays; tagline overlays follow new master positioning | Category one-liner |
| **GitHub repo description (manual)** | One line: "Agent Harness for Business — open and operated. Self-host the harness or run it with us, on the AWS account you own." | Category, ladder, AWS framing |

### Sequencing (Phase Map)

```text
Phase 1 — Spec & voice              Phase 2 — Marketing site                  Phase 3 — Documentation foundation       Phase 4 — OSS + sweep            Phase 5 — Documentation depth
─────────────────────────           ───────────────────────────────           ─────────────────────────────────────    ─────────────────────────         ──────────────────────────────────
U1. Pre-flight checklist ──┐
                            ├─► U3. apps/www copy.ts ────┐
U2. STYLE.md additions   ──┘                              ├─► U4a. pricing-config + types
                                                          │       + mobile type-follow (TS-only)
                                                          │              ↓
                                                          │   U4b. Stripe products + STRIPE_PRICE_IDS_JSON
                                                          │       + deploy.yml fallback (after IDs captured)
                                                          │
                                  U5. services.astro    ──┤
                                  U6. Chrome + meta     ──┘─►   U7. Docs landing + getting-started
                                                                + architecture + roadmap
                                                                                ↓
                                                                U8. Concept-hub vocabulary pass (light)
                                                                                ↓
                                                                U12. Harness-skeleton template + threads.mdx gold standard
                                                                                                       ↓
                                                                                              U9. README + CONTRIBUTING + package.json
                                                                                                + npm publish 2FA checklist
                                                                                              U11. STYLE compliance + residual + CI grep hooks
                                                                                                                                                      U13a. Skeleton → Agents + Threads
                                                                                                                                                      U13b. Skeleton → Memory + Connectors
                                                                                                                                                      U13c. Skeleton → Automations + Control
                                                                                                                                                                      ↓
                                                                                                                                                      U14. Configure branch + sidebar restructure

(GitHub repo metadata UI step folded into Operational Notes; not its own unit.)
```

U1 (pre-flight) unblocks everything. U2 (STYLE.md) unblocks any surface rewrite. U3, U4a, U5, U6 can ship in parallel commits inside Phase 2 once U1 + U2 land. **U4b is sequenced after U4a + after Stripe IDs captured out-of-repo**. Phase 3 ships the docs foundation: U7 (top-of-funnel) → U8 (light vocabulary pass on hubs) → U12 (skeleton template authored + threads.mdx as gold standard). Phase 4 closes OSS + sweep loop. **Phase 5 is the docs-as-product depth pass** — applies the skeleton from U12 across all concept areas (U13a/b/c) and finishes with the sidebar IA restructure (U14). Phases 4 and 5 are independent and can execute in either order or in parallel; U11's CI hooks ideally land before U13 so voice drift is caught at PR review during the depth pass.

**U13a/b/c sub-unit sizing.** Each U13 unit covers 8–12 concept files. Implementers should expect 3–5 PRs per U13 unit, NOT one PR. Suggested PR boundaries: hub + 2–3 leaves per PR, grouped by topic (e.g., for U13a: PR-1 = agents.mdx + managed-agents + templates; PR-2 = skills + workspace-overlay; PR-3 = composable-skills cluster; PR-4 = threads.mdx + threads/* leaves). Document the chosen split in the PR title (e.g., "docs(U13a/3 of 4): composable-skills skeleton") so reviewers see progress within a unit.

### Tier Restructure — Before vs. After

```text
BEFORE (scale-laddered, single self-host model)        AFTER (deployment-laddered, three operating models)

Plan IDs:    starter / team / enterprise               Plan IDs:   open / business / enterprise

Starter:     One team. Bounded pilot.                  ThinkWork (open):
             1 tenant, 10 agents, 5 templates                     The open Agent Harness.
             Community support                                    Self-host on your AWS. Apache 2.0.
             [Stripe-billed pilot]                                Community support. Free.

Team:        Cross-team expansion.                     ThinkWork for Business:
             5 tenants, 100 agents, 20 templates                  Agent Harness, operated.
             Priority email                                       Run by us, deployed into your AWS.
             [Stripe-billed monthly]                              Stripe-billed monthly. Managed updates.

Enterprise:  Fleet-scale agent operations.             ThinkWork Enterprise:
             Unlimited tenants, 400+ agents                       Services + SLA + dedicated support.
             SSO + audit exports                                  Strategy, launch, ongoing operations.
             [Sales-led]                                          Sales-led. SLA + named support.
```

The middle tier shifts from "scale of a single self-hosted deployment" to "we operate it for you." The Enterprise tier shifts from "biggest self-hosted plan" to "services-led offering." This is the structural change R3 requires.

---

## Implementation Units

### Phase 1 — Spec & voice

- U1. **Pre-flight positioning checklist**

**Goal:** Lock the positioning decisions that downstream surfaces will copy verbatim, recorded as a one-page checklist appended to this plan rather than a separate doc. (Document review surfaced that an 8-section brief in `docs/brainstorms/` would duplicate this plan's own Decisions + Requirements Trace; the lighter-weight checklist fills the actual gap, which is locking the operational scope of the For Business tier and the exact tagline before Phase 2 starts.)

**Requirements:** R1, R2, R4, R5, R6, R7, R12

**Dependencies:** None (this is the keystone)

**Files:**
- Modify: `docs/plans/2026-04-24-009-feat-reground-agent-harness-for-business-messaging-plan.md` — append a "Pre-flight checklist (locked)" section after the deepening pass, recording the locked values below.

**Approach — pre-flight checklist (must be filled in before Phase 2 starts):**

1. **Master tagline (locked, 1 sentence):** TBD; working candidate "Agent Harness for Business — production-grade AI work, on AWS you own." Lock this exact string before U3 begins.
2. **Three-tier names + IDs (locked):** ThinkWork (`open`) / ThinkWork for Business (`business`) / ThinkWork Enterprise (`enterprise`). Already locked above.
3. **For Business tier operational scope (locked):** Document oncall hours, IAM access model into customer AWS, upgrade cadence, incident SLO, what we DO and DO NOT operate. Without this, "operated by us" copy is aspirational and risks misleading-statement liability. **Block U4b on this being locked.**
4. **R.E.S.T.→FiveControls 1:N map (locked):** Reliability → {Runs in your AWS}; Efficiency → {Cost control + analysis}; Security → {Approved agent capabilities, Runs in your AWS}; Traceability → {Centralized management, Security + accuracy evaluations}. (Working draft; ratify in pre-flight.)
5. **Horse/reins exact sidebar wording (2–3 sentences, locked):** TBD; lock the exact prose before U7 begins.
6. **Journey-replacement map (locked):** "AI adoption journey" → "rollout path"; "the journey to trusted AI work" → "the path to trusted AI work"; "step in the journey" → "step in the rollout"; etc. Lock the full map by greping current copy.ts and docs.
7. **Attribution policy (locked):** Cite category (Agent Harness, Harness Engineering); do not name individuals (Hashimoto, OpenAI). Already locked above.
8. **Open-tier mobile rendering decision (locked):** Either hide the Open tier on mobile pricing screen (route via separate "Self-host on GitHub" link in settings), OR show with non-purchase framing + "Information only" disclaimer. **Block U4a on this being locked.**

**Patterns to follow:**
- Pre-flight checklists in prior plans (e.g., the deployment checklists in plan `2026-04-22-008`)
- `docs/STYLE.md` voice rules

**Test scenarios:**
- Test expectation: none — this unit produces a checklist that is reviewed for content, not behavior. U11 verifies that downstream surfaces are traceable back to checklist items; that's the executable test.
- Acceptance gate (manual review by Eric before Phase 2 ships): items 1, 3, 5, 6, 8 above are filled in (locked) before U3/U4a/U4b/U7 begin.

**Verification:**
- The "Pre-flight checklist (locked)" section is appended to this plan with all 8 items filled in.
- Manual review by Eric confirms the locked values before Phase 2 begins. Block U3/U4a/U4b/U7 on this approval; U5/U6 can run in parallel with the lock.

---

- U2. **STYLE.md vocabulary + voice updates**

**Goal:** Update `docs/STYLE.md` so the new vocabulary is canonical and the journey retirement is enforceable in future PRs.

**Requirements:** R7, R9, R12

**Dependencies:** U1 (brief locks the canonical names)

**Files:**
- Modify: `docs/STYLE.md`
- Modify (audit reference): `docs/STYLE-AUDIT.md` — add a short addendum noting the post-2026-04-24 vocabulary additions if the audit is structured for it; otherwise skip.

**Approach:**
- Add to canonical names section: "Agent Harness," "Agent Harness for Business," "R.E.S.T." (with the four anchors expanded), "PPAF" (with the four phases expanded), "ThinkWork for Business" (the operated tier), "ThinkWork Enterprise" (services tier).
- Move "journey" from www-tolerance to repo-banned. Document replacement vocabulary ("rollout path," explicit phase names, "adoption arc" only for leadership-audience services copy).
- Add a one-paragraph guidance for horse/reins: "Acceptable as a single sidebar callout in `docs/architecture.mdx` linking the harness category. Not for repeated structural use."
- Add the article reference (*Definitive Guide to Harness Engineering*) under "Sources informing voice."

**Patterns to follow:**
- Existing structure of `docs/STYLE.md`
- Existing canonical-names list format

**Test scenarios:**
- Test expectation: none — STYLE.md is a guidance doc, not code. U11 grep audit verifies enforcement on the actual copy.

**Verification:**
- The new canonical names appear in the canonical-names list.
- "Journey" is listed as banned with replacement vocabulary documented.
- Horse/reins guidance is present.
- A grep for the new terms in the rest of the repo finds them used per the new rules (run as part of U11).

---

### Phase 2 — Marketing site

- U3. **apps/www copy.ts master rewrite**

**Goal:** Rewrite every exported object in `apps/www/src/lib/copy.ts` to land the master positioning. This is the largest content lift in the plan.

**Requirements:** R1, R2, R4, R6, R7, R8, R12

**Dependencies:** U1 (brief), U2 (STYLE.md)

**Files:**
- Modify: `apps/www/src/lib/copy.ts`
- Rename: `apps/www/src/components/AdoptionJourney.astro` → `apps/www/src/components/RolloutPath.astro`. Update import in `apps/www/src/pages/index.astro`. (Document review: keeping the `AdoptionJourney` filename trains future contributors to write "journey" prose; the rename closes the drift surface this plan is trying to eliminate.)
- Modify: the renamed component if its prose needs touching (most copy lives in copy.ts).

**Approach:**
- `meta` — new title + description anchored on "Agent Harness for Business."
- `hero` — eyebrow drops "AI adoption journey." H1 + lede land the category one-liner from U1 brief. Update `headlineCandidates` and `ledeCandidates` to seed future iteration.
- `proofStrip` — repurpose 5 pills around R.E.S.T. + the "open vs. operated vs. enterprise" articulation. Likely shape: 4 pills for R, E, S, T + 1 pill for "Open or operated."
- `journey` → repurposed as a rollout-path narrative. The 4-step shape stays (the component renders 4 steps); copy reframes around "Pilot → Visible work → Expansion → Operate." `journey.eyebrow` and `journey.headline` lose the word "journey."
- `howItWorks` — keep the 4-primitive shape (Threads / Memory / Sandbox / Controls); reframe each one-liner under the harness lens (e.g., "Threads keep the harness's perception layer durable").
- `controls` — eyebrow + headline lift the R.E.S.T. lens. The 5 items stay; their `desc` lines pick up the R.E.S.T. anchor each implements (e.g., "Runs in your AWS — Security & Traceability anchor"). Mapping comes from U1 brief.
- `agentTemplates`, `audit`, `costControl`, `evals`, `systemModel`, `memory`, `mobile` — vocabulary pass. No structural changes; pick up "harness," "for Business" tier mentions where natural; drop "journey" mentions; preserve existing facts.
- `quickStart` — keep 5-command list; reframe lede.
- `finalCta` — landing closer needs to land the ladder, not just AWS. New `points` could include one tier-mention.
- `pricing` — `meta`, `eyebrow`, `headline`, `headlineAccent`, `lede`, `smallPrint`, `finePrint` rewritten. `plans` import unchanged here (data lives in `packages/pricing-config` — handled in U4); copy.ts only carries the page-frame copy.
- `services` — high-level pass; full services restructure happens in U5. Here, ensure the `services.meta` and any cross-cutting mentions in copy.ts align with the new ladder.

**Execution note:** Run a search for "journey" inside copy.ts after the rewrite. It should not appear anywhere except in deprecated `headlineCandidates` runner-ups (which are documented as historical).

**Patterns to follow:**
- Existing voice header lines 1–8 of copy.ts
- Existing structure (do not rename exports unless adding new ones)
- `docs/STYLE.md` (post-U2)

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/www build` succeeds and dev server (`pnpm --filter @thinkwork/www dev` on Astro default port 4321 — port 5174 is admin's vite, not www's) renders the homepage end-to-end without runtime errors. Visual smoke check: H1 reads the new tagline, no "journey" anywhere.
- Edge case: every exported object referenced by a component still has the keys the component reads (e.g., `journey.steps[].n / .title / .lede` shape preserved even when content rewritten). Component-level breakage is a regression — Astro's TS will not catch missing `.title` on a const-asserted object. Manual visual review required.
- Integration: the BUILT homepage (`pnpm --filter @thinkwork/www build` → `dist/`) does not contain the strings "transform," "unlock," "empower," "leverage" (verb), "seamlessly," "journey." `grep -ni` over `dist/index.html` is the verification. Run as part of U11.
- Edge case: `meta.title` length is < 70 chars (Google search snippet limit) and `meta.description` is < 160 chars.

**Verification:**
- Dev server renders new homepage.
- `grep -in "journey\|transform\|unlock\|empower\|seamlessly" apps/www/src/lib/copy.ts` returns zero hits in active copy (historical headlineCandidates entries are tagged as such).
- Hero, ProofStrip, Journey (rollout path), HowItWorks, Controls, Audit, CostControl, SystemModel, Memory, Mobile, QuickStart, FinalCTA all render with new copy.
- No console errors in dev or build.

---

- U4a. **Pricing tier rename — typed code change (TS only)**

**Goal:** Rename and restructure the pricing tiers from scale-laddered (Starter / Team / Enterprise) to deployment-laddered (Open / For Business / Enterprise) at the type + data level. **Pure TypeScript change — fully testable in CI without Stripe operations.** Document review split the original U4 into U4a (typed change) and U4b (Stripe ops) so the typed surface can land cleanly while Stripe IDs are captured out-of-repo.

**Requirements:** R3

**Dependencies:** U1 (tier names + features locked in brief), U3 (page lede in copy.ts).

**Files:**
- Modify: `packages/pricing-config/src/plans.ts` — rewrite the three plan objects (id, name, tagline, summary, features, cta, highlighted).
- Modify: `packages/pricing-config/src/types.ts` — `PlanId` union becomes `"open" | "business" | "enterprise"`.
- Modify: `apps/www/src/lib/copy.ts` — `pricing.meta`, `pricing.eyebrow`, `pricing.headline`, `pricing.headlineAccent`, `pricing.lede`, `pricing.smallPrint`, `pricing.finePrint` already updated in U3; reverify here.
- Modify: `apps/www/src/pages/pricing.astro` — Stripe price ID lookup keys, success/cancel paths if any branch on tier ID.
- Modify: `apps/www/src/components/PricingGrid.astro`, `apps/www/src/components/PricingCard.astro` — only if they branch on plan ID; otherwise data pass-through.
- Modify: `apps/mobile/app/onboarding/payment.tsx` — render the new plans (mostly automatic since data flows through pricing-config; verify any hardcoded ID references).
- Modify: `.github/workflows/deploy.yml` — `STRIPE_PRICE_IDS_JSON` mapping with new plan IDs (`open` / `business` / `enterprise`) pointing to the new Stripe price IDs (test + prod).
- External (not a file edit): create new Stripe products + prices in test mode and prod mode; capture price IDs to feed into `STRIPE_PRICE_IDS_JSON`.
- Modify: `packages/pricing-config/test/plans.test.ts` (existing — currently asserts old IDs `["starter", "team", "enterprise"]` and `getHighlightedPlan` returns `"team"`); rewrite to assert new IDs (`open`, `business`, `enterprise`), `business` is highlighted, and `getPlanById` regex matches the new union.
- Test: any existing `apps/www/__tests__/pricing*` or `apps/mobile/__tests__/pricing*` — update fixtures to new IDs.

**Approach:**
- Tier shapes (per U1 brief; final feature lists locked in brief):
  - **Open** (`id: "open"`) — name: "ThinkWork", tagline: "The open Agent Harness," features include "Self-host on your AWS," "Apache 2.0," "Community support," "All product capabilities (Threads, Memory, Agents, Connectors, Automations, Control)," CTA: "Self-host on GitHub," `highlighted: false`. Stripe-billed: NO (free, OSS) — but the plan still appears in the grid as the leftmost tier with a "Self-host" CTA pointing to the GitHub repo + getting-started docs, not Stripe Checkout. `pricing.astro` checkout flow must skip it.
  - **For Business** (`id: "business"`) — name: "ThinkWork for Business", tagline: "Agent Harness, operated.", features include "Run by us, deployed into your AWS," "Managed updates," "Priority email + Slack support," capability features, CTA: "Choose For Business," `highlighted: true` (the recommended/middle column).
  - **Enterprise** (`id: "enterprise"`) — name: "ThinkWork Enterprise", tagline: "Services + SLA + dedicated support.", features include "Strategy, launch, expansion services," "Named support + SLA," "Cross-tenant fleet operations," CTA: "Talk to us" (mailto), `highlighted: false`.
- Stripe checkout flow: only the `business` tier hits Stripe. `open` CTA links to GitHub. `enterprise` CTA is mailto.
- Stripe products: create exactly one new product ("ThinkWork for Business") with one recurring price (monthly) in test mode and prod mode. Annual variant deferred to follow-up unless U1 brief says otherwise.
- Pre-launch: deletion of old `starter` / `team` plans is safe; no live customers. The old `enterprise` tier is reframed (services-led), not deleted; the ID is reused.

**Execution note:** Stripe operations happen out-of-repo in the Stripe dashboard. Capture every Stripe ID (product + price test + price prod) before opening the PR so `STRIPE_PRICE_IDS_JSON` lands with real values, not placeholders.

**Patterns to follow:**
- Existing `packages/pricing-config/src/plans.ts` structure (id, name, tagline, summary, features, cta, highlighted)
- Existing `apps/www/src/pages/pricing.astro` Stripe Checkout invocation pattern
- Existing `STRIPE_PRICE_IDS_JSON` shape in `.github/workflows/deploy.yml` (per `2026-04-22-008` plan)

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/pricing-config typecheck && pnpm --filter @thinkwork/pricing-config test` passes; the three plans have IDs `open`, `business`, `enterprise`; `business` is highlighted; types align with `PlanId`.
- Happy path: `pnpm --filter @thinkwork/www build` produces a pricing page rendering 3 columns with the new names + taglines; clicking the For Business CTA initiates Stripe Checkout against the new test-mode price ID.
- Happy path: mobile `apps/mobile/app/onboarding/payment.tsx` renders the same 3 plans (visual check on TestFlight build) with new IDs flowing through.
- Edge case: pricing.astro checkout handler routes `open` to the GitHub URL (NOT Stripe Checkout); routes `business` to Stripe Checkout; routes `enterprise` to mailto. Each branch tested.
- Error path: missing Stripe price ID for `business` in `STRIPE_PRICE_IDS_JSON` causes a clear error in pricing.astro before any Stripe API call (defensive read; no silent failure).
- Integration: `.github/workflows/deploy.yml` workflow render with new env vars succeeds (no schema drift); runtime `process.env.STRIPE_PRICE_IDS_JSON` deserializes to `{open: "self-host", business: "price_xxx", enterprise: "contact-sales"}` (or equivalent — exact shape per U1 brief).
- Integration: the test in `packages/pricing-config/src/plans.test.ts` asserts (a) plan count = 3, (b) IDs are exactly {open, business, enterprise}, (c) exactly one `highlighted: true`, (d) `business` is highlighted, (e) no plan references retired IDs (`starter`, `team`).

**Verification:**
- Pricing page renders 3 new columns; CTAs route correctly.
- Mobile onboarding renders new plans.
- Old tier IDs grep-clean across the repo (`grep -r "starter\|\"team\"" --include="*.ts" --include="*.tsx" --include="*.astro"` returns no hits in active code; references in `docs/plans/2026-04-22-008-*.md` historical docs are fine).
- **PricingCard CTA differentiation (per HLD):** Open card displays `Free` + `Self-host on GitHub` secondary button; For Business displays price + `Choose For Business` primary button (highlighted treatment); Enterprise displays `Contact sales` + `Talk to us` outline button (mailto). `PricingCard.astro` accepts `ctaKind: 'oss' | 'stripe' | 'sales'` prop or branches on `plan.id`.
- **Open tier visual treatment:** secondary card border, no `highlighted` accent, `Free` price label (not `$0`).
- **Open-tier mobile rendering:** matches the U1 pre-flight decision (hidden on mobile, OR shown with "Information only" disclaimer). App Store review risk on the mobile pricing screen explicitly addressed.

---

- U4b. **Pricing tier rename — Stripe operations + deploy.yml**

**Goal:** Create new Stripe products + prices for the For Business tier in test + prod modes, update the GitHub Actions repository variable `STRIPE_PRICE_IDS_JSON`, and replace the literal fallback default in `deploy.yml`. **Sequenced after U4a + after Stripe IDs are captured out-of-repo.** Distinct from U4a because Stripe operations are non-codifiable and gated on out-of-repo Stripe dashboard work.

**Requirements:** R3

**Dependencies:** U4a (typed change merged); out-of-repo Stripe product+price creation (test + prod) completed; For Business operational scope locked in U1 pre-flight.

**Files:**
- Modify: `.github/workflows/deploy.yml` — replace literal `||` fallback default that currently bakes in `starter`/`team`/`enterprise` price IDs. Replacement: empty `{}` so missing vars surface as a clear error instead of silently routing to retired tiers.
- External (not a file edit): create new Stripe products + prices in test mode and prod mode; capture price IDs.
- External (not a file edit): set `vars.STRIPE_PRICE_IDS_JSON` for the dev stage to the new mapping. Per `feedback_github_actions_vars_snapshot_at_trigger`, this must happen **before** the U4b PR's deploy workflow dispatches.

**Approach:**
- **Stripe storage posture (locked):** Stripe price IDs go in `vars.STRIPE_PRICE_IDS_JSON` only — never as a literal in `deploy.yml`. This prevents IDs from baking into commit history and makes rotation a single-var update. Stage separation (test vs prod) handled by stage-aware lookup inherited from plan `2026-04-22-008`.
- **Cutover sequence:** (1) create Stripe products + prices in test mode, capture IDs. (2) update `vars.STRIPE_PRICE_IDS_JSON` for dev stage. (3) verify dev Stripe Checkout works against the new For Business test price. (4) create Stripe products + prices in prod mode, capture IDs. (5) update `vars.STRIPE_PRICE_IDS_JSON` for prod stage. (6) merge U4b PR (which removes the literal fallback in deploy.yml). (7) Smoke-test prod Stripe Checkout with a test card before announcing the new tier publicly.
- **Rollback:** if dev Checkout breaks post-merge, revert `vars.STRIPE_PRICE_IDS_JSON` to the legacy mapping; old products are archived (not deleted), so the prior tier IDs still resolve until Stripe products are explicitly deactivated.

**Test scenarios:**
- Happy path: Stripe Checkout works against the For Business test-mode price; success/cancel paths route correctly.
- Happy path: prod-mode Stripe Checkout smoke transaction (small-amount, real card, refunded immediately) succeeds before the new tier is announced.
- Edge case: deploy.yml with empty `{}` fallback — missing vars cause a clear error in pricing.astro, not a silent route to retired tiers.
- Integration: `vars.STRIPE_PRICE_IDS_JSON` for dev stage is set before U4b PR's deploy dispatches; post-merge dev Checkout works without re-dispatch.
- Edge case: archive (don't delete) old Stripe products + deactivate old prices so retired IDs in any old PR description / git history return Stripe errors rather than silent billing.

**Verification:**
- New Stripe products + prices exist in test + prod with captured IDs.
- `vars.STRIPE_PRICE_IDS_JSON` reflects new mapping in dev + prod stages.
- `deploy.yml` literal fallback replaced with `{}`.
- Dev Stripe Checkout works against the new For Business test price.
- Prod smoke transaction succeeded.
- Old products archived, old prices deactivated.

---

- U5. **apps/www services.astro restructure**

**Goal:** Reframe the services page as the marketing surface of the **ThinkWork Enterprise** tier (the third rung of the ladder), not as a generic services menu. Resolve the FAQ contradiction with the new ladder.

**Requirements:** R1, R2, R10, R12

**Dependencies:** U1, U2, U3 (copy.ts services.* shape).

**Files:**
- Modify: `apps/www/src/lib/copy.ts` — `services.*` exports (hero, proof, positioning, how, packages, faq, closingCta).
- Modify: `apps/www/src/pages/services.astro` — only if it has hardcoded copy not in copy.ts (most pages don't).
- Modify: `apps/www/src/components/ServiceCard.astro` — only if it has hardcoded copy.
- Modify: `docs/residual-review-findings/feat-www-services.md` — close out residuals as part of this rewrite. **U5 is the sole owner of edits to this file.** U11 audits closure via grep but does not edit the file.

**Approach:**
- `services.hero` — eyebrow drops "Services" generic; new framing: "ThinkWork Enterprise — pilot to production, governed." H1 lands the Enterprise positioning. CTA mailto preserved.
- `services.proof` — 4 platform-and-posture items reframed under the harness lens: "Production-grade harness in your AWS," "AWS Bedrock AgentCore runtime," "Per-tenant Cognito + IAM," "Full audit + R.E.S.T. evaluation log." (Drop "Cloud or self-hosted" item since hosting is now the For Business tier story, not a services-page promise.)
- `services.positioning` — body rewritten to land "one partner across the full adoption arc," with explicit callout that this is the Enterprise tier of the ladder.
- `services.how` — 4-phase engagement lifecycle stays; "scope → launch → expand → operate" wording preserved (already strong).
- `services.packages` — 6 packages stay; outcome lines reframed to mention the harness/operated context.
- `services.faq` — **rewrite Q3 specifically**: "How does this relate to ThinkWork for Business?" Replace the misleading "same platform, just operated by us" with: "ThinkWork is the open Agent Harness; ThinkWork for Business is the same harness operated by us; ThinkWork Enterprise (this page) wraps either with strategy, launch, and operations services." This is the load-bearing FAQ rewrite that resolves the ladder contradiction.
- `services.closingCta` — body lands the ladder + Enterprise tier framing.

**Patterns to follow:**
- Existing `services.*` structure in copy.ts lines 410–698
- Existing services page composition in `apps/www/src/pages/services.astro`

**Test scenarios:**
- Happy path: `/services` route renders end-to-end in dev; new hero, proof, packages, FAQ all visible.
- Happy path: 6 service packages (4 featured + 2 secondary) all render with updated outcome lines.
- Edge case: FAQ Q3 explicitly mentions all three tiers (ThinkWork / ThinkWork for Business / ThinkWork Enterprise) and routes the reader correctly to pricing.astro for the first two and the services packages for the third.
- Integration: `mailto:` CTAs use the same email + subject patterns as before (they are scoped per-package; existing `mailtoSubject` strings preserve routing in the services inbox).
- Edge case: SEO meta title for `/services` is < 70 chars; description < 160 chars.
- Integration: residuals in `docs/residual-review-findings/feat-www-services.md` are explicitly addressed or marked closed by this unit. The residual-review file is touched.

**Verification:**
- `/services` page renders without errors.
- FAQ Q3 articulates the three-tier ladder cleanly; no contradictory language remains.
- 6 packages have updated copy mapped to Enterprise framing.
- `docs/residual-review-findings/feat-www-services.md` closed out or has a clear final state recorded.

---

- U6. **apps/www chrome + meta**

**Goal:** Update the navigational and meta surfaces so the master positioning shows up in tabs, OG cards, and footer, not just in scrollable hero copy.

**Requirements:** R1, R8

**Dependencies:** U1, U3 (copy.ts is the source for nav labels + meta).

**Files:**
- Modify: `apps/www/src/components/Header.astro` — verify nav labels (Platform / Services / Pricing) still fit; consider whether "Platform" should become "Product" given the category emphasis, but DO NOT churn nav unless U1 brief calls for it.
- Modify: `apps/www/src/components/Footer.astro` — wordmark "ThinkWork" stays; consider adding a one-line tagline below the wordmark per U1 brief.
- Modify: `apps/www/src/layouts/Base.astro` — line 9 default OG description rewritten to match new tagline.
- Modify: `apps/www/src/pages/m/checkout-complete.astro` — bounce-back copy says "Back to the ThinkWork app." Verify this copy matches the new For Business tier framing (likely fine as-is; just lands in the right tier's flow now).
- Modify (manual external step): regenerate `apps/www/public/og-image.png` text overlay if the U1 tagline displaces the current overlay text. Artwork preserved.

**Approach:**
- Conservative chrome edits — Header/Footer churn is high-risk for cross-link breakage.
- Base.astro line 9 default description is the OG fallback for any page without its own meta; rewrite to land master positioning in <=160 chars.
- OG image: defer artwork regen if current image still works; replace text overlay only if U1 tagline differs from current overlay.

**Patterns to follow:**
- Existing Header / Footer components
- Existing Base.astro meta defaults

**Test scenarios:**
- Happy path: every page renders with new OG description fallback; viewing source of `/`, `/services`, `/pricing` shows the new master positioning in the meta description tag (when individual pages don't override it).
- Happy path: footer wordmark + tagline render correctly across all pages.
- Edge case: nav doesn't wrap to a second line on common viewport widths (already a constraint in current nav).
- Edge case: OG image (`/og-image.png`) loads and the dimensions match Twitter / LinkedIn / Facebook OG specs (1200×630).

**Verification:**
- `view-source:/`, `view-source:/services`, `view-source:/pricing` in dev show the new meta description on pages without their own meta override.
- Footer wordmark renders correctly.
- OG image loads.

---

### Phase 3 — Documentation

- U7. **Docs landing + getting-started + architecture + roadmap**

**Goal:** Reframe the top-of-funnel docs around setting up and managing an Agent Harness for Business, with PPAF as the primary structural device in `architecture.mdx`, R.E.S.T. as the language layer, and a single horse/reins sidebar. (REPL harness and Control Plane / Data Plane vocabulary from the article are intentionally *not* introduced here — scoped down per document review to keep the vocabulary budget at three new devices.)

**Requirements:** R1, R2, R5, R6

**Dependencies:** U1, U2.

**Files:**
- Modify: `docs/src/content/docs/index.mdx` — frontmatter `title`, `description`, `hero.tagline`; body sections "What ThinkWork is," "Six core concepts, one deploy," "Quick start." Add a new section after intro describing the three-tier ladder so docs visitors land on the same articulation as the website.
- Modify: `docs/src/content/docs/getting-started.mdx` — intro paragraph reframed; Quick Start chrome unchanged (commands and flow are correct).
- Modify: `docs/src/content/docs/architecture.mdx` — primary surface for the harness mechanics. Add: PPAF agent loop diagram (mermaid), R.E.S.T. anchors mapped to the existing architecture sections, single horse/reins sidebar (callout) linking the article reference. Do NOT add REPL harness or Control Plane / Data Plane vocabulary — those exceed the three-device budget locked in U1 brief and are reserved for a follow-up architecture-deepening pass.
- Modify: `docs/src/content/docs/roadmap.mdx` — intro paragraph reframed.
- Modify: `docs/src/components/Hero.astro` — only if it has hardcoded copy outside frontmatter (it reads `hero.tagline` from frontmatter; no edit needed unless the splash chrome carries text).

**Approach:**
- Index.mdx: replace "ThinkWork is an open agent harness you deploy into your own AWS account" with "ThinkWork is the open Agent Harness for Business — a Terraform module that stands up the whole system inside your own AWS account, with the option to have us operate it (ThinkWork for Business) or wrap it with services (ThinkWork Enterprise)." Six-concept card grid stays unchanged.
- Getting-started: light touch; the eight-command quick start is the load-bearing content. Intro para reframed.
- Architecture: add a top-level section "The harness mechanics" with subsections:
  - "PPAF agent loop" with a mermaid diagram showing Perception → Planning → Action → Feedback cycle (article §3 + §5.2.1)
  - "R.E.S.T. anchors" — one paragraph each, linked to existing architecture sections
- One sidebar callout (Starlight `<Aside>` component) on the architecture page: the horse/reins paragraph from U1 brief, attribution to the article in a footnote link (no individual names per attribution policy).
- Roadmap: intro paragraph reframes upcoming work as "what's next for the harness." Item list unchanged.

**Patterns to follow:**
- Existing Starlight frontmatter format on `index.mdx`
- Existing `<Card>` and `<CardGrid>` from `@astrojs/starlight/components`
- Existing `<Aside>` for sidebars
- Mermaid via Starlight's built-in support
- `docs/STYLE.md` voice (post-U2)

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/docs build` succeeds; `pnpm --filter @thinkwork/docs dev` renders the four pages without errors.
- Happy path: docs landing splash hero renders new tagline; six-concept card grid intact.
- Happy path: architecture page renders the new "harness mechanics" section with the PPAF mermaid diagram (visual check that the diagram renders, not just inline as text).
- Edge case: `<Aside>` for horse/reins renders as a sidebar, not inline prose.
- Edge case: existing internal anchor links to `#what-thinkwork-is`, `#six-core-concepts-one-deploy`, `#quick-start` still work after rewrite (heading slugs unchanged).
- Integration: docs sidebar nav (configured in `docs/astro.config.mjs`) is unaffected — these are content edits only.
- Edge case: roadmap table renders with same items.

**Verification:**
- All four pages render in `pnpm --filter @thinkwork/docs dev`.
- Mermaid diagram on architecture page displays.
- Aside callout renders as a sidebar.
- No broken internal links.

---

- U8. **Concept-hub vocabulary pass (light)**

**Goal:** Light vocabulary pass on the six concept hubs to thread R.E.S.T. and PPAF where natural. **This unit does NOT apply the full 5-section harness skeleton — that work is in U13a/b/c after U12 authors the template.** U8 keeps its original Phase 3 scope (1–3 paragraph additions per hub, no leaf rewrites) so it can execute in Phase 3 without depending on U12.

**Requirements:** R4, R5, R12 *(R13/R14 are satisfied by U13/U14, not U8 — U8 is the vocabulary pre-pass)*

**Dependencies:** U1, U2, U7 (architecture page sets the parent pattern). **No dependency on U12** — U8's scope is intentionally limited to vocabulary additions so it ships in Phase 3 alongside U7.

**Files:**
- Modify: `docs/src/content/docs/concepts/agents.mdx` — intro mentions PPAF agent loop linking to architecture page.
- Modify: `docs/src/content/docs/concepts/threads.mdx` — light pass; thread is the harness's perception + history layer (Traceability anchor).
- Modify: `docs/src/content/docs/concepts/knowledge.mdx` — light pass; memory is the harness's context-management layer (article §4.2.1 + §5.2.2).
- Modify: `docs/src/content/docs/concepts/connectors.mdx` — light pass; connectors are the harness's I/O surface.
- Modify: `docs/src/content/docs/concepts/automations.mdx` — light pass; automations are the scheduled-trigger surface.
- Modify: `docs/src/content/docs/concepts/control.mdx` — primary surface for R.E.S.T. mapping. Add "R.E.S.T. anchors" intro section before existing controls breakdown.

**Approach:**
- Hubs only; **do not** descend into `concepts/agents/managed-agents.mdx`, `concepts/threads/auto-channel.mdx`, etc. Leaves are out of scope (deferred to follow-up).
- Each hub gets max ~1–3 paragraph additions threading vocabulary; existing canonical content preserved.
- `control.mdx` gets the heaviest lift — R.E.S.T. anchor section that explicitly maps Reliability/Efficiency/Security/Traceability to the FiveControls items.

**Execution note:** Run a STYLE.md pass on each hub after editing — `journey`, `transform`, `unlock`, etc. should not have crept in.

**Patterns to follow:**
- Existing concept-hub structure (intro → primary content → cross-links)
- Architecture page R.E.S.T. mapping established in U7

**Test scenarios:**
- Happy path: all six concept hubs render in `pnpm --filter @thinkwork/docs dev`.
- Happy path: control.mdx new R.E.S.T. section is visible; each anchor maps to a named FiveControls item.
- Edge case: agents.mdx PPAF mention links to `architecture.mdx#ppaf-agent-loop` (correct anchor slug).
- Integration: existing internal links from leaves into hubs (`concepts/agents/managed-agents.mdx` linking to `concepts/agents.mdx`) still resolve.
- Edge case: starlight sidebar nav is unchanged (no slug renames).

**Verification:**
- All six hubs render.
- control.mdx R.E.S.T. mapping is present and complete.
- No broken cross-links from leaf pages.

---

### Phase 4 — OSS + sweep

- U9. **OSS surface — README, CONTRIBUTING, package.json, apps/cli/README**

**Goal:** Land master positioning on the GitHub-discoverable surfaces. Reconcile the package.json/README "platform" vs "harness" drift. Add the three-tier ladder mention.

**Requirements:** R1, R2, R11

**Dependencies:** U1.

**Files:**
- Modify: `README.md` — H1 stays "Thinkwork"; tagline reframed to land Agent Harness for Business; lede paragraph adds the three-tier ladder articulation; status, what-ships, admin, mobile, roadmap, quick start, repo layout, technology, contributing, security, license sections preserved.
- Modify: `CONTRIBUTING.md` — keep "AWS-native by design"; add ladder mention in scope statement; preserve "feature requests assuming non-AWS substrate will be politely declined" boundary.
- Modify: `package.json` — line 5 `"description"` rewritten: "Agent Harness for Business — production-grade AI work, on the AWS account you own" (or U1 brief equivalent). Resolves the "platform" vs "harness" drift.
- Modify: `apps/cli/README.md` — light pass; tagline + ladder mention; per-command reference unchanged. apps/cli/README is npm-discoverable (ships with the published package).
- Verify only (no edits): `CODE_OF_CONDUCT.md` (boilerplate), `SECURITY.md` (process), `CLA.md` (legal), `LICENSE`, `NOTICE`. None carry positioning copy.

**Approach:**
- README tagline: "Production-grade open Agent Harness for teams that already live on AWS — self-host, operate with us, or scale through services."
- README lede: existing "Threads run the work, memory carries context forward..." paragraph is strong; preserve its body, prepend a sentence introducing the ladder.
- README "Eight commands, one AWS account" line: keep but rephrase tail — "you own a production-grade Agent Harness instead of renting a black box" (already close).
- package.json description: keep concise (npm shows ~120 chars).
- apps/cli/README.md: tagline-level edits; the per-command reference is the authoritative load-bearing content and should not churn.

**Execution note:** README quick-start command list (8 commands) and `apps/cli/README.md` per-command reference are factually correct content; do not edit them as part of this voice pass.

**Patterns to follow:**
- Existing README structure (centered logo, H1, tagline, badges, lede, status, what ships, admin, mobile, roadmap, quick start, repo layout, technology, contributing, security, license)
- Existing CONTRIBUTING structure

**Test scenarios:**
- Happy path: `cat README.md | head -25` shows new tagline + lede with ladder articulation.
- Happy path: `node -e "console.log(require('./package.json').description)"` shows the new description.
- Happy path: GitHub renders README correctly (badge URLs resolve, image paths resolve, anchor links work).
- Edge case: README quick-start commands match `apps/cli/README.md` and current CLI surface (8 commands listed; matches `thinkwork login / doctor / init / plan / deploy / bootstrap / login --stage / me`).
- Integration: `pnpm --filter thinkwork-cli build && cat apps/cli/dist/...` (or equivalent) — confirm CLI's published README (often packaged from apps/cli/README.md) shows new tagline.
- Edge case: badge URLs in README (`shields.io/npm/v/thinkwork-cli`, license badge, docs badge) all still resolve.

**Verification:**
- README + CONTRIBUTING + package.json + apps/cli/README updated.
- `package.json` description matches the new master positioning.
- No factual drift from existing technical references.

---

- U12. **Harness-skeleton docs template**

**Goal:** Author the canonical docs-page template that every concept hub and leaf uses. This is the source of truth for what "docs is product" looks like in practice — every page R13 covers reads against this template.

**Requirements:** R13, R14

**Dependencies:** U2 (STYLE.md vocabulary additions land first), U7 (architecture intro establishes the harness framing the template references).

**Files:**
- Create: `docs/STYLE.md` — append a "Concept page skeleton" section with the canonical structure below.
- Modify: `docs/src/content/docs/concepts/threads.mdx` — first concrete application; serves as the gold-standard implementation other hubs imitate (parallel to how `docs/concepts/knowledge/compounding-memory-pipeline.mdx` was the gold-standard for the prior docs rewrite).
- Verify only: existing `docs/concepts/knowledge/compounding-memory-pipeline.mdx` matches the template; if it diverges, note as known-deferred.

**Approach — concept page skeleton (canonical):**

```
1. **Why this component exists in the harness** (1 paragraph)
   What problem it solves under the harness frame; which R.E.S.T. anchor(s) it implements.

2. **What it does** (2-3 paragraphs + bullets)
   Canonical behavior; canonical names (Threads, Memory, Agents, etc.).
   No implementation detail — that's reference docs' job.

3. **How to configure it** (1-2 paragraphs + concrete steps)
   Admin surface or CLI flag mapping. Cross-link to the matching admin route under
   /applications/admin/<route>/. If CLI-configurable, name the flag.
   Production-grade: name the IAM/cost/limit dimensions that matter.

4. **Common patterns / runbooks** (at least 1 worked-through scenario)
   "When you want X, do Y" — a real workflow, not abstract description.
   Cross-links to /guides/ runbooks where deeper.

5. **Cross-links** (footer)
   - Architecture: relevant section in /architecture/
   - Admin route: /applications/admin/<route>/
   - Reference: /api/<endpoint>/ or /sdks/<name>/<symbol>/ when applicable
   - Related concepts: at least 2 sibling concept pages
```

**Patterns to follow:**
- Existing `docs/concepts/knowledge/compounding-memory-pipeline.mdx` — closest current example of product-grade docs treatment.
- `docs/STYLE.md` voice rules (post-U2).
- Starlight component vocabulary: `<Card>`, `<CardGrid>`, `<Aside>`, `<Tabs>`, `<Steps>`, `<LinkCard>` for cross-links.

**Test scenarios:**
- Test expectation: none — this unit produces a template doc + a single gold-standard application. U13 verifies the template propagates correctly to other concept areas.
- Gold-standard acceptance gate: `docs/src/content/docs/concepts/threads.mdx` has all 5 skeleton sections with concrete content, links to `applications/admin/threads/` (or whatever route exists), and at least 1 runbook in section 4.

**Verification:**
- STYLE.md "Concept page skeleton" section exists and matches the structure above.
- threads.mdx renders in `pnpm --filter @thinkwork/docs dev` and follows the skeleton end-to-end.
- One concrete cross-link to an admin route resolves.

---

- U13a. **Apply harness skeleton to Agents + Threads concept areas**

**Goal:** Apply the U12 template to all leaves under `docs/concepts/agents/*` and `docs/concepts/threads/*`. These are the highest-traffic concept areas and the closest to admin-product surfaces. Per R13, each page ships with Why / What / Configure / Patterns / Cross-links.

**Requirements:** R13, R14

**Dependencies:** U12 (template), U8 (hubs adopt skeleton).

**Files:**
- Modify: `docs/src/content/docs/concepts/agents.mdx` (hub — light pass after U8, ensure cross-links resolve)
- Modify: `docs/src/content/docs/concepts/agents/managed-agents.mdx`
- Modify: `docs/src/content/docs/concepts/agents/templates.mdx`
- Modify: `docs/src/content/docs/concepts/agents/skills.mdx`
- Modify: `docs/src/content/docs/concepts/agents/workspace-overlay.mdx`
- Modify (and verify all leaves under): `docs/src/content/docs/concepts/agents/composable-skills/*`
- Modify: `docs/src/content/docs/concepts/threads.mdx` (hub — gold standard from U12)
- Modify: all leaves under `docs/src/content/docs/concepts/threads/*` (auto-channel, etc.)

**Approach:**
- Each leaf adopts the 5-section skeleton. Existing technical content is *redistributed* into sections, not rewritten unless content is stale or contradicts the new positioning.
- Cross-links to admin routes (`applications/admin/agents/`, `applications/admin/threads/`) — if the admin route doesn't have a corresponding doc, note it; don't create new admin docs in this unit.
- Where two leaves describe overlapping concerns, consolidate (a leaf's job is to be the entry point, not duplicate the hub).

**Patterns to follow:**
- U12 template; threads.mdx as the gold-standard implementation.
- `docs/STYLE.md`.

**Test scenarios:**
- Test expectation: none — content edits, no behavior change. U11 grep audits enforce voice consistency.
- Acceptance gate: every page in scope has all 5 skeleton sections; at least one cross-link to an admin route per page resolves.

**Verification:**
- `pnpm --filter @thinkwork/docs build` succeeds; no broken internal links.
- Sidebar nav (`docs/astro.config.mjs`) renders all pages.
- Spot-check 3 random leaves: each has Why / What / Configure / Patterns / Cross-links sections with concrete content.

---

- U13b. **Apply harness skeleton to Memory + Knowledge + Connectors concept areas**

**Goal:** Same skeleton treatment for `docs/concepts/knowledge/*` and `docs/concepts/connectors/*`. Memory is the harness's context layer (R.E.S.T. Reliability + Traceability); Connectors are the harness's I/O surface.

**Requirements:** R13, R14

**Dependencies:** U12, U13a (parallel pattern established).

**Files:**
- Modify: `docs/src/content/docs/concepts/knowledge.mdx` (hub — post-U8 light pass)
- Modify: all leaves under `docs/src/content/docs/concepts/knowledge/*` (memory, retrieval-and-context, compounding-memory-pipeline, etc.)
- Modify: `docs/src/content/docs/concepts/connectors.mdx` (hub)
- Modify: `docs/src/content/docs/concepts/connectors/integrations.mdx`
- Modify: `docs/src/content/docs/concepts/connectors/mcp-tools.mdx`

**Approach:**
- Memory area: `compounding-memory-pipeline.mdx` is already the gold-standard from prior plan `2026-04-21-008` — verify it still matches the U12 skeleton and update only if drifted.
- Connectors: leaves describe Slack/GitHub/Google Workspace + MCP tools. Each gets explicit "How to configure" with admin-route cross-links to the connector setup page.

**Patterns to follow:**
- U12; existing `compounding-memory-pipeline.mdx` as a reference.

**Test scenarios:**
- Test expectation: none.
- Acceptance gate: each page in scope has all 5 sections; the three connector leaves (Slack, GitHub, Google Workspace) each have a runbook in section 4.

**Verification:**
- Build passes; cross-links to `applications/admin/connectors/` resolve.

---

- U13c. **Apply harness skeleton to Automations + Control concept areas**

**Goal:** Same treatment for `docs/concepts/automations/*` and `docs/concepts/control/*`. Automations is the scheduled-trigger surface; Control is the governance + R.E.S.T. anchor mapping (already heaviest in U8 because it carries the R.E.S.T. anchor section).

**Requirements:** R13, R14

**Dependencies:** U12, U13a, U13b.

**Files:**
- Modify: `docs/src/content/docs/concepts/automations.mdx` (hub)
- Modify: all leaves under `docs/src/content/docs/concepts/automations/*`
- Modify: `docs/src/content/docs/concepts/control.mdx` (hub — already R.E.S.T.-heavy from U8)
- Modify: all leaves under `docs/src/content/docs/concepts/control/*`

**Approach:**
- Control's hub already has the R.E.S.T. anchor section from U8; here, ensure each leaf (budgets, evaluations, audit, etc.) maps to specific R.E.S.T. anchors and admin routes.
- Automations leaves include the AWS Scheduler / job-trigger / wakeups model — the production-grade "how to configure" must include the `rate()` semantics gotcha (from `project_automations_eb_provisioning` memory).

**Patterns to follow:**
- U12; control.mdx hub as the in-house pattern reference.

**Test scenarios:**
- Test expectation: none.
- Acceptance gate: every page has skeleton sections; control.mdx leaves each name which R.E.S.T. anchor they implement.

**Verification:**
- Build passes; the `rate()` configuration note appears in at least one automations leaf.

---

- U14. **Configure branch + sidebar restructure**

**Goal:** Restructure the Starlight sidebar (`docs/astro.config.mjs`) to reflect the harness-skeleton information architecture per R14. Add a "Configure" branch grouping deploy + connectors + skills + evaluations + memory operations under one sidebar tree; ensure Reference branch (api + sdks + cli) is distinct from Concepts.

**Requirements:** R14

**Dependencies:** U12, U13a, U13b, U13c (all concept content lands first; sidebar restructure is the last step so it doesn't precede broken links).

**Files:**
- Modify: `docs/astro.config.mjs` — sidebar config restructure.
- Modify (if needed): a small number of doc files to align frontmatter `sidebar` ordering with the new tree.
- Modify: `docs/src/content/docs/index.mdx` — top-of-page navigation cards adopt the new four-branch shape (Architecture / Components / Configure / Reference) instead of the current six-concept-only grid.

**Approach:**
- Four sidebar branches at the top level:
  - **Architecture** — getting-started, architecture, roadmap (the harness intro)
  - **Components** — the six concept areas (the body of R13/U8/U13)
  - **Configure** — deploy, connectors setup, skill packs, evaluations, compounding-memory operations (the runbook tree)
  - **Reference** — api, sdks, cli (existing technical reference)
- The current sidebar nests `applications/admin/*` (22 pages), `applications/mobile/*` (6), `applications/cli/*` (2). These stay grouped under Reference (or a separate Applications branch — implementer decision based on visual clarity).

**Patterns to follow:**
- Existing `docs/astro.config.mjs` sidebar shape (preserve any non-trivial config like collapsible defaults).
- Starlight sidebar API documentation.

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/docs dev` renders the new four-branch sidebar; all existing pages are reachable from the new structure.
- Edge case: deep links to specific pages (e.g., `/concepts/agents/managed-agents/`) still resolve — slug paths unchanged, only sidebar grouping changes.
- Edge case: docs landing index.mdx four-branch card grid renders; each card links to a real branch landing page.
- Integration: external references to docs URLs (in README, GitHub, blog if any) still resolve — check that no slugs were renamed.

**Verification:**
- Build passes.
- Sidebar renders with four top-level branches.
- All 73+ pages reachable; no orphaned pages.
- index.mdx four-card grid replaces (or supplements) the six-concept grid.

---

- U10. **GitHub repo metadata** *(folded into Operational Notes)*

Document review surfaced that U10 is a runbook step (manual GitHub UI edits), not an implementation unit (no files, no automated tests, single actor). Folded into Operational Notes as a post-merge runbook item under "GitHub repo metadata update." U-ID retained as a gap per the U-ID stability rule (no renumbering of subsequent units). The runbook items previously specified here (description, topics, social preview, npm verification) live in Operational Notes below.

---

- U11. **STYLE compliance audit + residual-review closure**

**Goal:** Final sweep across all surfaces touched by U1–U10 to verify STYLE.md voice compliance, AWS-mention budget preservation, journey retirement, and residual closure.

**Requirements:** R7, R8, R9, R10, R12

**Dependencies:** U2, U3, U4, U5, U6, U7, U8, U9.

**Files:**
- Read-only verification: `docs/residual-review-findings/feat-www-services.md` — confirm U5 has marked residuals closed; do not edit (U5 owns the edits).
- No code files modified by this unit; it is verification only.

**Approach:**
- **Banned-word grep:** `grep -rEin "journey|transform|unlock|empower|seamlessly|leverage" apps/www/src docs/src/content README.md CONTRIBUTING.md package.json` — every hit is reviewed; legitimate uses (e.g., "leverage" as a noun) are tagged as accepted; anything else is fixed before this unit closes.
- **Horse/reins single-use CI grep hook (new):** add a CI grep step (in `.github/workflows/lint.yml` or equivalent) that runs `grep -rEi "horse|reins" apps/ docs/ README.md` and fails if more than 1 hit is found. The single allowed hit lives in `docs/src/content/docs/architecture.mdx`. This converts the single-use rule from reviewer-discipline-only to mechanically enforced.
- **R.E.S.T. bare-acronym lead grep:** `grep -rEn "^#+\\s+R\\.E\\.S\\.T\\." apps/www/src docs/src/content` — zero hits. Section headings must use spelled-out form ("Reliability · Efficiency · Security · Traceability") on first surface; bare acronym only in chip labels, sidebar titles, and secondary surfaces.
- **AWS-mention budget:** count "AWS" occurrences in `apps/www/src/lib/copy.ts`. Stay near 3–4 anchors per `2026-04-22-004` precedent. If the count creeps above 6, flag for trim.
- **Tagline propagation:** `grep -r "Agent Harness for Business" apps/www/src docs/src/content README.md package.json` — appears on every surface listed in R1.
- **Tier articulation propagation:** `grep -r "ThinkWork for Business" apps/www/src docs/src/content README.md` — appears on www homepage, www pricing, www services FAQ, docs landing, README. The phrase is used identically (no paraphrasing) across surfaces.
- **R.E.S.T. propagation:** `grep -rE "Reliability|Efficiency|Security|Traceability" docs/src/content/docs/concepts/control.mdx docs/src/content/docs/architecture.mdx apps/www/src/lib/copy.ts` — present in all three.
- **PPAF propagation:** `grep -rE "Perception.*Planning.*Action.*Feedback|PPAF" docs/src/content/docs/architecture.mdx docs/src/content/docs/concepts/agents.mdx` — present.
- **Horse/reins single-use enforcement:** `grep -rEi "horse|reins" apps/ docs/ README.md` — exactly one hit, in `docs/src/content/docs/architecture.mdx`.
- **Old tier IDs:** `grep -rE "\\b(starter|team)\\b" packages/pricing-config/src packages/pricing-config/test packages/api/src/lib/stripe-* apps/www/src apps/mobile/app .github/workflows/deploy.yml terraform/examples terraform/modules` — zero hits in active code (JSDoc comments and test fixtures in `packages/api/src/lib/stripe-plans*` are explicitly in scope).
- **Resolve `docs/residual-review-findings/feat-www-services.md`** — work through each open residual and either fix it (the rewrite likely already did) or document why it's intentionally deferred.

**Execution note:** This is a verification unit, not new content. If it finds violations, route them back to the appropriate U3/U5/U7/U8/U9 unit for fix.

**Patterns to follow:**
- Existing residual-review-findings structure
- Existing STYLE.md grep checks if any are documented

**Test scenarios:**
- Happy path: every grep listed above returns the expected count (zero for banned words, ≥1 for canonical phrases, exactly 1 for horse/reins).
- Happy path: residual file closed out.
- Edge case: the AWS-mention count is logged in the audit doc so future PRs can compare.
- Integration: `pnpm --filter @thinkwork/www build && pnpm --filter @thinkwork/docs build` both succeed (catches any dangling reference broken by edits in U3–U9).
- Integration: `pnpm lint && pnpm typecheck && pnpm test` repo-wide passes (catches broken pricing-config types, missing exports, etc.).

**Verification:**
- All grep checks pass.
- residual-review file closed.
- Both Astro sites build cleanly.
- Repo-wide lint/typecheck/test passes.

---

## System-Wide Impact

- **Interaction graph:**
  - `packages/pricing-config` is consumed by `apps/www/src/pages/pricing.astro` (via `apps/www/src/lib/copy.ts`) **and** `apps/mobile/app/onboarding/payment.tsx`. U4 plan rename ripples to both surfaces.
  - `apps/www/src/lib/copy.ts` is consumed by every section component on the homepage. Renaming or removing an exported object would cascade into TS errors at build time; preserve all top-level keys, mutate values only.
  - `docs/src/content/docs/index.mdx` frontmatter `hero.tagline` is read by `docs/src/components/Hero.astro`. Frontmatter shape preserved.
  - `docs/STYLE.md` is the policy doc PR reviewers cite; its grep checks (post-U2) become the U11 audit baseline.
  - GitHub repo description / topics flow into Open Graph cards generated by GitHub when the repo is shared. Updated in U10.
  - npm registry shows the `thinkwork-cli` description from `apps/cli/package.json` (the published one), which is generated from `apps/cli/package.json` at publish time. U9 edit ripples on next `npm publish`.
- **Error propagation:**
  - Stripe price-ID misalignment in U4 surfaces as a runtime error at checkout. The pricing.astro defensive read (test scenario in U4) catches the misalignment before Stripe API call.
  - Component-level breakage from a renamed export in copy.ts surfaces at Astro build time (TS errors). Mitigated by preserving top-level keys.
  - GitHub repo description drift between the codebase (README) and the GitHub UI is silent — there's no checker. U10 verification step is the only gate.
- **State lifecycle risks:**
  - Stripe products + prices are global state; deleting old test/prod products is destructive. Mitigation: archive old products instead of deleting; create new products fresh.
  - GitHub Actions `vars.STRIPE_PRICE_IDS_JSON` is captured at workflow-dispatch time (per `feedback_github_actions_vars_snapshot_at_trigger`); update the var BEFORE the deploy workflow runs after the U4 PR merges, or trigger a fresh dispatch.
- **API surface parity:**
  - The `Plan` type and `PlanId` union in `packages/pricing-config/src/types.ts` are exported. Downstream consumers (mobile, www) import these. U4 union change is a breaking change at the type level — both consumers update in the same PR or feature flag-gated rollout, but pre-launch we just rip-and-replace.
- **Integration coverage:**
  - Stripe Checkout flow (test mode): manual end-to-end click-through after U4 ships. Unit tests can verify pricing-config shape but not Stripe integration.
  - Mobile pricing screen: TestFlight build verification after U4.
  - GitHub README rendering: open PR description preview verifies markdown rendering before merge.
- **Unchanged invariants:**
  - Visual / design surface: palette, typography, layout, BrainMark, OG image artwork — unchanged. Only OG image text overlay potentially regenerated.
  - The five governance controls implementation (FiveControls.astro): structure unchanged. Vocabulary lens added (R.E.S.T.); the controls themselves are not renamed or restructured.
  - Six-concept canonical names (Threads, Agents, Memory, Connectors, Automations, Control): unchanged.
  - Quick-start command list (8 in README, 5 in www QuickStart, 5 in docs index): factual content unchanged; only chrome around it.
  - Compounding Memory feature naming, Wiki feature naming, Managed Agents naming, Skill Packs naming: unchanged.
  - AWS-mention budget at ~3–4 anchors on www homepage: hard inherit from `2026-04-22-004`.
  - GitHub repo URL, npm package name (`thinkwork-cli`), Terraform Registry path (`thinkwork-ai/thinkwork/aws`): all unchanged.

---

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tier rename in U4 ripples through Stripe and breaks the live test-mode Checkout flow | Med | Med | Create new Stripe products + prices in test mode first; verify checkout end-to-end before flipping `STRIPE_PRICE_IDS_JSON` for prod; keep old product archived (not deleted) for 30-day rollback window. |
| `apps/www/src/lib/copy.ts` rewrite renames an export that a component imports, breaking the build | Med | Low | Preserve all top-level export names; mutate values only. Astro TS catches at build. |
| "Journey" leaks back in via mid-file paragraph copy not caught by the U1 retirement table | Low | Low | U11 grep audit; STYLE.md (post-U2) makes "journey" banned, so any future PR reintroducing it gets flagged in code review. |
| Horse/reins metaphor reads as marketing voice and degrades the architecture page | Low | Med | Single sidebar callout only; reviewed against STYLE.md by Eric before U7 ships. If it reads as slop, drop the sidebar — the article is still cited via footnote. |
| `docs/STYLE.md` glossary additions in U2 conflict with existing canonical names | Low | Low | U2 reviews STYLE.md end-to-end before adding; conflicts are reconciled by Eric. |
| `2026-04-22-004` AWS-de-emphasis is undone because R.E.S.T. articulation around "AWS containment" reintroduces "AWS" mentions | Med | Med | U11 audit explicitly counts "AWS" mentions on www homepage; if creep > 6, trim before merging the U3 PR. |
| Mobile app onboarding screen renders broken plan list because `payment.tsx` has a hardcoded ID branch | Low | Med | U4 test scenario explicitly verifies mobile renders; manual TestFlight check before U4 PR merges. |
| GitHub repo description (manual U10) drifts from README + package.json | Med | Low | U10 verification with `gh api` check; documented as a runbook step that ships immediately after U9 merges. |
| The horse/reins, R.E.S.T., PPAF article framing dates faster than the rest of the copy (e.g., the article gets superseded mid-2026) | Low | Low | Cite the article in a footnote, don't name individuals; revisit positioning brief U1 every 6 months as a `docs/solutions/` pattern doc captures the decision. |
| Existing customers break (no live customers exist yet, but flagging for completeness) | Very low | High | Pre-launch, so no migration risk. If launch happens during this rewrite, freeze U4 until launch posture is reassessed. |
| **R.E.S.T. acronym homonym with HTTP REST** confuses buyers Googling the term, fragments SEO, or trains contributors to read past the four anchors | Med | Med | Spell out "Reliability · Efficiency · Security · Traceability" on first use everywhere; use acronym only in secondary surfaces (chip labels, control-card tags). Never lead a section heading with bare "R.E.S.T." Document the homonym in `docs/STYLE.md` so future PRs cannot reintroduce bare-acronym leads. |
| **For Business operational scope undefined.** "Operated by us" markets a tier whose operational org (oncall hours, IAM access model, upgrade cadence, incident SLO) has not been designed | Med | High | U1 pre-flight checklist locks the operational scope of the For Business tier (not deferred). Until the operational org is named, U4b (Stripe product creation) does not ship. Add to System-Wide Impact: any "operated" copy on www / docs / README is reviewed against the locked operational scope, not aspirational. |
| **App Store guideline risk on mobile pricing screen.** Open-tier CTA routing to GitHub from inside `apps/mobile/app/onboarding/payment.tsx` may trigger Apple's external-purchase rejection during review | Med | Med | U4a defines the Open-tier rendering on mobile: either the Open tier is hidden in the mobile pricing screen (shown only on www) and surfaced via a separate "Self-host on GitHub" link in settings, or the Open card uses non-purchase framing with an "Information only" disclaimer. Decision locked in U1 pre-flight; verified before TestFlight build. |
| **Mobile multi-team UI silently activates** for For Business customers via existing `plan === "business"` branch (`apps/mobile/app/(tabs)/team/index.tsx:42`) | Med | Low | Documented in System-Wide Impact; U4a's verification confirms the multi-team UI is the intended For Business behavior on launch (or removes/feature-flags the branch). |
| **Stripe price IDs as deploy.yml literals** invite baked-in values landing in commit history; fallback default with old IDs silently breaks if vars unset | Med | Med | U4b explicitly stores Stripe IDs in `vars.STRIPE_PRICE_IDS_JSON` only; the literal `||` fallback in `deploy.yml` is replaced with `{}` (empty) so missing vars surface as a clear error rather than routing to retired tiers. |
| **`tenants.plan` schema default is `"pro"`** (not in new PlanId union), and Stripe lifecycle code writes `"free"` / `"unknown"`. Mobile already branches on these strings | Med | Med | U4a explicitly does NOT touch the schema default; the gap is documented in System-Wide Impact and reconciliation lands in plan `2026-04-24-003` (pre-launch DB schema cleanup). Until then, fresh tenants render the wrong tier in mobile — known and accepted. |
| **Positioning instability:** this is the 9th positioning/messaging plan in 5 days. No stopping condition prevents a 10th rewrite next week | Med | Med | Operational Notes specify a stability gate: no further master-positioning rewrite for 30 days unless triggered by external signal (customer interview pattern, lost deal post-mortem, public competitive change). Component-level copy polish remains in scope; master positioning is committed. |
| **App Store review** of the next mobile build with the new pricing screen | Med | Low | Defer first TestFlight pricing-screen submission until after U4a + Open-tier rendering decision lands. Document in U4a verification. |
| **Source-fragility:** master positioning sourced from one supplied article. If "Agent Harness" fails to take hold as a buyer category, every surface needs another rewrite | Low | Med | Cite the article in a docs footnote (anchor); revisit positioning brief in 6 months. If no buyer signal validates the category by then, ship a hedge surface (lead with what buyers type — "AI agent platform" — and use "Agent Harness" as distinctive descriptor). |

---

## Documentation / Operational Notes

- **Execution mechanics — worktree + dev servers (R15).** Before any unit executes:
  1. Create worktree off `origin/main`: `git worktree add .claude/worktrees/agent-harness-for-business -b feat/agent-harness-for-business origin/main`. Per `feedback_worktree_isolation`, never branch/stash in main checkout.
  2. Bootstrap the worktree: `cd .claude/worktrees/agent-harness-for-business && pnpm install`. Per `feedback_worktree_tsbuildinfo_bootstrap`, run `find . -name tsconfig.tsbuildinfo -not -path '*/node_modules/*' -delete && pnpm --filter @thinkwork/database-pg build` BEFORE any typecheck.
  3. Start dev servers from the worktree: `pnpm --filter @thinkwork/www dev` (Astro marketing site, default port 4321) and `pnpm --filter @thinkwork/docs dev` (Starlight docs, separate Astro port). Both are Astro static sites — no Cognito callback concern.
  4. Cognito callback URL update (`project_admin_worktree_cognito_callbacks`) only applies if `pnpm --filter @thinkwork/admin dev` runs concurrently in the worktree alongside the main checkout's admin. This plan does not require running admin in both — admin is operator-facing and out of scope for the messaging rewrite. Skip the Cognito callback step.
  5. After this plan's PR(s) merge, remove the worktree and delete the branch per `feedback_cleanup_worktrees_when_done`: `git worktree remove .claude/worktrees/agent-harness-for-business && git branch -D feat/agent-harness-for-business`.
- After this plan ships, capture the master-positioning decision as a new entry under `docs/solutions/positioning/` (or whatever naming convention emerges). Closes the gap noted by Phase 1 learnings research (zero solutions doc covers marketing positioning today).
- **GitHub repo metadata update** (folded from U10): after U9 merges, in the GitHub web UI: (a) update About description to "Agent Harness for Business — open and operated. Self-host the harness or run it with us, on the AWS account you own."; (b) add topics `agent-harness`, `agent-platform`, `aws-bedrock`, `agentcore` (preserve existing); (c) verify Website is `https://www.thinkwork.ai`; (d) update Social preview image if it carries the old tagline. Verification: `gh api repos/thinkwork-ai/thinkwork --jq '.description, .topics'`.
- **npm publish posture** (from U9): trigger a fresh `npm publish` of `thinkwork-cli` after U9 merges so the npm registry picks up the new `package.json description`. Confirm the publish uses an automation token scoped to `thinkwork-cli` only (not a full-account token); the token is stored in GitHub Actions secrets (not in any `.npmrc` checked into the repo); the npm account has 2FA enforcement enabled for publish operations. Document who performs the publish (Eric).
- Per `feedback_github_actions_vars_snapshot_at_trigger`: update `vars.STRIPE_PRICE_IDS_JSON` BEFORE merging the U4b PR (or right after, then trigger a fresh deploy dispatch).
- Per `feedback_avoid_fire_and_forget_lambda_invokes`: U4 changes Stripe Checkout invocation; no Lambda invokes added in this plan, so no exposure.
- After all units land, run a marketing-surface smoke test: visit thinkwork.ai homepage, /services, /pricing, docs.thinkwork.ai, the GitHub repo, the npm page; verify each surface lands the same three-tier ladder, the same tagline, the same R.E.S.T. lens. Visual coherence is the user-facing test.
- **Stability gate (locked):** after this plan ships, no further master-positioning rewrite for 30 days unless triggered by external signal — customer-interview pattern, lost-deal post-mortem, public competitive change, or a documented buyer-research finding. Component-level copy polish remains in scope; master positioning (category name, tier names, R.E.S.T./PPAF/horse-reins vocabulary) is committed.

---

## Sources & References

- **Master input:** *The Definitive Guide to Harness Engineering* (article supplied 2026-04-24 by Eric in the planning prompt).
- **Prior plans inherited or superseded:**
  - `docs/plans/2026-04-20-001-feat-www-governance-positioning-refresh-plan.md`
  - `docs/plans/2026-04-21-008-docs-full-rewrite-thinkwork-docs-site-plan.md`
  - `docs/plans/2026-04-21-009-docs-www-journey-messaging-rewrite-plan.md` (journey framing **superseded**)
  - `docs/plans/2026-04-22-002-docs-www-homepage-copy-polish-plan.md`
  - `docs/plans/2026-04-22-004-refactor-www-reduce-aws-repetition-plan.md` (AWS budget **hard-inherited**)
  - `docs/plans/2026-04-22-008-feat-stripe-pricing-and-post-checkout-onboarding-plan.md` (Stripe infra inherited; tier IDs replaced in U4)
  - `docs/plans/2026-04-23-001-refactor-docs-site-visual-coherence-with-www-plan.md` (visual layer **hard-inherited**)
- **Voice authority:** `docs/STYLE.md`, `docs/STYLE-AUDIT.md`.
- **Open residuals to close:** `docs/residual-review-findings/feat-www-services.md`.
- **Memory: ThinkWork supersedes maniflow** — internal name discipline; don't reintroduce "maniflow" anywhere.
- **Memory: AWS-native over SaaS** — preserved in tier articulation; "for Business" tier still runs in customer's own AWS, just operated by us.
