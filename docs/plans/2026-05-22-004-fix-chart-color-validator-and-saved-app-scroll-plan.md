---
title: "fix: chart-color validator + saved-app iframe nested scrollbars"
type: fix
status: active
created: 2026-05-22
---

# Chart-Color Validator + Saved-App Iframe Nested Scrollbars

## Problem Frame

Two orthogonal render bugs surfaced when reviewing the saved artifact from Eric's 2026-05-22 live crm-dashboard test (thread `5a6f7ef1-aff8-4c90-81a8-07971b56b33d`, saved app `3ec12ac1-97b4-453c-a0ed-a274976a76cd`):

### Bug 1 — Chart bars render solid black instead of the theme's chart palette

The saved TSX at lines 237 and 254 of the app's `source.tsx` writes:

```tsx
<Bar dataKey="value" radius={[3, 3, 0, 0]} className="fill-primary" />
```

The skill — both `packages/skill-catalog/crm-dashboard/references/produce.md` (lines 71-74) and `packages/workspace-defaults/files/skills/artifact-builder/SKILL.md` (Component System section) — explicitly tells the agent to use `var(--chart-1)` through `var(--chart-5)` for chart marks. The agent did not follow the rule.

`packages/api/src/lib/applets/source-policy.ts` already gates `preview_app` and `save_app` calls. Its `validateRechartsUsage` enforces:

- Recharts primitives must be inside `<ChartContainer>` (good)
- Arbitrary `className="...[...]..."` Tailwind class values rejected (good)
- Limited `bg-*` token set (good)

But it does **not** reject `fill-{primary,secondary,foreground,muted,accent,destructive,…}` on Recharts mark elements. `fill-primary` slipped through and the agent's wrong choice became durable. In dark mode the "primary" color resolves to near-black, hence the solid black bars Eric observed.

### Bug 2 — Saved-app side panel has nested scrollbars

`apps/spaces/src/routes/_authed/_shell/artifacts.$id.tsx:194` mounts `<AppletMount>` for the saved-app side panel **without** `fitContentHeight`. The prop defaults to `false`. With `false`, `apps/spaces/src/applets/iframe-controller.ts:482-486` sizes the iframe to `100%` of its parent container; when the rendered dashboard's content height exceeds the iframe area the iframe gets an inner scrollbar. The outer split-shell adds its own scrollbar at a different level. Two stacked scrollbars in the right panel.

`apps/spaces/src/components/apps/DraftAppletPreview.tsx:195` and `apps/spaces/src/components/apps/InlineAppletEmbed.tsx:76` both already pass `fitContentHeight={true}`. The saved-app side panel was missed.

## Goals

- Chart marks with `className="fill-<semantic-token>"` are rejected at the applet source-policy gate with a clear `APPLET_RECHARTS_FILL_NON_CHART_COLOR` error that names the offending element and points to the chart-var alternative.
- Saved-app side panel renders without nested scrollbars: the iframe sizes to its rendered content height, and a single scrollbar on the panel handles overflow.
- Both fixes are covered by tests that would fail on regression.

## Non-Goals

- Do NOT touch `SKILL.md` / `produce.md`. The skill already says to use chart vars; the agent just didn't comply. The validator is the right layer.
- Do NOT change the iframe protocol (`fitContentHeight` is the existing supported mode; just turn it on here).
- Do NOT add a UI to toggle either behavior. Both are deterministic.
- Do NOT block hand-rolled `fill="#hex"` or `style={{ fill: "..." }}` — those go through different paths and Bug 1's class of error is the className path the agent used.

## Key Technical Decisions

1. **Validator rejects the bad-token set, not an opaque rule.** The validator names the specific offenders (`fill-primary`, `fill-foreground`, `fill-muted`, `fill-secondary`, `fill-accent`, `fill-destructive`, `fill-card`, `fill-popover`, `fill-background`, `fill-border`, `fill-input`, `fill-ring`, plus the `fill-sidebar*` family) and points the agent at the correct alternatives. Allow-listing is cleaner than deny-listing but the allow-list for chart marks is just "`fill-[var(--chart-N)]`" plus `ChartContainer` config plumbing, which the validator cannot statically verify is the live config — so the rule is "reject the known-wrong classes by name and let everything else through."

2. **The Recharts mark element set is enumerated, not heuristically detected.** `<Bar>`, `<Line>`, `<Area>`, `<Pie>`, `<Cell>`, `<RadialBar>`, `<Scatter>`. These are the Recharts primitives that actually render fills; tooltip/axis/grid don't accept `className` fills. Using the explicit set keeps the rule precise.

3. **`fitContentHeight={true}` on the saved-app side panel mirrors the existing inline+draft pattern.** Both callers that already use it have load-bearing tests; this change is a third caller of the same supported mode.

