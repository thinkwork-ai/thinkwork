# Residual Review Findings — feat/www-services

Source: `ce-code-review mode:autofix` run `20260423-132016-8ca1295a` against `docs/plans/2026-04-23-004-feat-www-services-page-plan.md`. Branch pushed at commit `b813b24` (no open PR at the time of the run, so findings are recorded here as the durable sink per the lfg pipeline).

All findings below are code-quality / maintainability cleanups. None block merge — the feature is `Ready with fixes`. All 21 plan requirements are met; build passes; voice guardrails respected.

## Residual Review Findings

- **[P2][gated_auto → downstream-resolver]** `apps/www/src/components/ServiceCard.astro:8` — **ServiceCard Props duplicates ServicePackage shape — drift will silently drop fields.** The `Props` interface in `ServiceCard.astro` re-declares every field of `ServicePackage` (from `apps/www/src/lib/copy.ts`). Adding a field to `ServicePackage` today requires edits in 3 places (type, card Props, both call sites); if any is missed, the page silently drops the field. Fix: `import type { ServicePackage } from "../lib/copy"; interface Props extends ServicePackage {}` (or `type Props = ServicePackage`). Coupled to the next finding — apply together.

- **[P2][gated_auto → downstream-resolver]** `apps/www/src/pages/services.astro:115` — **Manual 10-field prop forwarding in services.astro is brittle against ServicePackage additions.** Both `featuredItems.map` (line 115) and `secondaryItems.map` (line 143) hand-list every prop. Fix: `<ServiceCard {...pkg} />`. Requires the Props-extends-ServicePackage fix above so spread is type-safe.

- **[P2][manual → downstream-resolver]** `apps/www/src/pages/services.astro:234` — **Closing CTA is a near-copy of FinalCTA.astro.** Lines 234–271 mirror `FinalCTA.astro` structurally (section wrapper, glow divs, pill, headline, lede, CTA) — only copy source and CTA/points count differ. The plan notes `FinalCTA.astro` has no props, so reuse wasn't feasible. Fix: give `FinalCTA.astro` optional props (`copy`, `showPoints`, `showSecondaryCta`) and migrate both call sites rather than maintaining two divergent copies. Touches the homepage; requires sign-off before landing.

- **[P2][gated_auto → downstream-resolver]** `apps/www/src/lib/copy.ts:423` — **`ServicePackage.cta` is dead configuration — all six packages set "Talk to us".** Per-item `cta` field pays for zero variation. Fix: hoist the label to `services.packages.ctaLabel` (or inline the literal in `ServiceCard.astro`) and drop the field from `ServicePackage`. Touches the type; requires sign-off.

- **[P3][gated_auto → downstream-resolver]** `apps/www/src/lib/copy.ts:412` — **`ServicesMailto` type alias only referenced twice in its own file.** Consumed only by two `satisfies ServicesMailto` annotations; the consumer (`services.astro`) reads the shape directly. The alias doesn't protect a boundary. Fix: drop the type and the `satisfies` clauses — inference is equivalent.

## Pre-existing (not counted toward verdict)

- `apps/www/src/pages/services.astro:33` — Eyebrow pill markup duplicated across `Hero.astro`, `FinalCTA.astro`, `pricing.astro`, `m/checkout-complete.astro`. services.astro added two more instances. Site-wide `<EyebrowPill />` extraction is the right follow-up; scope it outside this PR.

## Residual Risks

- Voice guardrails in `copy.ts` header are enforced manually; future edits could regress without signal. A build-time grep lint over the banned-word list would compound value.
- Mailto subject lines are the inbound triage key; a typo or differing em-dash in a future edit would silently break routing.
- Package variant partition (featured=4, secondary=2) is implicit; mistagging would shift the layout with no automated alarm.
- `ServiceCard` variant branching lives in 6 places — if a third variant appears, split into `FeaturedServiceCard` / `SecondaryServiceCard` rather than growing the enum.
- Closing-CTA duplication with `FinalCTA.astro` will rot if `FinalCTA` presentation evolves.

## Suppressed

- kieran-typescript F3 (P3, confidence 50): `as const` on `items` array — below confidence gate.
- maintainability F5 (P3 advisory, maintainability-only): variant-branching watch — weak-signal demotion.
- maintainability F6 (P3 advisory, maintainability-only): flat-array-filter pattern — weak-signal demotion.
