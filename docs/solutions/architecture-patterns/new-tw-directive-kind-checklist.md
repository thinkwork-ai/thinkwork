---
title: "Adding a new tw: directive kind touches eight seams across two packages"
date: 2026-07-07
category: architecture-patterns
module: document-compositor-directives
problem_type: architecture_pattern
component: development_workflow
severity: medium
applies_when:
  - "Adding a new first-class tw: directive kind to the Document Compositor's closed vocabulary (following the tw:stats / tw:verdict-grid / tw:timeline pattern)"
  - "Reviewing a PR that adds a directive but doesn't touch the web or workspace-defaults mirrors"
  - "Planning a multi-unit rollout for a new directive (spec unit vs catalog-integration unit vs authoring-guidance unit)"
tags:
  [
    document-compositor,
    tw-directive,
    plate-catalog,
    directive-registry,
    workspace-defaults,
    mirror-drift,
  ]
related_components: [packages/api, apps/web, packages/workspace-defaults]
---

# Adding a new tw: directive kind touches eight seams across two packages

## Context

THINK-202 added `tw:timeline` — a new first-class directive in the Document
Compositor's closed vocabulary — as three sequential PR units (THINK-205,
THINK-206, THINK-207). Only one of those seams (the registry entry) is
registry-derived; the rest are hand-maintained and easy to miss on a first
pass. The plan's own Risks section called out "mirror drift" as a known
hazard, and one of the seams (house CSS geometry) shipped a real defect that
needed a follow-up repair PR. This doc generalizes the full touch-point list
so the next new directive kind doesn't rediscover it by trial and error.

## Guidance

Adding a directive kind (`tw:<kind>`) means touching all of the following.
Items 1–2 are the minimum for the directive to exist and render; 3–8 are what
makes it _discoverable_ and _reachable_ by real tenants and agents — skipping
them ships a directive nothing ever uses.

1. **Registry entry** — `packages/api/src/lib/artifacts/document-directives.ts`.
   Add a `<kind>Spec` (kind name, allowed genres, YAML schema shape, a corrected
   minimal example for self-repair diagnostics, and the render function) to
   `DEFAULT_REGISTRY`. This one entry is what automatically extends
   `DIRECTIVE_KINDS` — unknown-directive diagnostics and plate save-time
   allow-list validation both derive from it for free.

2. **House CSS** — `packages/api/src/lib/artifacts/document-templates.ts`.
   Add the new rules to `DOCUMENT_PLATE_CSS`. **Gotcha:** any pseudo-element
   connector/track segment must extend across the flex item's own padding
   (e.g. `left:-Npx;right:-Npx` matching the padding value), not stop at the
   content box (`left:0;right:0`) — otherwise adjacent items' segments
   under-run by the padding amount on both sides and leave a visible gap at
   every join. This exact defect shipped in THINK-205 U1 (`tw:timeline`'s
   track connector), was caught by human review reading the dogfood
   screenshots (see the sibling doc on pixel-level render verification), and
   was fixed with a one-line CSS change in PR #3464.