4. **The outer wrapper around `AppletMount` in `artifacts.$id.tsx` keeps `grid h-full min-h-0 min-w-0` — but the `p-4` wrapper or one of the parents must allow vertical overflow** so the now-content-height iframe's tall body is scrollable from the page. Concrete change: the wrapper that hosts `<AppletMount>` adds `overflow-y-auto` (or its parent does); `AppArtifactSplitShell` stays `h-svh min-h-0` as the scroll-root anchor. Implementation may verify which specific ancestor is the right home for `overflow-y-auto` by reading the rendered DOM during the change — the plan does not pin the exact node because the right answer depends on flexbox layering at runtime.

5. **Validator test fixtures live alongside the existing test.** `packages/api/src/lib/applets/source-policy.test.ts` already exercises the policy; add cases there rather than spinning up a new file.

## Implementation Units

### U1. Reject semantic-token `fill-*` classes on Recharts mark elements

**Goal:** the applet source policy rejects `className="fill-{primary|secondary|foreground|muted|accent|destructive|card|popover|background|border|input|ring|sidebar*}"` on Recharts mark elements with a clear, agent-actionable error.

**Files:**

- `packages/api/src/lib/applets/source-policy.ts` (extend `validateRechartsUsage`; add a new `AppletSourcePolicyError` code `APPLET_RECHARTS_FILL_NON_CHART_COLOR`)
- `packages/api/src/lib/applets/source-policy.test.ts` (add scenarios — see below)

**Dependencies:** none.

**Approach:**

1. Define the rejected token set and the Recharts mark set in named constants near the existing `validateRechartsUsage` function.
2. After the existing "must be inside ChartContainer" check, scan the source for opening tags of any Recharts mark element. For each match, inspect its `className` attribute (string-literal forms `className="..."` and `className='...'`; the validator already constrains template-literal and expression forms via the earlier hex-color check, so static-string coverage is sufficient).
3. If the className token list contains any rejected `fill-<token>` (whitespace-separated), throw `AppletSourcePolicyError(APPLET_RECHARTS_FILL_NON_CHART_COLOR, message)` where the message identifies the element name, the offending class, and the canonical alternative (`fill-[var(--chart-1)]` etc.).
4. Do not block `fill="..."` JSX prop, `style={{ fill: ... }}`, or expression-form `className={...}` — those are different code paths with their own existing guards (the `[arbitrary]` check already rejects bracket-form classes that fall outside the chart palette in non-chart contexts).

**Patterns to follow:**

- `validateRechartsUsage` already uses a regex + JSX-tag walker (`isJsxTagInsideChartContainer`). Extend the same walker pattern rather than introducing a separate parser. Same defensive shape — drop into the walker, match the opening tag's `className=` attribute, check tokens, throw on match.
- Error-message style of existing `AppletSourcePolicyError` calls in `source-policy.ts` — single line, names the element, includes the fix-it suggestion.

**Test scenarios:** (file: `packages/api/src/lib/applets/source-policy.test.ts`)

