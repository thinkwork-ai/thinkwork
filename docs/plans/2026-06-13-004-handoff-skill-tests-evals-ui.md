# Handoff — Skill Tests & Evals: UI (U9 + deferred U6/U8 UI)

Created: 2026-06-13
Plan: docs/plans/2026-06-13-003-feat-skill-tests-and-evals-plan.md
Branch: `feat/skill-tests-and-evals` (worktree `.claude/worktrees/skill-evals-work`, off `origin/main`)

## State: backend complete (U1–U8), UI remaining (U9 + U6/U8 UI). No PR yet.

Eight units' backend is committed on the branch, full api suite green (4756 passed,
0 failed), `tsc --noEmit` clean, `@thinkwork/database-pg build` clean. Commits:

| Commit | Unit |
|---|---|
| `fd7ca9af9` | U1 per-skill dataset kind + seeder |
| `dcdb388dd` | U2 sync bundled cases on install/update |
| `c7fb7513b` | U3 eval-baseline agent provisioning |
| `2cfa17279` | U4 run a skill dataset isolated |
| `dca65fb51` | U7 activeSkills on the per-turn snapshot |
| `96a492370` | U5 score + regression warning on install/update |
| `8fb71ba2e` | U6 deferred-apply operator gate |
| `7c6ad519d` | U8 backend: flag a thread → skill attribution |

## What the feature does now (backend)
Skills carry eval cases (`evals/*.json` in the catalog folder) → synced into per-skill
`kind:'skill'` datasets on install/update (REST + plugin paths; operator-flagged cases
survive re-syncs) → scored in ISOLATION against a hidden eval-baseline agent
re-materialized to exactly one skill → install/update fires an async scored run + a
regression-aware score read → an optional per-tenant gate HOLDS a below-threshold
update's swap until an operator applies it → flagged threads are attributable to a skill,
suggested from the turn's recorded `activeSkills`.

## Remaining work — ALL UI (needs Eric's visual + dev validation per validate-before-push)

Operator-gated (`OperatorGuard` / `useTenant().isOperator`). Refetch on the existing
`notifyEvalRunUpdate` subscription with a coalesced `network-only` refetch (urql doc
cache doesn't auto-invalidate — see docs/solutions/integration-issues/spaces-urql-doc-cache-no-live-invalidation.md).
Add queries/mutations in `apps/web/src/lib/evaluation-queries.ts` /
`skill-catalog-queries.ts`; web codegen already has the types (`pnpm --filter @thinkwork/web codegen` ran).

1. **U9 — skills score surface**
   - `apps/web/src/components/settings/SettingsSkills.tsx`: a score column per skill via
     `skillEvalScore(tenantId, skillSlug)`; render "unrated" when `rated:false`.
   - `apps/web/src/components/settings/SettingsSkillDetail.tsx`: latest score, regression
     badge (`regression:true`), version-over-version trend, and a **"run evals now"** action
     → `startEvalRun(tenantId, { datasetSlug: "skill-<slug>" })` (U4 routes a `skill-…`
     dataset to the isolated baseline run automatically). Score updates live via the
     subscription refetch.

2. **U6 UI — the gate (folded here from U6)**
   - Threshold control: read `skillEvalGate(tenantId)` → `{ enabled, threshold }`; set via
     `setSkillEvalGate(tenantId, threshold)` (null clears). Operator-only.
   - Held-update surfacing: a gated reinstall returns `{ ok:true, gated:true,
     candidateDatasetSlug, evalRun }` (no swap). Surface "update held — candidate scoring"
     and, once scored, an **Apply** action → `applySkillUpdate(tenantId, skillSlug, agentId,
     override)` returning `{ applied, blocked, overridden, passRate, threshold }`. Below
     threshold → show blocked + an override affordance.

3. **U8 UI — flag dialog skill picker**
   - `apps/web/src/components/workbench/FlagThreadForEvalDialog.tsx`: fetch
     `flaggedTurnSkillCandidates(tenantId, threadId, turnId)` → `{ candidates:
     [{skillSlug, source}], fallback }`. Render the candidates + a "not skill-specific"
     option. Pass the chosen `skillSlug` (and `attributionFallback: true` when the picked
     candidate's `source === "installed"` / the response `fallback` is true) to
     `flagThreadForEval`. The mutation's three-way guard requires exactly one of
     `skillSlug` / `datasetSlug` / `newDatasetName`.

## GraphQL surface the UI consumes (all in packages/database-pg/graphql/types/evaluations.graphql)
- Query `skillEvalScore(tenantId: ID!, skillSlug: String!): SkillEvalScore!`
  → `{ skillSlug, datasetSlug, rated, passRate, regression, lastRunId, lastRunAt, totalCases }`
- Query `skillEvalGate(tenantId: ID!): SkillEvalGate!` → `{ enabled, threshold }`
- Query `flaggedTurnSkillCandidates(tenantId: ID!, threadId: ID!, turnId: ID!): SkillAttributionCandidates!`
  → `{ candidates: [{ skillSlug, source }], fallback }`
- Mutation `setSkillEvalGate(tenantId: ID!, threshold: Float): SkillEvalGate!`
- Mutation `applySkillUpdate(tenantId: ID!, skillSlug: String!, agentId: ID!, override: Boolean): SkillUpdateApplyResult!`
- Mutation `flagThreadForEval(input)` — input now includes `skillSlug`, `attributionFallback`
- On-demand run: `startEvalRun(tenantId, { datasetSlug: "skill-<slug>" })`

## Before any merge
1. **Apply migration `0166_eval_skill_gate.sql` to dev** (needs AWS-resolved DATABASE_URL —
   Eric's auth): `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0166_eval_skill_gate.sql`.
   The `deploy.yml` migration-precheck gate verifies the `-- creates:` markers post-apply.
2. **Validate the backend on dev**: install a skill with bundled `evals/*.json` → a
   `skill-<slug>` dataset appears (`evalDatasets`); a scored run executes against the
   eval-baseline agent (verify the invoked workspace has only that skill); `skillEvalScore`
   returns a pass rate; set a gate threshold + reinstall a worse candidate → swap held →
   `applySkillUpdate` blocks then overrides; flag a thread attributed to a skill → case
   lands in `skill-<slug>` and a re-run includes it.
3. **PR(s) to main** after Eric's validation pass.

## v1 limitations / deferrals (documented, not bugs)
- **Batch install**: only the first skill's scored run launches; the rest hit the in-flight
  gate (`EvalBaselineBusyError` → "busy", run marked failed) and stay unrated until a later
  run. Single-skill install/update (the common case) works fully.
- **Baseline pinning**: the run records `model` + `dataset_version`; full built-in-set
  pinning is a deferred refinement (regression compares same-scoring-version runs only).
- Plan Scope Boundaries (still deferred): self-improving updater, continuous/scheduled +
  on-model-change runs, in-context evals (vs the tenant's real configured agent), per-skill
  gate thresholds (v1 is per-tenant), scoring skills that depend on a companion skill.

## Resume tips
- Worktree deps are installed (`pnpm install --frozen-lockfile` was run). Web dev needs the
  ignored env: `cp /Users/ericodom/Projects/thinkwork/apps/web/.env apps/web/.env` and bind
  to a Cognito-allowed port (5175/5180).
- Prettier: `node node_modules/.pnpm/prettier@*/node_modules/prettier/bin/prettier.cjs --write <files>`.
- The flag dialog + skills detail are the highest-value visual checks; iterate with Eric on dev.
