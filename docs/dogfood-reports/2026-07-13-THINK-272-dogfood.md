---
title: THINK-272 Dogfood Verification — Wiki plates + compositor internal-link policy
issue: THINK-272
parent: THINK-270 (U1)
plan: docs/plans/2026-07-12-008-feat-wiki-plates-compositor-link-policy-plan.md
pr: https://github.com/thinkwork-ai/thinkwork/pull/3674
merge_commit: 1f3067d98
deploy_run: https://github.com/thinkwork-ai/thinkwork/actions/runs/29238938368
date: 2026-07-13
verdict: PASS
---

# THINK-272 Dogfood Verification

**Verdict: PASS.** All three verification-contract flows green; scenario matrix green; no
"Decisions for a human". Routing: remove Verification Failed (not present), record evidence,
post `handoff:THINK-272:Done`, move to Done (LFG).

## Scope

This unit has **no deployed user-visible surface** — wiki readers land in THINK-274 (web) /
THINK-275 (mobile), persistence in THINK-273. Per the plan's Verification Contract, end-to-end
proof is the API test suite plus a local browser inspection of a _freshly compiled_ sample; the
deployed-dev browser flows for this capability execute in the downstream units. There is no dev
URL to click yet.

### Preconditions (met)

- PR #3674 **merged** 2026-07-13T09:23:51Z (squash `1f3067d98`), all CI checks green.
- Post-merge Deploy run on `main` — [runs/29238938368](https://github.com/thinkwork-ai/thinkwork/actions/runs/29238938368)
  **SUCCESS** (Build Lambdas + Terraform Apply green; code-only change — no migration, Migration
  Drift Check skipped as expected).
- Verified locally at HEAD `1f3067d98`.

### Diff scope (exactly what changed)

`git diff --name-only 1f3067d98^ 1f3067d98` — 5 files, all under `packages/api/src/lib/artifacts/`:

| File                                 | Role                                                                 |
| ------------------------------------ | -------------------------------------------------------------------- |
| `plate-definitions.ts` (+196)        | `WIKI_PLATES` (3 defs), `getWikiPlate`, `WIKI_PAGE_TYPE_TO_SLUG` map |
| `plate-registry.ts` (+33)            | `resolveWikiPlate(tenantId, pageType, store?)`                       |
| `document-compositor.ts` (+63)       | `internalLinkPolicy?: "wiki"` + `resolveInternalWikiHref` gate       |
| `plate-registry.test.ts` (+174)      | wiki plate / resolveWikiPlate / AE4 / AE5 / P3 pins                  |
| `document-compositor.test.ts` (+152) | AE1 / AE2 / R5 / determinism pins                                    |

**No `__fixtures__` files touched** → golden-parity holds by construction _and_ is validated by the
full suite passing against the unmodified fixtures.

## Scenario Matrix

| #   | Scenario                                                                                                                        | Source                          | Functional | Experiential |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------- | ------------ |
| S1  | Full artifact suite green; golden fixtures byte-identical (AE3/R5)                                                              | Contract flow 1, QA #1          | PASS       | n/a          |
| S2  | AE2 rejection vectors + AE1 acceptance in policy-on compile                                                                     | Contract flow 1, QA #2          | PASS       | n/a          |
| S3  | `resolveWikiPlate` AE4 layering, unknown→null, P3 tenant-origin guard, AE5 exclusion                                            | Contract flow 1, QA #3          | PASS       | n/a          |
| S4  | Fresh compile per wiki type → real browser (light+dark): eyebrow, per-type accent, tokens, live `/wiki` anchors, inert external | Contract flow 2, QA #4          | PASS       | PASS         |
| S5  | R3 grep: no emission/dispatch/listPlates path reaches a wiki slug                                                               | Contract flow 3, QA #5          | PASS       | n/a          |
| S6  | Determinism / opt-in: policy-off degrades `/wiki/` links like any other; two policy-on compiles byte-identical (R5)             | Mapped flow (compositor purity) | PASS       | n/a          |
| S7  | DoD: THINK-273 consumer interfaces exist on `main` as its plan consumes                                                         | DoD                             | PASS       | n/a          |

## Per-scenario evidence

### S1 — Full artifact suite green, zero fixture churn — PASS

`cd packages/api && npx vitest run src/lib/artifacts/`

```
Test Files  20 passed (20)
     Tests  397 passed (397)
```

stderr contains best-effort log lines ("inbox down", "hindsight down") — these are _intentional_
assertions inside passing failure-path tests, not errors. No `__fixtures__` file appears in the
merged diff, so the golden fixtures are byte-identical.

### S2 — Internal-link policy AE1/AE2 — PASS

`npx vitest run document-compositor.test.ts -t "internal-link policy"` → **29 passed / 45 skipped**.
Rejection vectors pinned individually, each degrading to inert text in a policy-on compile:

`/wiki/../admin`, `/wiki/./../x`, `//host/wiki/entity/x`, `https://evil.example/wiki/entity/x`,
`http://evil.example/wiki/entity/x`, `/wiki/..\admin`, `\\evil.example\wiki\entity\x`,
`/wiki/entity/a\..\..\admin`, `/wiki/bogus-type/x`, `/wiki/entity/a/b`, `/wiki/entity/x/`,
`/wiki/entity/`, `/wiki/entity`, `/other/path`, `javascript:alert(1)`, `mailto:...`,
`data:text/html,x`, `http://[` (malformed), `""` (empty).

Acceptance + normalization pins: well-formed passthrough, odd-but-valid rewrite to normalized path
(R4), query/fragment stripped, encoded-character behavior (`%20` survives; `%2F`/`%5C` are **not**
route escapes), AE1 whole-pipeline anchor survival, "normalization rewrites the emitted href not the
raw input", opt-in means opt-in (policy-off), and determinism (byte-identical).

### S3 — resolveWikiPlate layering & exclusion — PASS

`npx vitest run plate-registry.test.ts -t "resolveWikiPlate"` → **6 passed**. Pinned cases:
resolves each page type to its platform definition; unknown page type → null **without touching the
store**; tenant palette + `platform_override` row layer in (AE4); a **tenant-origin** row named
`wiki-entity` **cannot hijack** the wiki render (P3 guard); store errors propagate; **no composer
surface reaches a wiki slug** (AE5/R3). Companion `wiki plates` block pins wiki/platform lists
disjoint, page-type map = exactly entity/topic/decision, and every def: no directives + accent-triad
palette + all-suggested sections.

### S4 — Fresh browser render, each type, light + dark — PASS / PASS

Drove `resolveWikiPlate("tenant-verify", type, store)` (fake store seeding a tenant document palette
**and** a `platform_override` row for `wiki-entity`) → `compileDocument({ plate, internalLinkPolicy:
"wiki", ... })`, wrote `renderHtml` to `/tmp/think272-wiki-<type>.html`, opened each in a real
browser (agent-browser / Chromium via CDP) under both `prefers-color-scheme: light` and `dark`.

Observed for all three types (screenshots captured `/tmp/think272-<type>-{light,dark}.png`):

- Eyebrow renders `WIKI · ENTITY` / `WIKI · TOPIC` / `WIKI · DECISION`.
- Per-type accent, matching plan hues: entity green `#2f7d52`(light)/`#7fc9a2`(dark),
  topic blue `#3865ae`/`#8fb4e8`, decision amber `#a85a24`/`#e0a370`.
- Light/dark tokens stamp via the envelope through **both** `@media (prefers-color-scheme: …)` and
  `[data-theme="…"]` paths; dark screenshots show the dark surface + accent-soft chips.
- The 3 valid cross-links (`/wiki/entity/acme-corp`, `/wiki/topic/pricing-strategy`,
  `/wiki/decision/q3-rollout`) are **live `<a>` anchors** carrying exactly the normalized path,
  no `target`/`rel`/scheme/host.
- All 9 hostile/external links (external absolute, protocol-relative authority, traversal,
  absolute-url wiki spoof, backslash authority, bogus type, extra segment, `javascript:`,
  non-wiki `/other/path`) degrade to **inert `<code>` chips** — no anchor, no navigable target.

**AE4 layered live:** resolved entity plate showed `--accent: #1d6b45` (the `platform_override`),
`--surface: #fbfbf7`/`#141613` (the tenant palette), and platform accent-soft/text — i.e. platform
floor + tenant palette + override merged end-to-end through the real resolver, `customized: true`.

Experiential verdict PASS: the render reads as the intended house wiki plate; nothing contradicts
design intent.

### S5 — R3 grep exclusion — PASS

`grep -rn 'WIKI_PLATES|getWikiPlate|resolveWikiPlate|wiki-entity|wiki-topic|wiki-decision'
packages/api/src` (excluding tests): every hit is inside `plate-definitions.ts` (own module) or
`resolveWikiPlate` in `plate-registry.ts`. No emission, dispatch, `listPlates`, or composer summary
path imports them — matching the "no composer surface reaches a wiki slug" pin.

### S6 — Determinism / opt-in — PASS

Covered by the compositor suite: policy-off compile still degrades `/wiki/entity/x` to inert text
("opt-in means opt-in", R5); two policy-on compiles produce identical bytes.

### S7 — DoD: downstream interfaces present — PASS

`resolveWikiPlate(tenantId, pageType, store?)` returns `ResolvedPlate | null`, and
`CompileDocumentInput.internalLinkPolicy?: "wiki"` exists on `main` at `1f3067d98` — exactly the
surface THINK-273's plan consumes. THINK-273 is unblocked.

## Paper cuts

None. The one anomaly encountered was in the _verification harness_, not the product: my first
scratch driver used the wrong override config key (`config.palette.light` instead of the real
`config.paletteLight`), so the override didn't merge until corrected — the AE4 unit test already
pins the correct shape. No product defect, no follow-up filed.

## Decisions for a human

None. All flows proved by automation; no auth blocker, no needs-human-verify surface (there is no
deployed reader for this unit by design).
