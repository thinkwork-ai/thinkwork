---
title: "fix: unblock user-scoped memory migration drift"
type: fix
status: completed
date: 2026-04-26
---

# fix: unblock user-scoped memory migration drift

## Overview

Fix the deploy blocker caused by dev missing the hand-rolled objects declared in `packages/database-pg/drizzle/0036_user_scoped_memory_wiki.sql`. The deploy gate is working as designed: the migration file is outside Drizzle's journal, declares `creates` markers, and the Migration Drift Check fails until those objects exist in the target database.

This slice has two parts:

1. Harden the manual SQL so re-running it after the first apply does not repeatedly truncate rebuilt wiki data.
2. Apply the migration to dev and verify `pnpm db:migrate-manual` reports clean for `0036_user_scoped_memory_wiki.sql`.

---

## Problem Frame

The main deploy that included the mobile HITL docs reached the docs deploy step successfully, but the overall deploy workflow failed at `Migration Drift Check`. The failing objects were all from `0036_user_scoped_memory_wiki.sql`:

- `public.threads.user_id`
- `public.users.wiki_compile_external_enabled`
- `public.idx_threads_tenant_user`
- `public.threads_user_id_users_id_fk`
- `public.wiki_pages_owner_id_users_id_fk`
- `public.wiki_unresolved_mentions_owner_id_users_id_fk`
- `public.wiki_compile_jobs_owner_id_users_id_fk`
- `public.wiki_compile_cursors_owner_id_users_id_fk`
- `public.wiki_places_owner_id_users_id_fk`

The missing-object report means the manual migration was not applied to dev after PR #615 merged. Applying the migration is the deploy unblocker. However, the current SQL unconditionally truncates rebuildable wiki tables every time it runs. The migration is intended to be recoverable, and future operators may re-run it during drift recovery; repeated truncation after the FKs have already moved to users would delete rebuilt wiki data unnecessarily.

---

## Requirements Trace

- R1. Dev must contain every object declared by `0036_user_scoped_memory_wiki.sql` so the deploy drift gate passes.
- R2. The manual migration must remain safe to apply when the target objects are missing.
- R3. Re-running the migration after the target FKs already reference `users(id)` must not truncate wiki data again.
- R4. The migration must preserve the original safety check that refuses to backfill user-owned agent threads when `agents.human_pair_id` is missing.
- R5. Verification must include the drift reporter against dev, not only local SQL inspection.

---

## Scope Boundaries

- Do not change the user-scoped memory/wiki product behavior from PR #615.
- Do not change Drizzle journal state for this hand-rolled migration.
- Do not bypass the drift reporter or remove `creates` markers.
- Do not rebuild wiki pages in this slice; the compile pipeline can refill rebuildable wiki data after the schema transition.
- Do not alter unrelated missing/failing deploy jobs except insofar as the drift check is unblocked by this migration.

---

## Context & Research

### Relevant Code and Patterns