3. **The web mirror — now GENERATED, not hand-typed (THINK-685):**
   - `apps/web/src/components/artifacts/plates/directive-kinds.generated.ts`
     holds `PLATE_DIRECTIVE_KINDS` (drives the PlateEditDialog checkbox and
     the Content Contract tab's suggested-directive picker);
     `plate-support.ts` re-exports it, so every existing import site is
     unchanged. apps/web still cannot import packages/api, so the list is
     rendered from `DIRECTIVE_KINDS` by
     `packages/api/scripts/generate-directive-kinds.ts`:

     ```bash
     pnpm --filter @thinkwork/api generate:directive-kinds
     ```

     `packages/api/src/lib/artifacts/directive-kinds-parity.test.ts` re-renders
     the module in memory and compares it byte-for-byte with the checked-in
     file, so a stale mirror now fails CI loudly instead of silently hiding
     an operator UI toggle.

   - `packages/workspace-defaults/src/index.ts` — the composer-skill content
     mirror, parity-tested against `files/` by
     `packages/workspace-defaults/src/__tests__/parity.test.ts`. This test is
     the gate that catches a `files/`-only edit; run it, don't assume it.
     Still hand-maintained by design: it is authoring prose, not a kind list.
   - **Dissolved:** the old `chart-types` mirror is gone — chart rendering
     moved into the `@thinkwork/chart-renderer` package, which is the single
     source for chart types (`CHART_TYPES` is imported, not restated).

4. **Exemplar snippet — now a field on the registry spec (THINK-685).**
   Add `exemplar` to the `<kind>Spec` in `document-directives.ts` (a curated
   showcase body; omit it and the terser diagnostics `example` is used).
   `DIRECTIVE_EXEMPLAR_SNIPPETS` is derived from the registry and consumed by
   `buildPlateExemplar` in `plate-registry.ts` — the standalone
   `EXEMPLAR_DIRECTIVE_SNIPPETS` map is gone, so there is nothing to forget.
   For plates with `allowedDirectives: "all"`, exemplar blocks appear in
   registry order. Note the asymmetry: contract-bearing plates (ones with a
   Section Manifest) preview through `buildContractPreviewExemplar` instead,
   which renders the declared contract and omits the directive gallery
   entirely — a pre-existing behavior, not something a new directive can fix
   on its own.

5. **Plate catalog wiring** — `packages/api/src/lib/artifacts/plate-definitions.ts`.
   Per-plate `allowedDirectives` allow-lists (add the new kind to any
   restricted plate it should reach) and `suggestedDirectives` on the
   specific sections whose shape actually calls for it — don't default to
   suggesting a new directive everywhere; map it to the sections where it's
   genuinely the right shape.

6. **Authoring guidance** — the document-composer skill:
   `packages/workspace-defaults/files/skills/document-composer/SKILL.md`
   (a component block with a fenced example) and
   `references/authoring-rules.md` (the selection-trigger guidance — when to
   reach for this directive vs its closest siblings, and when _not_ to force
   it onto content that doesn't fit). This is the seam that actually gets
   agents to select the directive unprompted, not just the seam that lets
   them use it if told the name.

7. **Distribution** — `packages/workspace-defaults` `DEFAULTS_VERSION` bump
   plus the reseed/reinstall path. Guidance changes in `files/` only reach a
   _repo copy_; they reach real tenant workspaces only through the
   default-skill reseed materializing a fresh
   `skills/document-composer/` folder into each tenant's installed
   platform-agent workspace. Verification must exercise the re-materialized
   workspace copy (grep the S3 object or the agent's own `workspace_skill`
   tool result), not the repo file — a repo-only check would pass while the
   deployed guidance is still stale.

8. **Delivered email rendering** — `packages/api/src/lib/artifact-delivery.ts`.
   `renderDirectiveForEmail` is an if-chain over kinds (email clients strip
   SVG and most CSS, so each kind needs its own table/list rendering). This
   seam was undocumented until THINK-685: a new kind that skipped it still
   _delivered_, just as the generic "This section contains an interactive
   component — open the live report to view it" block, which reads as a
   product defect in the artifact the recipient actually sees. It is now
   drift-guarded — add a branch plus its kind to `DELIVERY_RENDERED_KINDS`,
   or waive it (with a written reason) in `DELIVERY_FALLBACK_OK`;
   `directive-kinds-parity.test.ts` fails with regeneration/repair
   instructions otherwise, and also asserts each claimed kind really renders
   non-fallback HTML.

**Still hand-maintained by design** (editorial judgement, not mechanical
mirrors — do not try to derive them): the house CSS in `document-templates.ts`
(#2), the per-plate `allowedDirectives` / `suggestedDirectives` catalogs in
`plate-definitions.ts` (#5), and the authoring prose plus `DEFAULTS_VERSION`
bump in `packages/workspace-defaults` (#6–#7). Each of these encodes a
judgement about _where_ and _when_ a directive belongs, which no registry
entry can answer.

**Sequencing matters.** If a new directive spans multiple PRs, the registry
unit (1–2) must merge and deploy _before_ the authoring-guidance unit (6–7)
merges — dev is continuous CD from `main`, so a tenant workspace that reseeds
between a merged guidance PR and a not-yet-deployed registry PR would author
directive blocks the runtime still rejects. Strict PR-merge ordering is the
enforcement mechanism; there is no separate feature flag.

## Why This Matters

Of the eight seams, only #1 fails loudly on its own (a missing registry entry
is a compile-time rejection everyone notices immediately). THINK-685 made the
three mechanical mirrors fail loudly too — the web mirror (#3) is generated
and parity-tested, the exemplar snippet (#4) is derived from the registry
spec, and the email delivery renderer (#8) is drift-guarded. What remains
fails quietly, and by design: missing authoring guidance (#6)
means the directive technically works but no agent ever reaches for it
unprompted, which — for a directive whose whole point is agent-driven
authoring — is a silent failure of the actual product requirement, not a
cosmetic gap. THINK-202's own plan flagged mirror drift as a named risk
before implementation started, and the CSS gotcha (#2) still shipped as a
real defect anyway, caught only because a human read the dogfood screenshots
closely rather than trusting element-presence checks.

## When to Apply

- Planning or scoping work to add any new `tw:` directive kind.
- Reviewing a PR that claims to add a directive — check it against all eight
  seams before approving, not just the registry entry and tests.
- Writing the verification contract for a directive rollout — each seam above
  maps to a distinct browser-verifiable behavior (renders, is offered in the
  operator UI, appears in previews, is suggested, is chosen unprompted).

## Examples

Fastest way to enumerate every touch point an existing directive kind hits
(use `verdict-grid` or `stats` as the reference pattern to mirror for a new
kind):

```bash
grep -rln "verdict-grid" packages/api packages/workspace-defaults apps/web
```

This surfaces the registry spec, the CSS rules, both hand-maintained mirrors,
the exemplar snippet, the plate allow-lists/suggestions, and the composer
skill files in one pass — the same set of files a new directive's PR(s)
should touch.

## Related

- `docs/plans/2026-07-06-001-feat-plate-timeline-directive-plan.md` — the
  THINK-202 plan; KTD7 names the two hand-maintained mirrors explicitly, and
  the Risks section names mirror drift and guidance-before-runtime skew.
- `docs/dogfood-reports/2026-07-06-THINK-205-dogfood.md`,
  `docs/dogfood-reports/2026-07-07-THINK-205-repair-dogfood.md` — the CSS
  track-gap defect and its repair/re-verify.
- `docs/dogfood-reports/2026-07-07-THINK-206-dogfood.md` — the catalog-wiring
  unit, including the contract-plate-preview asymmetry (item 4 above).
- `docs/dogfood-reports/2026-07-07-THINK-207-dogfood.md` — the
  authoring-guidance unit and the distribution-gate verification method.
- `docs/solutions/best-practices/dogfood-experiential-verdicts-need-pixel-level-render-checks.md`
  — sibling learning from the same rollout, on why the CSS gotcha in item 2
  wasn't caught by the original automated verification pass.
