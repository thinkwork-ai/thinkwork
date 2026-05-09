---
branch: feat/customize-skills-live
head_sha: 452b172d
review_run_id: 20260509-144123-91b6e4ab
review_artifact: /tmp/compound-engineering/ce-code-review/20260509-144123-91b6e4ab/
generated_at: 2026-05-09
---

# Residual Review Findings — feat/customize-skills-live

ce-code-review (autofix mode) produced these residual findings. The P1
duplicate-type concern (api-contract-1) was fixed in autofix; the items
below are P2/P3 follow-ups. When the PR opens, these should migrate
into the PR body.

## Source

- Plan: `docs/plans/2026-05-09-009-feat-customize-skills-live-plan.md`
- Reviewers: ce-correctness-reviewer, ce-security-reviewer,
  ce-api-contract-reviewer, ce-maintainability-reviewer,
  ce-kieran-typescript-reviewer, ce-testing-reviewer
- 1 P1 fixed in autofix; 6 P2 residuals; 4 P3 advisory
- Verdict: Ready with fixes

## Residual Actionable Work

### P2 — Moderate

- **#1 [P2][gated_auto]** `packages/database-pg/graphql/types/customize.graphql` — Cross-tab input field naming diverges within Customize (`EnableConnectorInput.slug` vs `EnableSkillInput.skillId`). **Suggested fix:** unify on one shape when U6 lands the workflow mutations — either rename connector input to `connectorSlug` or rename skill input to `slug`. Reviewer: api-contract.

- **#2 [P2][manual]** `packages/api/src/graphql/resolvers/customize/enableSkill.mutation.ts` — Auth + Computer-load preamble is now duplicated across 4 call sites (enableConnector / disableConnector / enableSkill / disableSkill). **Suggested fix:** extract `loadCallerComputer(ctx, computerId)` helper to `packages/api/src/graphql/resolvers/customize/shared.ts` once U6 brings the count to 6 call sites. Reviewer: maintainability.

- **#3 [P2][manual]** `apps/computer/src/components/customize/use-customize-mutations.ts` — `useSkillMutation` is a 70-line near-verbatim copy of `useConnectorMutation`. **Suggested fix:** extract `useToggleMutation<TInput>(enableMut, disableMut, typenames, errorCodeHandlers)` factory when U6 hits 3 toggles. Reviewer: maintainability.

- **#4 [P2][manual]** `packages/api/src/graphql/resolvers/customize/enableSkill.mutation.test.ts` — Mock-only unit tests; the `ON CONFLICT (agent_id, skill_id) DO UPDATE` upsert path has not been exercised against live Postgres. **Suggested fix:** add a live-Postgres integration test alongside the connector equivalent (PR #1078 residual #1). Reviewer: testing, kieran-typescript, correctness.

- **#5 [P2][manual]** `apps/computer/src/components/customize/use-customize-mutations.ts` — `useSkillMutation` has no unit test coverage. `BUILTIN_TOOL_HINT` routing on the `CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE` error code, and `pendingSlugs` cleanup on the error path, are unverified. (PR #1078 review left the same gap for `useConnectorMutation`.) **Suggested fix:** add component-level vitest with mocked urql client. Reviewer: testing.

- **#6 [P2][gated_auto]** `packages/database-pg/graphql/types/customize.graphql` — `disableSkill` returns `Boolean!` while existing toggles like `pauseConnector`/`resumeConnector` (and the `enableSkill` happy path) return the row. Same asymmetry the connector pair has. **Suggested fix:** return `AgentSkill!` (or a `Maybe<AgentSkill>`) for symmetry, deciding once for both the connector and skill pairs. Reviewer: api-contract.

### P3 — Low

- **#7 [P3][advisory]** `apps/computer/src/components/customize/use-customize-mutations.ts` — `UseToggleMutationResult.toggle` parameter is named `slug` but skill callers pass a `skillId`. Cosmetic; either rename to a neutral term (`id` / `key`) or accept the shape after the U6 unification.

- **#8 [P3][advisory]** Per-tab routing diverges: connectors short-circuits MCP client-side; skills relies on server rejection for built-ins. Both work; document the asymmetry in `customize-tab-handler` doc when extracted.

- **#9 [P3][advisory]** `packages/api/src/graphql/resolvers/customize/enableSkill.mutation.test.ts` — Built-in tool rejection only tested with `web-search`. `BUILTIN_TOOL_SLUGS` has 6 entries; consider parametrizing.

- **#10 [P3][advisory]** Apikey path against `enable/disableSkill` resolvers is not directly tested (unit tests stub `resolveCaller` as cognito). Same coverage gap as connector pair.

## Applied autofix (this run)

- `auto-1` **P1**: dropped `SkillBinding` GraphQL type, returned existing `AgentSkill` from `enableSkill` (eliminates duplicate projection).
- `auto-2` Test fixture extended with full `AgentSkill` columns + new idempotency test pins the `ON CONFLICT DO UPDATE` path.
- `auto-3` `disableSkill` carries explicit comment explaining why the no-primary-agent path returns `true` silently rather than throwing.
- `auto-4` `SKILL_TYPENAMES` drops the retired `"SkillBinding"` entry.

## Notes

`ce-correctness-reviewer` and `ce-security-reviewer` returned zero
findings. The pattern carryover from PR #1078 is clean; the P1 caught
here is the duplicate-type drift the connector PR's review didn't see
because there was no equivalent existing `Connector` GraphQL type to
collide with.
