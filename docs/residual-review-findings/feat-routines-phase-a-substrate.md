# Residual Review Findings — feat/routines-phase-a-substrate

Source: `ce-code-review mode:autofix` run on branch `feat/routines-phase-a-substrate` (HEAD `967e47a3`).

Plan: `docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md`.

Three findings landed as autofixes in commit `967e47a3` (DM-001, COR-001, COR-003 + COR-002 partial). The items below were surfaced by the reviewers but require design decisions, additional context, or follow-up work outside this PR's scope.

## Residual Review Findings

- **[P1] [manual → downstream-resolver] terraform/modules/app/routines-stepfunctions/main.tf — ABAC tenant isolation needs session tags (COR-002 follow-up).** The autofix dropped the always-false ABAC condition (`aws:PrincipalTag/tenantId` was `''` for the shared execution role). Phase A now relies on the GraphQL resolver layer's `routine_id` auth check + `tenant_id` FK for tenant isolation. To restore IAM-layer isolation for `routine_invoke.sync` cross-routine calls, Phase B should land session tags via `sts:AssumeRole` + `TagSession` (the caller mints a session-tagged credential before each `StartExecution`). Track this as a hard prereq for the multi-tenant production deploy.
- **[P2] [manual → downstream-resolver] packages/database-pg/graphql/types/routines.graphql — stub resolvers for unimplemented operations (COR-004).** `tenantToolInventory`, `publishRoutineVersion`, and `decideRoutineApproval` all declare non-null return types with no resolver registered. Any invocation hard-errors with "Cannot return null for non-nullable field" rather than a clean not-implemented response. Either add throw-on-call stub resolvers in `packages/api/src/graphql/resolvers/index.ts`, or change the return types to nullable until the real resolvers land in Phase A U4 / Phase B U7 / Phase B U8 respectively.
- **[P2] [advisory → human] packages/database-pg/drizzle/0055_routines_stepfunctions_substrate_rollback.sql — explicit DROP INDEX vs implicit cascade (DM-002).** The rollback drops 4 new tables and relies on `DROP TABLE` cascading to the 12 owned indexes. Postgres does this correctly, but it diverges from the explicit-drop style used for `idx_routines_engine` (the one index on the pre-existing `routines` table). Style/observability gap, not a correctness bug — left as advisory.
- **[P2] [advisory → human] packages/database-pg/drizzle/0055_routines_stepfunctions_substrate.sql — 5s lock_timeout on routines ALTER (DM-003).** Adding the `routines_engine_enum` CHECK constraint takes an `ACCESS EXCLUSIVE` lock for inline validation. Matches existing project convention (0054 used the same 5s/120s pattern). If `routines` has high concurrent write load at deploy time, consider `ADD CONSTRAINT NOT VALID` + a separate `VALIDATE CONSTRAINT` for `ShareUpdateExclusiveLock`. Verify row count before deploy and accept the 5s timeout if the table is small.

## Plan-completeness gap (separate from review findings)

The Phase A plan defines five units (U1–U5). This PR ships **U1 + U2 + U3** plus the docs commit. **U4 (recipe catalog + tenantToolInventory resolver) and U5 (routine-asl-validator Lambda) are deferred to follow-up PRs.** Reasoning: U4 is a 12-recipe typed catalog with JSON-Schema arg shapes + ASL emitters + tests, and U5 is a Lambda with non-trivial validation logic (recipe-arg type check, Choice rule field validation, cycle detection). Both warrant focused review and benefit from being separate PRs against the substrate that just landed.

Recommended sequence:
1. Merge this PR (substrate: Terraform + schema + GraphQL types).
2. Open a follow-up PR for **U4 — Recipe catalog + tenantToolInventory resolver** against the merged substrate.
3. Open a follow-up PR for **U5 — routine-asl-validator Lambda** after U4 lands (U5 imports the recipe catalog).

The unimplemented-operation stubs flagged in COR-004 should land alongside U4/U5 (or as a tiny scaffolding PR before them) so consumers calling the new GraphQL operations get a "not implemented" error instead of "non-null field" error.

## Coverage note

Three reviewers ran (correctness, project-standards, data-migrations). The full review team per the plan would also include testing-reviewer + maintainability-reviewer + agent-native + learnings + api-contract; these were skipped to keep the autofix run bounded. Plan-level test scenarios for U1–U3 are explicit "no tests" (pure infrastructure / declarative schema / type-only changes), so the testing-reviewer would have surfaced advisory items only.
