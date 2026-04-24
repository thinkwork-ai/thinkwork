---
title: "refactor(www): Split Cloud hosting from Services implementation in site IA"
type: refactor
status: active
date: 2026-04-24
---

# refactor(www): Split Cloud hosting from Services implementation in site IA

## Overview

The marketing site blurs two distinct buying motions under labels that read as one thing: hosted/managed subscription plans and human implementation services. "Pricing" frames the subscription page as generic pricing, and the services page's "Service packages / Additional packages" split creates menu sprawl that reads as a pricing table.

This plan renames `/pricing` → `/cloud` (with reframed copy positioning it as ThinkWork Cloud), keeps `/pricing` resolving via a redirect, consolidates the services page into a single list of ~4-5 cards including a new "Cloud Hosting" handoff card, and removes the "Additional packages" section. Visual style is preserved — this is IA, content, and layout cleanup, not a redesign.

---

## Problem Frame

Two observable IA failures on the public site:

1. **Cloud hosting looks like generic pricing.** `/pricing` reads "Infrastructure you own. Plans that scale with usage." A visitor can't tell if the page is about SaaS subscriptions, hosted infra, open-source pricing, or an AWS bill. It can't describe itself as *the* hosted ThinkWork offering because it's named for a pricing construct, not a product.
2. **Services has too many packaging systems stacked on top of each other.** The current page cycles a visitor through: "Common starting points" → four-phase lifecycle → "Featured packages" (4 cards) → "Secondary packages" (2 cards, rendered as "Additional packages" in the brief's language) → FAQ that re-explains packages. The Featured/Secondary variant split is the worst offender — it feels like a pricing table bolted into a services page.

The two surfaces also don't currently hand off to each other. `apps/www/src/lib/copy.ts:408-409` explicitly instructs "Do NOT cross-link to /pricing from here" — that guidance made sense when the pricing page was an ambiguous subscription table, but is the wrong call once the page becomes "ThinkWork Cloud" as a concrete hosted product.

---

## Requirements Trace

- R1. Nav shows "Cloud" instead of "Pricing", pointing to `/cloud`.
- R2. `/cloud` serves the current pricing page (plan cards + checkout), reframed with Cloud-product copy and a cross-link to `/services`.
- R3. `/pricing` continues to resolve — links from emails, docs, Stripe cancel redirects, and search results don't 404.
- R4. Services page packaging is collapsed into exactly one section of ~4-5 horizontal cards, with no Featured/Secondary split, no "Additional packages", and a new "Cloud Hosting" card that deep-links to `/cloud`.
- R5. "Additional packages" / secondary variant is fully removed — not hidden, not renamed.
- R6. Services hero/lede and FAQ reflect the single-list framing; repeated "arc" language and per-card over-explanation is trimmed.
- R7. Cross-linking is bidirectional but asymmetric in tone: `/cloud` offers a soft "need help launching? See Services" pointer; `/services` includes Cloud Hosting as a first-class card with CTA to `/cloud`. Services prose does not become pricing prose; Cloud prose does not become consulting prose.
- R8. Services copy posture — "We help teams scope, launch, operate, and expand governed AI workflows." Cloud copy posture — "Use ThinkWork as a managed cloud deployment with clear plan tiers."
- R9. Current visual style (dark theme, brand gradient, `SectionShell` rhythm) is preserved.

---

## Scope Boundaries

- No redesign — colors, typography, `SectionShell` tone/glow usage, and card visual system stay.
- No Stripe checkout logic changes. The price catalog (`packages/pricing-config`), plan tiers, and checkout session handler stay byte-for-byte.
- No billing / in-product pricing surface changes (admin SPA upgrade flow, mobile `/onboarding/payment`).
- No analytics-metadata renames inside `packages/api/src/handlers/stripe-checkout.ts` — the `"www-pricing"` telemetry string stays for continuity (see Key Technical Decisions).
- No docs-site ( `docs/` / Starlight ) changes. Docs nav is separate from the marketing nav.
- No CloudFront distribution behaviors or Function changes. Redirect is handled inside the Astro build.
- No SEO sitemap/canonical work beyond what the Astro `redirects:` config gives us for free. If SEO regression shows up post-deploy, handle it as a follow-up.

### Deferred to Follow-Up Work

- **Proper 301 redirect via CloudFront**: If SEO/analytics signals show the meta-refresh redirect is losing referral attribution, upgrade to a CloudFront Function (or S3 website-redirect rule via Terraform). Out of scope here. **Review caveat (2026-04-24):** document-review flagged that the rename moment is the strongest argument for shipping the 301 up front rather than after signal degradation — `/pricing` is likely the highest commercial-intent page after the homepage, and meta-refresh passes link equity less reliably than 301. Reconsider whether to promote this into U4 before shipping.
- **Services page design pass**: Horizontal-card layout may reveal visual issues with the lifecycle section or proof band. Address in a dedicated design pass if needed.
- **Telemetry metadata rename** (`source: "www-pricing"` → `"www-cloud"`): Defer until after the IA rename lands so analytics continuity during the transition stays clean. Can be flipped in one line later. **Review caveat (2026-04-24):** dual-emit during a transition window (e.g., emit `source: "www-cloud"` and `legacy_source: "www-pricing"` on new sessions) would let the rename happen now without losing historical filter compatibility. Worth considering if analytics continuity matters more than the current "cheap to flip later" framing admits.

---

## Context & Research

### Relevant Code and Patterns

- `apps/www/src/pages/pricing.astro` — current pricing page; hero → `PricingGrid` → `FinalCTA` + inline Stripe checkout script. Becomes the starting content for `/cloud`.
- `apps/www/src/pages/services.astro` — services page; hero → proof band → positioning → lifecycle → featured packages → secondary packages → FAQ → closing CTA. Lines ~159-211 are the consolidation target.
- `apps/www/src/components/ServiceCard.astro` — reusable service card; has `variant: "featured" | "secondary"` prop (line 16) with visually distinct treatments. Consolidation drops the discriminator.
- `apps/www/src/components/PricingCard.astro`, `PricingGrid.astro` — reused as-is on `/cloud`; names stay (they describe the data shape, not the page).
- `apps/www/src/components/Header.astro` — renders `nav` from `copy.ts`; desktop (`lines 13-32`) and mobile (`lines 42-57`) duplicated, both driven by the same `nav` array so a single edit propagates.
- `apps/www/src/lib/copy.ts` — centralized copy file (698 lines). `nav` at line 24, `pricing` export at line 384, `servicePackages` + `services` at lines 417+. All user-facing copy edits happen here, not in `.astro` files.
- `apps/www/src/pages/m/checkout-complete.astro:79` — fallback "Return to pricing" link; update to `/cloud`.
- `apps/www/astro.config.mjs` — Astro 5.5 config; currently no `redirects` block. Add one for `/pricing` → `/cloud`.
- `terraform/modules/app/lambda-api/handlers.tf:83` — `STRIPE_CHECKOUT_CANCEL_URL = "${var.www_url}/pricing"`. Update to `/cloud` to avoid a redirect hop on canceled checkouts.
- `packages/api/src/handlers/stripe-checkout.ts:8,118,140` — comments mention `/pricing` and telemetry string is `"www-pricing"`. Comments can be refreshed; telemetry string stays (see Key Technical Decisions).
- `scripts/build-www.sh` — S3 sync + CloudFront invalidate. No changes needed; static redirect HTML is served the same as any other page.

### Institutional Learnings

- No `docs/solutions/` entries specific to the marketing site. Prior www plans (`docs/plans/2026-04-20-001-feat-www-governance-positioning-refresh-plan.md`, `2026-04-22-008-feat-stripe-pricing-and-post-checkout-onboarding-plan.md`) are the closest precedent — mirror their copy tone and structural conventions.
- `docs/STYLE.md` is the closest thing to a tone guide; skim before rewording `/cloud` hero and services CTA copy.

### External References

- Astro 5.x `redirects` config — static builds emit HTML with `<meta http-equiv="refresh">` + `<link rel="canonical">`. Sufficient for user-facing continuity on S3/CloudFront; acceptable SEO posture for a single rename. Upgrade path is a CloudFront Function if needed later.

---

## Key Technical Decisions

- **`/cloud` is created as a new file, not a rename of `pricing.astro`.** Astro's `redirects` config requires the source route (`/pricing`) to not have a conflicting file. Creating `apps/www/src/pages/cloud.astro` fresh and then deleting `pricing.astro` keeps the diff reviewable and avoids a stale-file state during the transition commit.
- **Redirect mechanism: Astro `redirects:` config, not a hand-rolled meta-refresh page.** Astro 5.x emits the redirect HTML automatically, keeps it in-repo, and doesn't require Terraform/CloudFront coordination. The meta-refresh is SEO-acceptable for a single rename; if signals show attribution loss, upgrade to CloudFront Function as a follow-up.
- **Terraform `STRIPE_CHECKOUT_CANCEL_URL` updates to `/cloud` directly.** We own the value; no reason to make canceled checkouts bounce through the redirect. One-line change, same PR.
- **Stripe checkout telemetry string stays `"www-pricing"`.** It's a metadata value on historical Stripe sessions and Checkout events. Flipping to `"www-cloud"` creates a discontinuity in analytics queries and Stripe dashboard filters. Cheap to flip later (`packages/api/src/handlers/stripe-checkout.ts:140`) once the rename has shipped and analytics downstream is updated.
- **Cross-link direction is asymmetric on purpose.** `/cloud` → `/services` is a soft "if you also need help" pointer near plan cards. `/services` → `/cloud` is a first-class card in the services list. This matches the two buying motions: Cloud visitors mostly self-serve and only sometimes need services; Services visitors often need hosted runtime as part of the package. This explicitly overrides the prior `copy.ts:408-409` "Do NOT cross-link to /pricing" guidance — that guidance existed because the pricing page was ambiguously scoped; renaming it to Cloud makes it a real product surface worth handing off to.
- **`ServiceCard.astro` drops the `variant` prop entirely.** Consolidation means one visual treatment for all cards. Deleting the prop (vs. keeping both paths) prevents future drift. Horizontal layout is achieved by switching the enclosing section from a 2-3 column grid to a flex or 1-2 column wide-card layout; card internals can stay close to the current featured variant's shape.
- **Services package count targets 4 cards, not 5.** The brief allows 4-5. Four reads cleaner and matches the mental model: Strategy Sprint / Pilot Launch / Managed Operations / Workflow Expansion + **Cloud Hosting as the fifth** = 5 total once Cloud Hosting joins the list. So "4 services + 1 Cloud Hosting handoff" = 5 cards on the page, which is the brief's upper bound. This keeps "Governance & Eval" and "Advisory" (current secondary variants) out of the primary list; their substance can be folded into the four remaining cards' includes or dropped.

---

## Open Questions

### Resolved During Planning

- **Where does the redirect live?** Astro `redirects:` config in `astro.config.mjs`. Minimal, in-repo, works on S3.
- **Does the Stripe checkout flow need changes?** No to the handler, yes to the Terraform env var. The telemetry string stays. Success URL is unaffected.
- **Does consolidation keep the `variant` prop for future use?** No — delete it. See Key Technical Decisions.
- **Does `/cloud` keep the `PricingCard` / `PricingGrid` component names?** Yes. They describe data shape, not page identity; renaming them ripples into `@thinkwork/pricing-config` and is out of scope.

### Deferred to Implementation

- **Exact services copy for the Cloud Hosting card and the Cloud page's Services cross-link.** Directional copy is in the brief; final wording happens at edit time and should stay consistent with `docs/STYLE.md` and the Cloud framing ("managed cloud deployment with clear plan tiers") vs. Services framing ("help teams scope, launch, operate, and expand").
- **Whether to retain the services lifecycle section or trim to a single headline strip.** Evaluate after the packaging consolidation — if the lifecycle still adds something the packages don't, keep it; if it's now redundant, drop it. The brief says "simplified lifecycle section, if still useful" — judgment call at edit time.
- **Whether Governance and Advisory content survives as card includes or is dropped entirely.** Read the current card bodies — some of what's there may belong inside Managed Operations or Workflow Expansion; some may not survive the cut. Decide per-bullet, not wholesale.

### Open architectural questions from document review (2026-04-24)

These surfaced in multi-persona review after the plan was drafted. They are real judgment calls, not mechanical gaps, and should be resolved before U5 lands:

- **Cloud Hosting: peer card in the services list, or separate handoff block?** Three personas (product-lens, design-lens, adversarial) flagged that placing Cloud Hosting as a peer card reinstalls the exact hosted-vs-services conflation the plan is trying to remove. `ServiceCard`'s header comment (`apps/www/src/components/ServiceCard.astro:1-4`) also states "Cards are informational — intake is handled by the shared hero + closing CTAs on the page, not per-card buttons"; a Cloud Hosting card with its own CTA breaks that invariant. **Alternative to evaluate:** place a distinct handoff callout block (not styled as a `ServiceCard`) above or below the service-card grid, mirroring the soft cross-link going the other way on `/cloud`. Cascades into F-7 (card visual treatment) and F-11 (5-card mix coherence) — resolving this one settles those.
- **"Cloud" label not compared to alternatives in the plan.** Label ambiguity is exactly the failure the plan diagnoses; "Cloud" may re-create it because ThinkWork deploys into the customer's own AWS (fine print: "Every plan deploys into your AWS account; we never operate shared infrastructure"), so a page called "Cloud" needs a disambiguation paragraph to not read as a cloud-provider offering. Alternatives worth naming or rejecting explicitly: "Hosted", "Hosted plans", "Plans", or reframed-in-place "Pricing". The brief commits to "Cloud" — if that's final, add one sentence in Key Technical Decisions explaining why, so future readers see the reasoning.
- **Dropping Governance as a named service card conflicts with recent governance-positioning work.** The 2026-04-20 `feat-www-governance-positioning-refresh` plan made Governance a first-class positioning pillar. Folding it into other cards' `includes` is a strategic demotion. Decide explicitly: (a) Governance survives as a named card (target becomes 5 services + Cloud Hosting = 6), (b) Governance content gets absorbed with an acknowledgement line, or (c) Governance gets its own section outside the services grid.
- **Advisory's role for enterprise buyers.** The scale target is 4 enterprises × 100+ agents; enterprise buyers typically need an outreach/advisory vector. Keep Advisory as a card, fold into Managed Operations, or surface as a distinct enterprise-contact block? Not obvious.
- **Asymmetric cross-linking premise is asserted, not evidenced.** The audience model ("Cloud visitors mostly self-serve; Services visitors often need hosted runtime") is not anchored to analytics, referral data, or sales feedback. Post-launch validation plan: track click-through from `/cloud → /services` and `/services → /cloud` for one analytics cycle and revisit the asymmetry.

---

## Implementation Units

- U1. **Add `/cloud` route as a copy of current pricing page**

**Goal:** Stand up `/cloud` serving the existing pricing page content so `/pricing` and `/cloud` resolve identically for one commit. This unblocks the nav switch and copy reframe without a broken intermediate state.

**Requirements:** R2

**Dependencies:** None

**Files:**
- Create: `apps/www/src/pages/cloud.astro` (copy of `apps/www/src/pages/pricing.astro` verbatim at this step)

**Approach:**
- Byte-for-byte copy of `pricing.astro` into `cloud.astro`. No copy changes yet — those happen in U2.
- Verify the inline Stripe checkout script and `PUBLIC_API_URL` injection work identically on the new route (same `<script>` block, same env handling at build time).
- Both `/pricing` and `/cloud` render in dev. This is intentional overlap for review.

**Patterns to follow:**
- `apps/www/src/pages/pricing.astro` — structure, imports, script injection.

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/www dev` — `http://localhost:<port>/cloud` renders the same content as `/pricing`, including hero, plan cards, and the "Adopt AI. Keep control." final CTA.
- Happy path: `pnpm --filter @thinkwork/www build` succeeds; `dist/cloud/index.html` exists.
- Edge case: clicking a plan card's CTA on `/cloud` invokes the same Stripe checkout flow (dev-mode API may be stubbed; confirm the POST payload is identical to `/pricing`).

**Verification:**
- Both `/pricing` and `/cloud` render successfully in dev and in the static build.
- No new console errors compared to pre-change `/pricing`.

---

- U2. **Rename nav label Pricing → Cloud**

**Goal:** Flip the visible nav item and its destination to the new route.

**Requirements:** R1

**Dependencies:** U1

**Files:**
- Modify: `apps/www/src/lib/copy.ts` (line 24-28, the `nav` export)

**Approach:**
- In the `nav` array at `apps/www/src/lib/copy.ts:24-28`, replace `{ label: "Pricing", href: "/pricing" }` with `{ label: "Cloud", href: "/cloud" }`.
- No other edits in this unit — header ordering (Platform / Services / Cloud) emerges from the array order, which already matches.
- Desktop and mobile nav both read from this single array (`Header.astro:13-32` and `:42-57`), so one edit covers both.

**Patterns to follow:**
- `apps/www/src/components/Header.astro` — confirms the nav array is the single source for both renderings.

**Test scenarios:**
- Happy path: dev server shows "Cloud" in the desktop nav, pointing to `/cloud`.
- Happy path: mobile menu (resize <768px or inspect `#mobile-menu`) shows "Cloud", pointing to `/cloud`.
- Integration: clicking the nav "Cloud" link from `/` navigates to `/cloud` and renders the page.

**Verification:**
- Nav label reads "Cloud" on every page (header is shared via `Base.astro` layout).
- No stale "Pricing" string remains in the rendered nav.

---

- U3. **Reframe `/cloud` page copy to ThinkWork Cloud positioning**

**Goal:** Make the page read as a product (ThinkWork Cloud) rather than a generic pricing table. Add the Services cross-link and clarifying notes about AWS usage and self-hosted availability.

**Requirements:** R2, R7, R8

**Dependencies:** U1

**Files:**
- Modify: `apps/www/src/lib/copy.ts` (the `pricing` export starting at line 384 — reframe hero, meta, fine print; consider renaming the export to `cloud` for clarity or aliasing)
- Modify: `apps/www/src/pages/cloud.astro` (consume the reframed copy; add the near-plan-cards "Need help launching? See Services" cross-link)

**Approach:**
- Hero shifts from "Pricing / Infrastructure you own. Plans that scale with usage." to "ThinkWork Cloud / Hosted agent infrastructure, deployed inside your AWS boundary." (directional — final copy at edit time per the brief).
- Add a short clarifying block near the top of the page, either as a `SectionHeader` sub-note or under the plan cards: "This page covers hosted ThinkWork plans. Services (strategy, launch, operations, advisory) are separate — see Services. AWS usage is billed separately. Self-hosted remains available through the open source docs."
- Add a soft cross-link block as a new section in `cloud.astro` rendered **between `PricingGrid` and `FinalCTA`** (do not modify `PricingGrid` or `PricingCard` — the cross-link lives in page markup, not the shared component). Use a `SectionShell` with `tone="default"` and prose + inline link: "Need help launching workflows, governance, or rollout? See Services." CTA is an inline text link to `/services`, not a large button — this preserves the "soft pointer" posture vs. the first-class Cloud Hosting card on `/services`.
- Rename `export const pricing = { ... }` in `copy.ts` to `export const cloud = { ... }` (or keep the export name and just change the contents — decide at edit time to minimize diff churn). Update `meta.title` from "ThinkWork pricing —" to "ThinkWork Cloud —".
- Ensure Cloud copy posture does not cross into consulting language ("we help you…"). Cloud is about plans; Services is about help.
- **Preserve Stripe CTA DOM integrity (F10):** The inline script at the bottom of `pricing.astro` queries `[data-plan-cta]` and `[data-plan-error]` by data attribute — those attributes live inside `PricingCard`. When adding the new cross-link section and the clarifying disclaimer block, keep them outside `PricingGrid` so the script's selectors continue to match unchanged DOM. Verify in dev that clicking a plan card still surfaces the loading state ("Starting checkout…") and the error state inline.

**Patterns to follow:**
- `apps/www/src/lib/copy.ts` `services.hero` structure for `eyebrow` / `headlinePart1` / `headlineAccent` / `lede` shape.
- `apps/www/src/components/SectionShell.astro` + `SectionHeader.astro` for any new sub-section.

**Test scenarios:**
- Happy path: `/cloud` hero reads "ThinkWork Cloud" as the eyebrow or headline, with the Cloud-product framing.
- Happy path: A visible link from `/cloud` routes to `/services`.
- Happy path: Page meta `<title>` contains "ThinkWork Cloud", not "Pricing".
- Edge case: The clarifying disclaimer mentions AWS-billed-separately and self-hosted availability.
- Test expectation note: No automated test harness on www; verification is visual + `pnpm --filter @thinkwork/www build` clean.

**Verification:**
- A reader landing cold on `/cloud` can tell within 3 seconds that this is hosted ThinkWork plans, not services and not "pricing in the abstract".
- No residual "generic pricing" framing in hero or fine print.

---

- U4. **Retire `/pricing` route with a redirect to `/cloud`**

**Goal:** Stop serving the `/pricing` page directly; redirect it to `/cloud`. Ensure all known internal links and server config point at `/cloud` so the redirect exists only for external inbound traffic.

**Requirements:** R3

**Dependencies:** U1, U3

**Files:**
- Modify: `apps/www/astro.config.mjs` — add `redirects: { "/pricing": "/cloud" }` to the exported config.
- Delete: `apps/www/src/pages/pricing.astro`
- Modify: `apps/www/src/pages/m/checkout-complete.astro` (line 79 — update the fallback link from `/pricing` to `/cloud`)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (line 83 — update `STRIPE_CHECKOUT_CANCEL_URL` from `${var.www_url}/pricing` to `${var.www_url}/cloud`)
- Modify: `apps/www/src/env.d.ts` (line 7 — update the "Read by /pages/pricing.astro" comment to reference `cloud.astro`)
- Modify: `packages/pricing-config/src/plans.ts` (line 5 — update the consumer comment listing `apps/www/src/pages/pricing.astro` to `apps/www/src/pages/cloud.astro`)
- Modify: `apps/admin/src/routes/onboarding/welcome.tsx` (line 81 — update the hardcoded `https://thinkwork.ai/pricing` link to `/cloud`)
- Modify: `apps/mobile/lib/stripe-checkout.ts` (line 67 — update `cancelUrl = "https://thinkwork.ai/pricing"` to `/cloud`; see caveat in Approach about mobile release propagation)

**Approach:**
- Astro's `redirects` config emits a `pricing/index.html` with a meta-refresh + canonical link pointing to `/cloud`. This works on S3/CloudFront without any distribution-level change.
- Delete `pricing.astro` in the same commit as the redirect config — Astro errors if both exist.
- Terraform change updates the Stripe cancel URL so canceled checkouts land on `/cloud` directly rather than bouncing through the redirect. This is a terraform-apply event; the redirect keeps old Stripe sessions that cancel to `${var.www_url}/pricing` working during the rollout window.
- Leave the `"www-pricing"` telemetry string in `packages/api/src/handlers/stripe-checkout.ts:140` unchanged (see Key Technical Decisions).
- **Mobile release caveat (F2):** `apps/mobile/lib/stripe-checkout.ts:67` hardcodes the cancel URL in-app, so updating the constant only affects builds shipped after the change. Older installed builds will cancel to `/pricing` and hit the redirect permanently until they update. This is tolerable — the redirect handles them — but document it so the release-notes story is clear.
- **Admin link copy (F2):** `apps/admin/src/routes/onboarding/welcome.tsx:81` has anchor text "Return to pricing". After the route update, refresh the copy to "Return to plans" or "Return to Cloud" so the user-visible label matches the destination.

**Patterns to follow:**
- Astro `defineConfig` object shape in `apps/www/astro.config.mjs` — add `redirects` as a top-level key alongside `integrations`.
- Terraform `common_env` map pattern in `terraform/modules/app/lambda-api/handlers.tf`.

**Test scenarios:**
- Happy path: `curl -I http://localhost:<port>/pricing` (or inspect `dist/pricing/index.html` after build) shows meta-refresh or HTTP redirect to `/cloud`.
- Happy path: `dist/pricing/index.html` exists after `pnpm --filter @thinkwork/www build`.
- Happy path: The mobile checkout fallback link at `m/checkout-complete.astro` now points to `/cloud`; manual render of that page in dev confirms the anchor href.
- Happy path: `terraform plan` in the affected module shows the single env-var change and no unrelated diff.
- Edge case: Build succeeds with `pricing.astro` deleted (no broken imports elsewhere).
- Integration: With `pricing.astro` deleted, `/pricing` still resolves in the built site (via the redirect) — no 404.
- Test expectation note: No automated test harness; verify via `pnpm build` inspection of `dist/` and a `terraform plan` diff.

**Verification:**
- Visiting `/pricing` on any surface (dev, built output, deployed) lands the user on `/cloud`.
- No dev-server or build errors.
- Stripe cancel URL in the deployed stack points to `/cloud`.

---

- U5. **Consolidate services page packaging into one section with `/cloud` handoff**

**Goal:** Replace the Featured/Secondary split and "Additional packages" with one horizontal list of ~5 cards (4 services + 1 Cloud Hosting handoff). Drop the `variant` discriminator. Services copy posture stays services, not pricing.

**Requirements:** R4, R5, R7, R9

**Dependencies:** U3 (so `/cloud` exists as the link target)

**Files:**
- Modify: `apps/www/src/pages/services.astro` (remove the secondary packages section around lines 186-211; restructure the featured packages section around lines 159-183 into one consolidated list; add the Cloud Hosting card to the list)
- Modify: `apps/www/src/components/ServiceCard.astro` (remove the `variant` prop from the `Props` interface and the conditional class logic — single visual treatment)
- Modify: `apps/www/src/lib/copy.ts` — in the `services` export (line 430+) and `servicePackages` data, remove the `variant: "secondary"` entries (Governance & Eval, Advisory — evaluate whether their content folds into the surviving four cards' `includes` arrays), add a `Cloud Hosting` package entry whose card renders with a CTA linking to `/cloud`.
- Modify: `apps/www/src/lib/copy.ts` — remove the stale "Do NOT cross-link to /pricing from here" comment at lines 408-409, replacing or deleting it (the new decision is documented in this plan; the stale comment would mislead future readers).

**Approach:**
- Target card list: Strategy Sprint, Pilot Launch, Managed Operations, Workflow Expansion, Cloud Hosting (= 5 cards).
- Horizontal layout: commit to a single responsive grid — `grid gap-6 md:grid-cols-2 lg:grid-cols-3` — with cards wider than they are tall (short body + tighter `outcome`/`bestFor`). The current `md:grid-cols-2 xl:grid-cols-4` in `services.astro:168` is the source to replace. Also audit `ServiceCard.astro:115,124` — the hardcoded `min-h-[72px]` and `min-h-[60px]` were tuned for narrow 4-column featured cards; relax or remove them so wide cards don't keep unnecessary vertical padding. Keep the current card internals (type badge, timeline, oneLiner, body, includes, outcome, bestFor) but trim `outcome` + `bestFor` wording per the brief's "stop over-explaining" note.
- `ServiceCard` becomes one visual style; the current "featured" treatment (gradient border, larger type) is closer to what the consolidated list should look like, so use it as the base and remove the conditional `isFeatured` branches.
- Cloud Hosting card needs a CTA — either a dedicated prop on `ServicePackage` (`ctaHref?: string`) that renders a visible "View plans →" link, or a typed variant within the card body. Favor the prop approach: it's one field that other cards leave undefined.
- The `ServicePackage` type shift: remove `variant`; optionally add `ctaHref?: string`. Update all consumers.
- Cloud Hosting card copy posture: describes that ThinkWork can operate the deployment as a managed cloud plan, with the CTA handing off to `/cloud`. Keep the type badge and timeline consistent with sibling cards (`type: "Ongoing operations"`, timeline like "Per plan" or a month-based figure).
- Do not rename the `services` export or reshape unrelated sections in this unit (hero, proof band, positioning, lifecycle, FAQ, closing CTA stay — content trim happens in U6).
- Preserve `id="packages"` on the consolidated section's `SectionShell`. The hero's `secondaryCta.href = "#packages"` (`copy.ts:449`) scrolls to it; a rename here silently breaks that anchor.

**Patterns to follow:**
- Current featured `ServiceCard` visual system at `apps/www/src/components/ServiceCard.astro:32-128`.
- Existing `servicePackages` data shape in `apps/www/src/lib/copy.ts` around line 430.

**Test scenarios:**
- Happy path: `/services` renders exactly one packaging section containing 5 cards in the order Strategy Sprint, Pilot Launch, Managed Operations, Workflow Expansion, Cloud Hosting.
- Happy path: The Cloud Hosting card has a visible CTA that navigates to `/cloud`.
- Happy path: No "Additional packages" / "Secondary packages" heading appears anywhere on the page (scan the DOM).
- Happy path: Every card uses the same visual treatment — no featured-vs-secondary differentiation.
- Edge case: Removing the `variant` prop does not break `ServicePackage` consumers — `tsc`/Astro build succeeds.
- Edge case: Horizontal card layout degrades cleanly at mobile widths (single column or two column, not clipped).
- Integration: `pnpm --filter @thinkwork/www build` succeeds; `dist/services/index.html` contains the 5 card headings and no secondary-section heading.
- Test expectation note: Manual visual check — Astro has no unit harness here.

**Verification:**
- Visually: one card list, 5 cards, one visual style, Cloud Hosting CTA handoff visible.
- DOM check: no secondary-packages heading remains.
- Build green.

---

- U6. **Services copy cleanup — remove "arc" repetition, trim over-explanation, re-evaluate lifecycle section**

**Goal:** Finish the content polish the brief calls for so services prose reads as clean single-purpose positioning, not as a nest of overlapping packaging frameworks.

**Requirements:** R6, R8, R9

**Dependencies:** U5

**Files:**
- Modify: `apps/www/src/lib/copy.ts` — `services` export copy (hero lede, positioning section, lifecycle section copy, FAQ, closing CTA).
- Modify (conditional): `apps/www/src/pages/services.astro` — if the lifecycle section is trimmed or removed, update the template to match.

**Approach:**
- Scan the `services` export for repeated "arc", "adoption arc", "engagement arc", "four phases" language. Keep at most one mention that does real work (most likely in the hero or positioning section); delete the rest.
- Trim per-card over-explanation in the `outcome` and `bestFor` fields — the brief calls this out specifically. Shorter, less redundant. Each field should carry one distinct point, not restate the card body.
- Evaluate the lifecycle section (`services.astro:131-157`): with the consolidated package list, does it still add value, or does it narrate the same thing the cards already say? Decision at edit time — either keep as a concise strip, simplify to a one-liner, or drop entirely. The brief says "simplified lifecycle section, if still useful."
- Review FAQ (`services.astro:214-234`): any Q/A that re-explains packages should collapse or reword. Keep Q/As that answer real inbound questions (deployment modes, what's included, how scoping works).
- Services hero and closing CTA should carry the brief's posture: "We help teams scope, launch, operate, and expand governed AI workflows." Not pricing language.

**Patterns to follow:**
- Existing `services.hero` / `services.closingCta` shape in `apps/www/src/lib/copy.ts`.

**Test scenarios:**
- Happy path: "Arc" or "adoption arc" appears at most once on the rendered `/services` page (grep the built HTML or dev view).
- Happy path: Services hero lede matches the brief's posture ("help teams scope, launch, operate, and expand").
- Happy path: FAQ no longer contains a Q/A that simply re-describes what a package includes.
- Edge case: If the lifecycle section is kept, it is visibly shorter or more concise than before. If dropped, `/services` still has a clear narrative arc (hero → positioning → packages → FAQ → CTA).
- Test expectation note: Manual review against the brief's "keep / remove" list.

**Verification:**
- Page reads cleanly top-to-bottom as services positioning, not as a pricing table.
- Copy posture passes the brief's explicit rule: "Do not let Services sound like pricing, and do not let Cloud sound like consulting."
- No orphaned references to "Additional packages", "Secondary packages", or "Featured packages" in copy.

---

## System-Wide Impact

- **Interaction graph:** Nav is shared across all www pages via `Base.astro` + `Header.astro`; one edit in `copy.ts:24` propagates to every page on the site. Verify the homepage, services page, cloud page, and the mobile checkout fallback page all show "Cloud" in the nav after U2.
- **Error propagation:** No net-new error paths. The redirect is a static HTML output; failure mode is "file missing after build", which the build command would surface.
- **State lifecycle risks:** None — no persistent state. The one subtle risk is Stripe sessions created before the Terraform change land with `cancel_url = /pricing`; the redirect handles them, but the window for canceled-session-during-deploy is very small.
- **API surface parity:** The Stripe checkout API contract is unchanged. Plan IDs, price IDs, and session shape are identical. Only the cancel URL shifts.
- **Integration coverage:** Verify end-to-end: click a plan on `/cloud` → Stripe checkout → cancel → land on `/cloud`. Click a plan on `/pricing` (redirected) → still works because the redirect lands on `/cloud` before any checkout state is created.
- **Admin + mobile URL touch (F2):** Two outbound links to the renamed route exist outside `apps/www`: `apps/admin/src/routes/onboarding/welcome.tsx:81` and `apps/mobile/lib/stripe-checkout.ts:67`. Both are updated in U4. The mobile constant propagates only as new app builds ship — older installed builds will cancel to `/pricing` and hit the redirect indefinitely, which is acceptable but should be called out in release notes.
- **Unchanged invariants:**
  - `@thinkwork/pricing-config` plan shape, IDs, and tiers are not modified.
  - `packages/api/src/handlers/stripe-checkout.ts` business logic is unchanged (metadata telemetry string stays, session shape stays).
  - `ServiceCard` remains a reusable component — only its `variant`-driven branching is removed.
  - Docs site (`docs/` Starlight) is untouched.
  - Admin SPA and mobile app billing *business logic* are untouched; only the outbound links to `/pricing` are refreshed (see above). No auth, API, or session flow changes.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Meta-refresh redirect loses SEO juice on `/pricing`'s existing inbound links. | Accept for v1; monitor search-console referral traffic post-deploy; upgrade to CloudFront Function 301 if signals degrade. Deferred explicitly. Document-review caveat in "Deferred to Follow-Up Work" notes the stronger argument to ship the 301 up front. |
| Duplicate-content risk if U1 (create `/cloud` as byte-for-byte copy) ships in a separate PR from U4 (retire `/pricing`). | **Ship U1–U6 in a single PR.** Do not let the intermediate state — two routes rendering identical HTML with no canonical link between them — reach production. If splitting becomes necessary, add a `<link rel="canonical" href="/cloud">` to the unchanged `/pricing` during the gap so search engines don't index both. |
| Stripe cancel URL drift — Terraform change rolls out async to the www redirect, so canceled sessions might briefly hit `/pricing` and bounce. | The redirect covers this; the window is seconds to minutes depending on apply order. No user-visible failure. |
| Services page horizontal layout looks off at tablet breakpoints with 5 wide cards. | Decide grid shape (2-col, 3-col) during U5 edit; test responsive breakpoints visually. If it doesn't work, fall back to vertical cards with a single unified style — the core brief ("one section, no variant split") still holds. |
| `servicePackages` consumers outside `services.astro` break when `variant` is removed. | `grep -rn "servicePackages\|variant" apps/www/src` before landing U5. Current audit shows `services.astro` is the only consumer, but double-check. |
| Someone re-introduces the `/pricing` path (typo in a new link, a blog post import, etc.). | The `astro.config.mjs` redirect is the safety net. Keep it until we have quarterly signal that no inbound links target `/pricing`. |
| Stripe `"www-pricing"` telemetry string feels inconsistent once the page is `/cloud`. | Accept the naming drift for analytics continuity; rename as a deferred follow-up once post-launch analytics have stabilized. |

---

## Documentation / Operational Notes

- Update `docs/STYLE.md` (or a follow-up commit) if the Cloud/Services split establishes new tone rules worth codifying.
- Announce the rename in whatever channel the team uses to notify partners/customers about marketing-site URL changes — short note that `/pricing` still works but the canonical URL is now `/cloud`.
- No migrations, no data changes, no operational runbook updates.
- (The earlier "capture a `docs/solutions/` learning post-merge" note was out of scope for this plan and has been removed; file a separate chore if the team wants to codify the Astro rename-redirect pattern.)

---

## Sources & References

- Current pricing page: `apps/www/src/pages/pricing.astro`
- Current services page: `apps/www/src/pages/services.astro`
- Nav + all copy: `apps/www/src/lib/copy.ts`
- Service card component: `apps/www/src/components/ServiceCard.astro`
- Astro config: `apps/www/astro.config.mjs`
- Stripe handler + comments: `packages/api/src/handlers/stripe-checkout.ts`
- Terraform Stripe URLs: `terraform/modules/app/lambda-api/handlers.tf:82-83`
- Mobile checkout fallback: `apps/www/src/pages/m/checkout-complete.astro:79`
- Style guide: `docs/STYLE.md`
- Prior www plans for tone/structure reference: `docs/plans/2026-04-20-001-feat-www-governance-positioning-refresh-plan.md`, `docs/plans/2026-04-22-008-feat-stripe-pricing-and-post-checkout-onboarding-plan.md`