- `packages/database-pg/drizzle/0036_user_scoped_memory_wiki.sql` is the failing hand-rolled migration. It adds `threads.user_id`, adds `users.wiki_compile_external_enabled`, switches wiki `owner_id` FKs from `agents(id)` to `users(id)`, and truncates rebuildable wiki tables before the FK switch.
- `scripts/db-migrate-manual.sh` reports drift for unindexed `.sql` files by reading `-- creates:` and `-- creates-column:` markers, then probing `DATABASE_URL`.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` documents the manual migration drift workflow: apply with `psql "$DATABASE_URL" -f <file>`, then run the reporter.
- The failed deploy logs for run `24958312196` show `0036_user_scoped_memory_wiki.sql` as the only file with `MISSING` rows.
- `docs/plans/2026-04-26-003-feat-user-knowledge-reachability-and-pack-plan.md` depends on PR #615's user-scoped wiki ownership and assumes `owner_id = userId`.

### Institutional Learnings

- Manual migrations must have explicit markers so CI can fail loudly when dev is missing schema objects.
- Hand-rolled migrations should be idempotent where practical because the recovery path is a human re-running `psql -f`.

### External References

External research skipped. This is an internal Postgres migration recovery and drift-check workflow.

---

## Key Technical Decisions

- **Apply the existing migration, do not create a replacement migration.** The drift reporter already expects the objects from `0036_user_scoped_memory_wiki.sql`; creating a second file would leave the original still MISSING unless it was also applied.
- **Gate the destructive wiki truncate behind FK state.** The rebuildable wiki tables should be truncated only when at least one old `*_owner_id_agents_id_fk` constraint is still present and the user FK transition has not already completed.
- **Keep add/backfill operations idempotent.** `ADD COLUMN IF NOT EXISTS`, backfill-where-null, `DROP CONSTRAINT IF EXISTS`, and `CREATE INDEX IF NOT EXISTS` remain appropriate.
- **Use the existing dev DB resolution path.** Source `scripts/smoke/_env.sh` or the existing repo helper to populate `DATABASE_URL`, apply the SQL, then run `pnpm db:migrate-manual`.

---

## Open Questions

### Resolved During Planning

- Should this be fixed by editing CI? No. CI is correctly reporting that dev lacks the declared manual migration objects.
- Should we apply only the missing statements manually? No. The migration already encodes ordering and safety checks; apply the file after hardening it.
- Is this related to the mobile docs deploy? Only incidentally. The docs deploy step succeeded; this is an unrelated main deploy gate for PR #615's manual migration.

### Deferred to Implementation

- Exact SQL shape for detecting old agent-owned wiki FKs. Use `pg_constraint` against the known old constraint names, and keep the logic readable enough for future operators to audit.

---

## Implementation Units

- U1. **Harden the manual migration re-run behavior**

**Goal:** Preserve first-apply behavior while preventing repeated wiki truncation after the FK migration has already completed.

**Requirements:** R2, R3, R4.

**Dependencies:** None.

**Files:**
- Modify: `packages/database-pg/drizzle/0036_user_scoped_memory_wiki.sql`

**Approach:**
- Add a small PL/pgSQL block before dropping old wiki constraints that detects whether any old `*_owner_id_agents_id_fk` constraints still exist.
- Move the wiki-table `TRUNCATE` into that conditional block so it only happens on the first transition away from agent-owned FKs.
- Keep the old `DROP CONSTRAINT IF EXISTS` and new `ADD CONSTRAINT` operations idempotent.
- Update the migration header comment to describe the re-run behavior.

**Patterns to follow:**
- Existing safety-check `DO $$` block in the same migration.
- Existing marker convention in `scripts/db-migrate-manual.sh`.

**Test scenarios:**
- Happy path: on a DB where old wiki FKs still exist, the migration still truncates rebuildable wiki tables before switching FKs.
- Edge case: on a DB where the new user FKs already exist and old agent FKs are gone, the migration does not truncate wiki tables again.
- Error path: if user-owned agent threads cannot be backfilled because `agents.human_pair_id` is null, the migration still raises before schema mutation.

**Verification:**
- SQL review confirms the truncate is conditional and the declared markers remain intact.

---

- U2. **Apply and verify the migration in dev**

**Goal:** Bring dev into alignment with the hand-rolled migration markers so deploy drift check passes.

**Requirements:** R1, R5.

**Dependencies:** U1.

**Files:**
- Operational change only: dev Aurora schema

**Approach:**
- Resolve `DATABASE_URL` using the repo's existing dev environment helper.
- Run `psql "$DATABASE_URL" -f packages/database-pg/drizzle/0036_user_scoped_memory_wiki.sql`.
- Run `pnpm db:migrate-manual` against the same dev database.
- If drift remains, inspect only the remaining `0036_user_scoped_memory_wiki.sql` rows first; do not chase unrelated migrations unless they become the new blocker.

**Patterns to follow:**
- Header instructions in `0036_user_scoped_memory_wiki.sql`.
- Manual drift workflow in `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`.

**Test scenarios:**
- Happy path: every `0036_user_scoped_memory_wiki.sql` marker reports an existing object after apply.
- Integration: `pnpm db:migrate-manual` exits successfully against dev.
- Error path: if the migration refuses to backfill due missing `human_pair_id`, stop and report the blocker rather than forcing schema changes.

**Verification:**
- The manual migration exits 0.
- The drift reporter exits 0.

---

- U3. **Open a PR with the migration-hardening change**

**Goal:** Preserve the safer manual migration behavior in source control so future deploy/recovery runs are less destructive.

**Requirements:** R2, R3.

**Dependencies:** U1, U2.

**Files:**
- Modify: `docs/plans/2026-04-26-006-fix-user-scoped-memory-drift-plan.md`
- Modify: `packages/database-pg/drizzle/0036_user_scoped_memory_wiki.sql`

**Approach:**
- Mark this plan completed after U1 and U2 are verified.
- Commit the migration-hardening change and plan.
- Open a PR explaining that dev has already been repaired operationally and that the source diff hardens future re-runs.

**Patterns to follow:**
- Prior docs/plan PR descriptions with explicit testing and post-deploy validation sections.

**Test scenarios:**
- PR body includes the manual apply and drift reporter outputs.
- PR body calls out that no new schema objects are introduced beyond the existing migration markers.

**Verification:**
- PR opens against `main` with passing local validation notes.

---

## System-Wide Impact

- **Interaction graph:** Postgres schema only. The change affects manual migration recovery and the deploy drift gate.
- **Error propagation:** The existing SQL safety exception remains the stop condition for unbackfillable threads.
- **State lifecycle risks:** First application intentionally truncates rebuildable wiki tables before switching owner FKs; repeated applications should not re-truncate after the FK switch is complete.
- **API surface parity:** No GraphQL/API changes.
- **Integration coverage:** The real dev drift reporter is the integration check.
- **Unchanged invariants:** User-scoped wiki ownership remains `owner_id -> users(id)`; hand-rolled migration markers remain in place; Drizzle journal is unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Applying the migration truncates wiki data. | This is the intended first-apply behavior because the data is rebuildable and FKs must switch ownership safely. Harden re-runs to avoid repeated truncation. |
| The migration refuses to run due unassigned user-owned agent threads. | Stop and report the exact blocker; do not force nullable/cross-owner data. |
| Drift reporter still fails after apply. | Inspect remaining `0036` markers and query the object names directly; do not disable the gate. |
| Source PR lands after dev is already repaired. | That is acceptable: the PR hardens future recovery behavior and documents the operational repair. |

---

## Documentation / Operational Notes

- The PR should state that dev was repaired by applying `0036_user_scoped_memory_wiki.sql` manually.
- A follow-up deploy should be monitored until Migration Drift Check passes.

---

## Sources & References

- Failed deploy run: `24958312196`
- Migration file: `packages/database-pg/drizzle/0036_user_scoped_memory_wiki.sql`
- Drift reporter: `scripts/db-migrate-manual.sh`
- Manual migration workflow: `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
- Related plan: `docs/plans/2026-04-26-003-feat-user-knowledge-reachability-and-pack-plan.md`
