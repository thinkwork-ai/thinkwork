---
title: "feat: Port the Evaluations module into spaces Settings"
type: feat
status: completed
date: 2026-05-30
---

# feat: Port the Evaluations module into spaces Settings

## Summary

Port the **Evaluations** feature from `apps/admin` into the `apps/spaces` Settings
shell as a new operator-only **Evaluations** section, following the exact pattern
used for the recent Routines / Automations / MCP-server ports (#1851, #1858):
copy the admin routes + components into `apps/spaces`, remap `@/components/ui/*`
imports to `@thinkwork/ui`, replace admin's `BreadcrumbContext`/`PageLayout`
chrome with the spaces settings header (`usePageHeaderActions` breadcrumbs), and
add typed eval GraphQL ops in a codegen-included `evaluation-queries.ts`.

The module spans three surfaces, all reached from one **Evaluations** nav item:
a **dashboard** (summary metrics + 30-day pass-rate trend + recent runs), **run
detail** (per-result inspection sheet, category filters, run-now, live updates),
and **Studio** (test-case library + create/edit/detail authoring with assertions
and AWS Bedrock AgentCore evaluator selection). Backing store is the existing
AgentCore Evaluations GraphQL API — **no Mastra/promptfoo**.

> Shipped in PR #1865 (squash `bed40da3`), released in `desktop-v0.1.0-canary.68`.

---

## Problem Frame

"Spaces absorbs admin" — the spaces app is becoming the single operator console,
with admin deprecated. Evaluations is one of the last operator modules still only
in admin. Operators need to author eval test cases, launch eval runs against the
tenant agent, and inspect run results from within spaces Settings, with the same
fidelity admin offers today. The work is a faithful UI port over an unchanged
backend (the `evaluations.graphql` API + `eval-runner` Lambda already power
admin), not a redesign.

---

## Requirements

- **R1** A new operator-only **Evaluations** section appears in the spaces
  Settings nav (hidden for non-operators, like the other operator sections).
- **R2** Dashboard: summary metrics, 30-day pass-rate trend chart, recent runs
  table, and a "Run evaluation" action (model + category selection → `startEvalRun`).
- **R3** Run detail: per-result table with an inspection sheet (assertions,
  evaluator outputs, system prompt), category filters, run cancel/delete, and live
  updates via the eval-run subscription.
- **R4** Studio: test-case library (search/filter by category), plus create,
  edit, and detail (with run history) views.
- **R5** Test-case authoring covers query, optional system-prompt override,
  mixed-type assertions, AgentCore evaluator selection, category, and enabled
  toggle — parity with admin's `EvalTestCaseForm`.
- **R6** All Evaluations views render **inside the settings shell** (settings
  sidebar stays; breadcrumbs in the settings header), never bouncing to the main
  app shell — matching the automation/MCP/routine detail fix.
- **R7** No new backend: reuse the existing `evaluations.graphql` operations via
  spaces codegen. Do not reintroduce Mastra/promptfoo.

---

## Key Technical Decisions

- **Mirror the established port pattern.** This is the fourth admin→spaces port;
  reuse the exact mechanics proven in `SettingsRoutineDetail` / `ScheduledJobDetail`
  / `SettingsMcpServerDetail`: copy files, `sed` `@/components/ui/<x>` →
  `@thinkwork/ui`, replace admin page chrome with `usePageHeaderActions`
  breadcrumbs, OperatorGuard-wrap each route.
- **Typed eval ops in `evaluation-queries.ts`.** spaces excludes
  `graphql-queries.ts` from codegen and uses untyped `gql`; typed `graphql()` ops
  must live in a codegen-included file (`src/lib/**`). Create
  `apps/spaces/src/lib/evaluation-queries.ts` (`import { graphql } from "@/gql"`)
  and port the eval query/mutation/subscription blocks from admin's
  `graphql-queries.ts`. This is exactly how `routine-queries.ts` was handled.
- **Drop `BreadcrumbContext`; use the settings header.** admin tracks breadcrumbs
  via `BreadcrumbContext`; spaces Settings publishes them through
  `usePageHeaderActions({ breadcrumbs })` rendered by `SettingsHeaderBar`. Each
  ported route sets its own `[{label:"Evaluations", href:"/settings/evaluations"}, …]`
  trail instead of `useBreadcrumbs(...)`.
- **Replace `PageLayout`/`PageHeader`/`PageSkeleton` chrome.** Use the settings
  content conventions: a padded scroll container (`mx-auto max-w-… px-6 pt-6`) and
  `LoadingShimmer` (Memory-style) instead of `PageSkeleton`, consistent with the
  other ported settings sections.
- **Single nav item, nested routes.** One operator-only **Evaluations** item
  (`ShieldCheck` icon) at `/settings/evaluations`; Studio lives at
  `/settings/evaluations/studio/…` reached from within. No separate "Studio" nav item.
- **Port the three small support components** (`MetricCard`, `SystemPromptSheet`,
  `ModelSelect`) into spaces rather than refactoring eval code to avoid them —
  keeps the port faithful and low-risk. `StatusBadge` already exists in spaces
  (ported in #1851) — reuse it.
- **`date-fns` is the only new dependency** (used by the dashboard's 30-day
  zero-fill). `recharts` is already in spaces.

---

## Output Structure

```
apps/spaces/src/
  lib/
    evaluation-queries.ts            # NEW — typed graphql() eval ops (codegen-included)
    evaluation-options.ts            # NEW — EVAL_CATEGORIES (ported)
  components/
    MetricCard.tsx                   # NEW — ported support component
    SystemPromptSheet.tsx            # NEW — ported support component
    agents/ModelSelect.tsx           # NEW — ported model dropdown
    settings/
      SettingsEvaluations.tsx        # NEW — dashboard
      SettingsEvalRunDetail.tsx      # NEW — run detail + result sheet
      SettingsEvalStudio.tsx         # NEW — test-case library
      SettingsEvalTestCaseDetail.tsx # NEW — test-case detail + history
      EvalTestCaseForm.tsx           # NEW — ported create/edit form
      eval-result-detail.ts          # NEW — ported result/assertion helpers
  routes/_authed/
    settings.evaluations.index.tsx                       # NEW
    settings.evaluations.$runId.tsx                      # NEW
    settings.evaluations.studio.index.tsx                # NEW
    settings.evaluations.studio.new.tsx                  # NEW
    settings.evaluations.studio.$testCaseId.tsx          # NEW
    settings.evaluations.studio.edit.$testCaseId.tsx     # NEW
```

---

## Implementation Units

### U1. Scaffolding: dependency, eval queries, options, nav item

**Goal:** Land the inert foundation — dependency, typed GraphQL ops, category
options, and the nav entry — so later units have something to import and the
section is reachable.

**Requirements:** R1, R7

**Dependencies:** none

**Files:**
- `apps/spaces/package.json` (add `date-fns`)
- `apps/spaces/src/lib/evaluation-queries.ts` (create — `import { graphql } from "@/gql"` + ported eval ops)
- `apps/spaces/src/lib/evaluation-options.ts` (create — port `EVAL_CATEGORIES`)
- `apps/spaces/src/components/settings/settings-nav.tsx` (add operator-only "Evaluations" item, `ShieldCheck` icon)

**Approach:** Port the eval `graphql()` blocks from
`apps/admin/src/lib/graphql-queries.ts` — `EvalSummaryQuery`, `EvalRunsQuery`,
`EvalRunQuery`, `EvalRunResultsQuery`, `EvalResultSpansQuery`,
`EvalTimeSeriesQuery`, `EvalTestCasesQuery`, `EvalTestCaseQuery`,
`EvalTestCaseHistoryQuery`, `StartEvalRunMutation`, `CreateEvalTestCaseMutation`,
`UpdateEvalTestCaseMutation`, `SeedEvalTestCasesMutation`,
`DeleteEvalTestCaseMutation`, `DeleteEvalRunMutation`, `CancelEvalRunMutation`,
`OnEvalRunUpdatedSubscription`. Run `pnpm --filter @thinkwork/spaces codegen`.
Add the nav item between an appropriate operator section and Analytics.

**Patterns to follow:** `apps/spaces/src/lib/routine-queries.ts` (typed ops file);
`apps/spaces/src/components/settings/settings-nav.tsx` (`SETTINGS_NAV_ITEMS`,
`operatorOnly`).

**Test scenarios:** Test expectation: none — scaffolding (dep + generated types +
const + nav data). Verified by codegen success and typecheck.

**Verification:** `pnpm --filter @thinkwork/spaces codegen` succeeds and emits the
new eval document types; typecheck clean; "Evaluations" appears in the settings
nav for operators only.

### U2. Port shared support components + result helpers

**Goal:** Bring over the admin-only building blocks the eval views depend on.

**Requirements:** R2, R3, R5

**Dependencies:** U1

**Files:**
- `apps/spaces/src/components/MetricCard.tsx` (create)
- `apps/spaces/src/components/SystemPromptSheet.tsx` (create)
- `apps/spaces/src/components/agents/ModelSelect.tsx` (create)
- `apps/spaces/src/components/settings/eval-result-detail.ts` (create — port `-result-detail.ts`)

**Approach:** Copy each from admin, remap `@/components/ui/*` → `@thinkwork/ui`,
`@/lib/utils` stays (`cn`/`relativeTime` already in spaces). `ModelSelect` uses a
model catalog query — reuse the spaces equivalent (`SettingsModelCatalogQuery` in
`settings-queries.ts`). `eval-result-detail.ts` is pure parsing/formatting (no UI).

**Patterns to follow:** the #1851 component copy + import remap; `StatusBadge`
(already in `apps/spaces/src/components/StatusBadge.tsx`).

**Test scenarios:**
- `eval-result-detail.ts`: port admin's `-result-detail.test.ts` — assertion
  parsing, evaluator-result extraction, failure classification for representative
  result payloads (happy path + empty/missing fields).

**Verification:** typecheck clean; ported helper test passes.

### U3. Evaluations dashboard

**Goal:** The landing view at `/settings/evaluations`.

**Requirements:** R2, R6

**Dependencies:** U1, U2

**Files:**
- `apps/spaces/src/components/settings/SettingsEvaluations.tsx` (create — port `EvaluationsPage`)
- `apps/spaces/src/routes/_authed/settings.evaluations.index.tsx` (create, OperatorGuard)

**Approach:** Port `evaluations/index.tsx`. Replace `PageLayout`/`PageHeader` +
`useBreadcrumbs` with `usePageHeaderActions({ title:"Evaluations", breadcrumbs:[{label:"Evaluations"}] })`
and the settings scroll-container layout. Keep the inline `RunEvaluationButton`
(model + category dialog → `StartEvalRunMutation`), `MetricCard` summary row,
recharts pass-rate trend (`buildLast30Days` + `date-fns`), and recent-runs table.
Row click → `/settings/evaluations/$runId`.

**Patterns to follow:** `SettingsAnalytics.tsx` (recharts in settings),
`SettingsRoutines.tsx` (table + row nav), `SettingsHeaderBar` breadcrumbs.

**Test scenarios:** Test expectation: none beyond typecheck — UI port of inherited
behavior; validated live in the desktop app.

**Verification:** typecheck clean; dashboard renders metrics + chart + runs; "Run
evaluation" starts a run; rows navigate to run detail within the settings shell.

### U4. Run detail + result inspection

**Goal:** Per-run results view with the inspection sheet and live updates.

**Requirements:** R3, R6

**Dependencies:** U1, U2

**Files:**
- `apps/spaces/src/components/settings/SettingsEvalRunDetail.tsx` (create — port `EvalRunDetailPage` incl. inline `ResultDetailSheet`)
- `apps/spaces/src/routes/_authed/settings.evaluations.$runId.tsx` (create, OperatorGuard)

**Approach:** Port `evaluations/$runId.tsx` (the run detail view + `ResultDetailSheet`
+ `EditEvalTestCaseSheet`). Breadcrumb `[Evaluations → Run ‹id8›]`. Keep
`OnEvalRunUpdatedSubscription` live refetch, category filter pills, cancel/delete
run, and the result sheet (assertions, evaluator outputs, `SystemPromptSheet`).
The embedded edit sheet reuses `EvalTestCaseForm` from U6.

**Patterns to follow:** `ScheduledJobDetail` (subscription + sheet + in-shell
breadcrumbs); `SettingsRoutineExecutionDetail` (run-style detail).

**Test scenarios:** Test expectation: none beyond typecheck — inherited behavior;
validated live.

**Verification:** typecheck clean; run detail renders results, filters work, sheet
opens with assertions/evaluator output/system prompt, live updates land, all
within the settings shell.

### U5. Studio: test-case library

**Goal:** The test-case list at `/settings/evaluations/studio`.

**Requirements:** R4, R6

**Dependencies:** U1, U2

**Files:**
- `apps/spaces/src/components/settings/SettingsEvalStudio.tsx` (create — port `EvalStudioPage`)
- `apps/spaces/src/routes/_authed/settings.evaluations.studio.index.tsx` (create, OperatorGuard)

**Approach:** Port `evaluations/studio/index.tsx`. Search + category filter + list;
breadcrumb `[Evaluations → Studio]`; "New test case" → studio/new; row →
studio/$testCaseId; keep the `SeedEvalTestCasesMutation` seed action and
`DeleteEvalTestCaseMutation`. Settings layout + LoadingShimmer.

**Patterns to follow:** `SettingsRoutines.tsx` / `SettingsSkills.tsx` (list +
filter + row nav within settings).

**Test scenarios:** Test expectation: none beyond typecheck — UI port; validated live.

**Verification:** typecheck clean; library lists test cases, search/filter work,
row navigates to detail in-shell.

### U6. Studio: test-case form + new / edit / detail routes

**Goal:** Authoring — create, edit, and detail (with history) for test cases.

**Requirements:** R4, R5, R6

**Dependencies:** U1, U2, U5

**Files:**
- `apps/spaces/src/components/settings/EvalTestCaseForm.tsx` (create — port `EvalTestCaseForm`)
- `apps/spaces/src/components/settings/SettingsEvalTestCaseDetail.tsx` (create — port `EvalTestCaseDetailPage`)
- `apps/spaces/src/routes/_authed/settings.evaluations.studio.new.tsx` (create)
- `apps/spaces/src/routes/_authed/settings.evaluations.studio.$testCaseId.tsx` (create)
- `apps/spaces/src/routes/_authed/settings.evaluations.studio.edit.$testCaseId.tsx` (create)

**Approach:** Port `EvalTestCaseForm` (assertions editor, AgentCore evaluator
checkboxes, system-prompt override, enabled toggle) and the detail page (history
table → result sheet/edit). Wire create → `CreateEvalTestCaseMutation`, edit →
`UpdateEvalTestCaseMutation`. Breadcrumbs: `[Evaluations → Studio → ‹name›]`.
new/edit are thin route wrappers around the form; the form lifts its Cancel/Save
actions into the settings header via `onActions`.

**Patterns to follow:** `SettingsUserDetail.tsx` (form + save within settings),
`SettingsSpaceConfig` (in-card save). Port admin's `EvalTestCaseForm.test.ts`.

**Test scenarios:**
- Port `EvalTestCaseForm.test.ts`: `completeEvalTestCaseFormSubmit` callback vs.
  navigation branch.

**Verification:** typecheck clean; ported form test passes; create/edit persist and
return to the library; detail shows history; all in-shell.

### U7. Route-tree regen, wiring, and end-to-end verification

**Goal:** Tie navigation together and verify the whole section.

**Requirements:** R1–R7

**Dependencies:** U3, U4, U5, U6

**Files:**
- `apps/spaces/src/routeTree.gen.ts` (regenerated by the Vite plugin)

**Approach:** Regenerate the route tree (dev server boot or build), run
`pnpm --filter @thinkwork/spaces codegen` + `typecheck` + `test`, and confirm all
intra-section navigation stays in the settings shell.

**Test scenarios:** Test expectation: none new — aggregates prior units; full
typecheck + spaces test suite green; manual desktop validation pass.

**Verification:** `pnpm --filter @thinkwork/spaces typecheck` clean; `pnpm
--filter @thinkwork/spaces test` green; live desktop walkthrough.

---

## Scope Boundaries

**In scope:** Faithful UI port of all admin Evaluations surfaces into spaces
Settings (dashboard, run detail, Studio CRUD), the three support components, eval
GraphQL ops via codegen, the nav item, and `date-fns`.

**Not in scope (non-goals):**
- Any backend change to `evaluations.graphql`, the `eval-runner` Lambda, or the
  AgentCore evaluator set.
- Redesign of the evaluations UX — this is a port, not a rethink.
- Reintroducing Mastra/promptfoo.
- Removing/altering the admin Evaluations routes (admin deprecation is a separate
  track; leave admin's copy intact for now).

### Deferred to Follow-Up Work
- OpenTelemetry span/trace viewer polish (`EvalResultSpansQuery`) if it proves
  heavier than a straight port.
- Deleting the admin Evaluations module once spaces parity is confirmed in dev.

---

## Risks & Dependencies

- **Large files (run detail, dashboard).** Mitigation: mechanical copy + import
  remap (proven in #1851); port wholesale, then adapt chrome.
- **`graphql-queries.ts` vs typed `graphql()` trap.** spaces excludes
  `graphql-queries.ts` from codegen — eval ops MUST go in `evaluation-queries.ts`.
- **Route tree not regenerating in typecheck.** The Vite plugin regenerates on dev
  boot/build, not on `tsc`. U7 explicitly regenerates before the final typecheck.
- **`ModelSelect` model-catalog source.** Reuse `SettingsModelCatalogQuery`.
- **Worktree bootstrap.** Fresh worktree needs `pnpm install`, delete
  `tsconfig.tsbuildinfo`, `pnpm --filter @thinkwork/database-pg build` before
  typecheck; copy `apps/spaces/.env` for desktop validation.

---

## System-Wide Impact

- **Operators only** — new section is `operatorOnly` in the settings nav and each
  route is `OperatorGuard`-wrapped; non-operators never see it.
- **No data/schema migration** — read/write goes through existing eval resolvers.
- **Cost-bearing action** — "Run evaluation" launches real AgentCore eval runs;
  preserve admin's confirmation/model-selection UX (don't make it one-click).
- **Bundle** — adds `recharts` usage (already a dep) + `date-fns`; modest.

---

## Sources & Research

- Admin module map (routes, components, GraphQL ops, deps, cross-imports) — repo
  exploration, 2026-05-30.
- Established port pattern: PR #1851 (Routines/Automations/MCP detail), PR #1858
  (settings polish) — same copy + remap + settings-header mechanics.
- Canonical eval API: `packages/database-pg/graphql/types/evaluations.graphql`.
- Evals scoring stack is AWS Bedrock AgentCore Evaluations (16 built-in
  evaluators); not Mastra/promptfoo.

---

## Outcome

Shipped in **PR #1865** (squash `bed40da3`), released in
**`desktop-v0.1.0-canary.68`**. All 7 units delivered; 678 spaces tests green;
no backend changes. Header actions render as icon-only ghost buttons matching the
thread toolbar, and the **Evaluations** nav item sits directly under **Users**.