- Happy path: a TSX fixture with `<Bar className="fill-[var(--chart-1)]" />` inside `<ChartContainer>` passes validation. No throw.
- **`Covers Bug 1.`** A TSX fixture with `<Bar dataKey="value" className="fill-primary" />` inside `<ChartContainer>` throws `AppletSourcePolicyError` with code `APPLET_RECHARTS_FILL_NON_CHART_COLOR`; the error message contains the substring `"Bar"`, `"fill-primary"`, and `"var(--chart-"` (or equivalent canonical-alternative hint).
- Edge case: `<Line className="stroke-1 fill-foreground" />` is also rejected (multi-class token list with the offender in non-leading position).
- Edge case: `<Bar className="fill-[var(--chart-2)] rounded-md" />` passes (composition with non-fill utility classes).
- Edge case: `<Bar />` with no `className` attribute passes (regression: don't false-positive on absent attribute).
- Edge case: `<Cell className="fill-destructive" />` is rejected (covers a Recharts mark element besides `<Bar>`).
- Edge case: `<Bar className="fill-sidebar-primary" />` is rejected (sidebar\* family check).
- Negative: a non-Recharts element like `<div className="fill-primary" />` does NOT trigger this validator (the rule is element-specific; div fills are not chart fills).
- Negative: `<Bar fill="var(--chart-1)" />` (JSX prop, not className) passes — out of scope for this validator.

**Verification:**

- `pnpm --filter @thinkwork/api test -- src/lib/applets/source-policy.test.ts` passes.
- Manually constructing the offending TSX from Eric's saved app and running it through the validator produces the new error code.

---

### U2. Saved-app side panel passes `fitContentHeight={true}` and the outer wrapper owns scrolling

**Goal:** the saved-app side panel renders without nested scrollbars. The iframe sizes to the rendered dashboard's content height; the only scrollbar lives on the panel, not inside the iframe.

**Files:**

- `apps/spaces/src/routes/_authed/_shell/artifacts.$id.tsx` (add `fitContentHeight={true}` to the `<AppletMount>` call; verify the surrounding wrapper allows page-level vertical overflow so the now-tall iframe is reachable)
- `apps/spaces/src/routes/_authed/_shell/-artifacts.$id.test.tsx` (regression test that asserts the prop is passed)

**Dependencies:** none.

**Approach:**

1. Add `fitContentHeight={true}` to the `<AppletMount>` call.
2. Read the rendered DOM (manually during execution) to identify which ancestor of `<AppletMount>` should own `overflow-y-auto`. Likely candidates:
   - The local `<div className="grid h-full min-h-0 min-w-0 p-4">` directly wrapping `<AppletMount>` — add `overflow-y-auto` here so the panel scrolls when the iframe (now content-sized) overflows.
   - Or the `<AppArtifactSplitShell>` already provides its own scroll boundary; the iframe just needs to size to content. (Less likely — the shell is `h-svh min-h-0` and currently doesn't surface a scrollbar without explicit overflow.)
3. Pick the smallest change that produces "one scrollbar on the panel, none inside the iframe." Verify by loading the saved app `3ec12ac1` and confirming visually.
4. Do not change the `<AppArtifactSplitShell>` component itself — keep the scope to the saved-app route.

**Patterns to follow:**

- `apps/spaces/src/components/apps/DraftAppletPreview.tsx:195` and `apps/spaces/src/components/apps/InlineAppletEmbed.tsx:76` both pass `fitContentHeight={true}` and have stable layouts. Mirror their call site.
- Existing test at `apps/spaces/src/routes/_authed/_shell/-artifacts.$id.test.tsx` (the leading-`-` prefix is the file-system convention used in this directory for sibling tests).

**Test scenarios:**

- Regression: the test asserts that `<AppletMount>` is rendered with `fitContentHeight={true}` in the saved-app artifact route. This is a structural assertion against the mounted output (using React Testing Library's render + query the props the mount component exposes, or asserting on the host element's data attributes if `AppletMount` already surfaces `fitContentHeight` somewhere observable). If the existing test file does not expose a clean prop-assertion surface, add a `data-fit-content-height` attribute to `<AppletMount>`'s outer container (gated by the prop) and assert on that — but only if there is no cheaper way to assert prop-pass-through.
- Happy path (visual / manual, not asserted in CI): load the saved app `3ec12ac1-97b4-453c-a0ed-a274976a76cd` in dev and verify:
  - One scrollbar on the right panel, not two.
  - The iframe's content height is its rendered body height (no inner scrolling within the iframe).
  - Scrolling the panel scrolls the dashboard naturally.

**Verification:**

- `pnpm --filter @thinkwork/spaces test -- src/routes/_authed/_shell/-artifacts.\$id.test.tsx` passes (or whichever vitest invocation runs that file).
- Manual visual confirmation in dev against the same saved app Eric reviewed.

## Scope Boundaries

- In scope: validator rule + saved-app side-panel iframe sizing.
- Out of scope: refactoring `validateRechartsUsage` into a fuller AST-based JSX validator. The existing regex+walker pattern is adequate and consistent with the rest of `source-policy.ts`.

### Deferred to Follow-Up Work

- Auditing all existing saved apps in dev/prod for the `fill-primary`-class bug and re-saving them. Once U1 is live, future saves are guarded; historical saves may still render with the bug until they're edited. A bulk re-render or migration is a separate concern.
- Catching `fill="<solid-color>"` JSX prop with hex values. Different code path; not the source of this bug.

## Risks & Mitigations

| Risk                                                                                                               | Mitigation                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validator's string-based className parsing misses a token form (e.g. multi-line className)                         | Test scenarios cover the common shapes the agent generates; the existing validator pattern in `source-policy.ts` is the precedent for using regex/walker over full AST parsing. |
| `fitContentHeight={true}` causes the side panel to render a very tall iframe that hides content below the viewport | Adding `overflow-y-auto` to the wrapper ensures the panel itself scrolls. Confirm during execution.                                                                             |
| Existing test infrastructure for `-artifacts.$id.test.tsx` doesn't surface AppletMount props cleanly               | Adding a `data-fit-content-height` attribute on the AppletMount host is a fallback. Less elegant but observable.                                                                |

## System-Wide Impact

- **Saved apps that previously slipped through with `fill-primary`** will continue to render as they did (this PR doesn't migrate them). New saves are gated.
- **Agent error-handling path:** when the validator rejects, the agent receives a structured error and rewrites the TSX. Make sure the error message names the canonical alternative so the rewrite is one-shot.
- No GraphQL schema, no migration, no Lambda config changes.

## Verification

End-to-end:

1. `pnpm --filter @thinkwork/api test -- src/lib/applets/source-policy.test.ts` — all scenarios pass.
2. `pnpm --filter @thinkwork/spaces test -- src/routes/_authed/_shell/-artifacts.\$id.test.tsx` — regression assertion passes.
3. `pnpm --filter @thinkwork/api run typecheck` — clean.
4. `pnpm --filter @thinkwork/spaces run typecheck` — clean.
5. Post-deploy: re-run the same crm-dashboard prompt on a fresh thread. Confirm:
   - The agent doesn't produce `fill-primary` on chart bars (the validator would reject; if it does try, save_app returns the error and the agent rewrites with chart vars).
   - The saved app's right panel renders with one scrollbar (not two), and chart bars use the uploaded theme's palette.
