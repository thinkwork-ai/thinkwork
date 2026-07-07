---
title: "Dogfood experiential verdicts on rendered visuals need pixel/geometry checks, not just element-presence checks"
date: 2026-07-07
category: best-practices
module: dogfood-qa-verification
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - "Marking a dogfood/QA scenario 'experiential PASS' for any rendered visual output (document artifact, chart, UI component) captured via screenshot"
  - "Writing or reviewing a verification brief whose acceptance criteria include visual continuity, spacing, alignment, or house-style fidelity"
tags:
  [
    dogfood-qa,
    verification-doctrine,
    visual-regression,
    pixel-level-verification,
    screenshot-evidence,
  ]
related_components: [packages/api]
---

# Dogfood Experiential Verdicts on Rendered Visuals Need Pixel/Geometry Checks, Not Just Element-Presence Checks

## Context

During the THINK-205 (U1 of THINK-202, `tw:timeline` directive) dogfood pass,
scenario S1 was marked **experiential PASS**: the verification confirmed a
horizontal track rendered with accent dot markers, labels above, captions
below — the expected elements were present and a screenshot was attached as
evidence. But the screenshot itself showed the defect: each track segment's
CSS `::before` connector stopped 6px short of the item's padding boundary on
each side, leaving 12px of visible dead space at every join between adjacent
milestones. The track did not read as continuous. A human (Eric) caught this
by looking at the same evidence images the automated pass had already
captured and signed off on.

The repair (PR #3464, one line of CSS extending the segment across the
item's padding) was verified with a materially different method: the re-verify
report (`docs/dogfood-reports/2026-07-07-THINK-205-repair-dogfood.md`)
measured dot-center-to-dot-center gaps in pixels ("Alpha→Beta 0px, Beta→Gamma
0px") from the rendered geometry, and additionally zoomed the track band 6x
to visually scrutinize the exact seam pixels — instead of relying on a
full-size screenshot's overall impression.

## Guidance

**"The expected elements are present in the render" and "the render matches
design intent" are two different assertions, and passing the first is not
evidence for the second.** When a verification scenario's acceptance
criterion is about visual quality — continuity, spacing, alignment, no
clipping/overlap, house-style fidelity — a verifier must:

1. **Measure the actual geometry**, not just confirm structure. Read bounding
   boxes, computed CSS values, or pixel offsets for the specific relationship
   the requirement describes (e.g., "the track is continuous" → measure the
   gap between adjacent connector segments; "no clipping" → measure whether
   any element's bounding box exceeds its container). A full-size screenshot
   can look fine at a glance while the exact pixels under test do not survive
   scrutiny.

2. **Zoom or crop the specific region under test** when the defect would be
   small relative to the full screenshot. The 6x-zoomed track-band crop is
   what made the (fixed) 0px gaps and the (original) 12px gaps visually
   obvious in a way the full-width screenshot did not.

3. **Name the measurement in the verification brief up front**, not after a
   miss is suspected. If a scenario's acceptance language uses words like
   "continuous," "seamless," "no gap," "aligned," or "matches house style,"
   the brief should specify the concrete geometric assertion that proves it
   (which elements, which computed property, what threshold) — mirroring how
   `docs/solutions/best-practices/verify-agent-claimed-writes-against-db-in-dogfood-qa.md`
   requires a named DB predicate for every claimed write, rather than
   accepting the agent's reply as evidence.

4. **Treat a screenshot as supporting evidence for a written assertion, not
   a substitute for one.** Attaching a screenshot to a PASS verdict feels
   like strong evidence, but a verifier who doesn't independently inspect
   the image's actual pixels against the stated design intent has produced
   the same failure mode as trusting an agent's textual claim: a confident
   artifact accompanies an unverified assertion.

## Why This Matters

A confident, well-evidenced-looking PASS — a scenario with a screenshot
attached and every expected DOM element enumerated — is exactly the failure
mode that slips past review, because nothing about the _report's structure_
signals a problem. Only fresh eyes on the actual rendered pixels caught the
THINK-205 defect; the original automated pass had the same screenshot
available and did not catch it. This is the visual-rendering sibling of
`docs/solutions/best-practices/verify-agent-claimed-writes-against-db-in-dogfood-qa.md`: there, an agent's
_claim_ about a write needed a store-level assertion instead of trusting the
reply; here, a verifier's _screenshot_ needed a geometry-level assertion
instead of trusting the visual impression that "it rendered."

## When to Apply

- Any dogfood/QA scenario whose PASS criterion is about how something looks
  rendered — layout, spacing, continuity, alignment, theming, clipping.
- Writing verification briefs for new visual components (charts, directive
  blocks, house-style UI elements) — pair each visual-quality scenario with a
  named geometric measurement at authoring time, the same way write-scenarios
  get a named DB predicate.
- Reviewing a dogfood report before accepting its verdict: treat "screenshot
  attached, elements present" without a stated geometric assertion as
  unverified for the visual-quality dimension specifically, even if the
  functional dimension is solidly proven.

## Examples

**Before (structure-based verification — insufficient on its own):**

> S1: horizontal track renders with accent dot markers, bold labels above,
> captions/dates below, matching the `tw:stats` house idiom. Screenshot
> attached. **Experiential PASS.**

**After (geometry-based verification — what the repair re-verify actually did):**

> Measured geometry (3-item render): `Alpha seg 224→334`, `Beta seg 334→554`,
> `Gamma seg 554→664`; gaps: Alpha→Beta 0px, Beta→Gamma 0px. Track band
> screenshotted and magnified 6x to scrutinize the pixels between adjacent
> dots — line unbroken through all three dots, no dead space. **PASS**,
> with the specific measurement recorded, not just the screenshot.

## Related

- `docs/dogfood-reports/2026-07-06-THINK-205-dogfood.md` — the original pass
  that marked the gapped track experientially PASS.
- `docs/dogfood-reports/2026-07-07-THINK-205-repair-dogfood.md` — the repair
  re-verify with the pixel-level measurement method.
- `docs/solutions/best-practices/verify-agent-claimed-writes-against-db-in-dogfood-qa.md`
  — sibling doctrine for write-confirmation claims rather than rendered
  visuals.
- `docs/solutions/architecture-patterns/new-tw-directive-kind-checklist.md`
  — the CSS gotcha (track-segment padding) that this verification failure
  was originally about.
- Note: the corresponding wording change to the Verify Prompt in
  `.agents/skills/thinkwork-linear-dispatcher/references/launch-prompts.md`
  is a deferred follow-up, not part of this doc — this captures the learning
  only.
