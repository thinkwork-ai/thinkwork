---
title: "fix: merge legacy Hindsight banks into user-scoped memory and rebuild wiki"
type: fix
status: active
date: 2026-04-26
origin:
  - docs/plans/2026-04-24-001-refactor-user-scope-memory-and-hindsight-ingest-plan.md
  - docs/plans/2026-04-26-006-fix-user-scoped-memory-drift-plan.md
---

# fix: merge legacy Hindsight banks into user-scoped memory and rebuild wiki

## Overview

The user-scoped memory/wiki migration changed Thinkwork's API, UI, and wiki tables to address users by `userId`, and new Hindsight writes now land in `user_<userId>` banks. Historical Hindsight data was not migrated with that change. The result is a split-brain store: new rows exist in the user bank, while most existing rows still live in legacy agent/name banks such as `fleet-caterpillar-456`, `earnest-falcon-947`, and `resilient-otter-384`.

This plan replaces the earlier "wipe Hindsight and rebuild from journals/messages" assumption with a merge migration:

1. Keep canonical Hindsight memory.
2. Merge mapped legacy banks into `user_<userId>` banks without overwriting rows already landing there.
3. Keep read-side dual-bank compatibility until post-migration counts prove the legacy banks are empty or unused.
4. Wipe only derived wiki rows/cursors/jobs, then run the wiki rebuild pipeline until compile work is drained.

## Problem Frame

The web and mobile memory/wiki UIs are now user-id keyed. That part is correct. The empty/near-empty tables happened because the canonical Hindsight rows were still keyed by old bank ids while the GraphQL layer read only `user_<userId>`.

Live dev evidence on 2026-04-26:

- Marco has `2388` rows in legacy bank `fleet-caterpillar-456` and `18` rows in `user_4dee701a-c17b-46fe-9f38-a333d4c3fad0`.
- Cruz has `86` rows in legacy bank `earnest-falcon-947` and `0` rows in `user_84381488-f071-7073-6bc7-d6238c147538`.
- GiGi has `18` rows in legacy bank `resilient-otter-384` and `0` rows in `user_0488f468-4071-70b0-e0a4-a639373999a0`.
- Loki has legacy rows under the historical name bank `loki`, while the current agent slug is different.
- Large unmapped banks such as `atlas` must be reported but not automatically moved.

The repair has two state classes:

- **Canonical:** Hindsight memory, entities, documents, chunks, links, and related bank-keyed rows. These must be preserved and merged.
- **Derived:** `wiki_*` rows and compile cursors/jobs. These may be wiped and rebuilt from Hindsight after the bank merge.

## Requirements Trace

- R1. Do not wipe or truncate Hindsight memory data.
- R2. Migrate/merge legacy Hindsight banks into `user_<userId>` destinations, preserving rows already present in destination banks.
- R3. Keep dual-read compatibility in the Hindsight adapter until verification shows legacy banks are empty or unused.
- R4. Wipe only derived wiki rows, compile cursors, and rebuild-oriented compile jobs for affected user scopes.
- R5. Rebuild wiki pages from canonical Hindsight rows until no pending continuation work remains.
- R6. Audit and migrate all Hindsight tables with a `bank_id` column, not only `hindsight.memory_units`.
- R7. Provide dry-run counts, conflict reports, and post-apply verification before any destructive source-bank cleanup.
- R8. Report unmapped banks separately and leave them untouched unless they receive an explicit mapping.
- R9. Preserve deployment discipline: GraphQL/API code changes ship through PR; no direct GraphQL Lambda code update.
- R10. Validate web and mobile UIs against a dev server/simulator after data is visible: memory table, memory graph, wiki table, and wiki graph.

## Scope Boundaries

**In scope:**

- Hindsight legacy-bank discovery and mapping from `agents.human_pair_id`.
- A guarded migration/audit tool for Hindsight bank merges.
- Read-side compatibility in `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`.
- Tests covering legacy+user reads and migration conflict behavior.
- Wiki derived-state wipe and rebuild orchestration for user scopes.
- Admin web and iOS simulator validation that force graphs and tables contain data.

**Out of scope:**

- Wiping Hindsight memory.
- Reconstructing Hindsight from `messages`, `journal`, or workspace markdown as the primary repair path.
- Automatically moving unmapped banks such as `atlas`.
- Removing dual-read compatibility in this PR.
- Changing the user-scoped GraphQL schema shape again.
- Directly updating deployed GraphQL Lambda code outside the normal PR/deploy path.

## Context & Research

### Relevant Code and Patterns

- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts` maps user owners to `user_<userId>` and is the right bridge point for dual-read compatibility.
- `packages/api/src/graphql/resolvers/memory/memoryRecords.query.ts`, `memoryGraph.query.ts`, and wiki resolvers already speak `userId` at the GraphQL boundary.
- `packages/api/src/lib/wiki/repository.ts` owns `countWikiScope` and `wipeWikiScope`; its comment explicitly states canonical Hindsight is not touched.
- `packages/api/scripts/wiki-wipe-and-rebuild.ts` is an existing operator script for derived wiki wipe/rebuild, but it needs user-scoped wording and drained-continuation verification.
- `packages/api/src/lib/wiki/compiler.ts` runs compile batches and enqueues continuations when the cursor has more changed Hindsight rows to process.
- `packages/database-pg/drizzle/0036_user_scoped_memory_wiki.sql` moved wiki ownership to users and intentionally truncates rebuildable wiki rows during first FK transition.
- Hindsight bank-keyed tables observed in dev include `hindsight.async_operations`, `hindsight.audit_log`, `hindsight.banks`, `hindsight.chunks`, `hindsight.directives`, `hindsight.documents`, `hindsight.entities`, `hindsight.memory_links`, `hindsight.memory_units`, `hindsight.mental_models`, and `hindsight.webhooks`.

### Constraints From Current Schema

- `hindsight.documents` has primary key `(id, bank_id)`.
- `hindsight.memory_units` references `(document_id, bank_id)` in `hindsight.documents`, so documents and units must move consistently.
- `hindsight.entities` has a per-bank unique index on `(bank_id, lower(canonical_name))`, so duplicate canonical entities must be merged rather than blindly re-keyed.
- `hindsight.memory_links` carries `bank_id` and can duplicate when source/target rows are merged.
- `hindsight.chunks.chunk_id` is globally keyed, so chunk conflicts should be treated as an abort/report condition unless content is identical.

### Institutional Learnings

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` reinforces that manual state changes need explicit, checkable drift reporting.
- `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md` warns against silent `ON CONFLICT DO NOTHING` drops. This applies directly to entity/link merge operations and wiki rebuild continuation jobs.
- `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md` requires explicit `user_id` and tenant binding for user-scoped reads/writes.

## Key Technical Decisions

1. **Canonical Hindsight data is preserved.** The merge tool must not delete source memory rows until destination counts and referential checks pass. The first implementation can leave empty/old bank records in place after moving rows; source bank cleanup is a separate, explicit cleanup mode.
2. **Writes stay strict, reads stay compatible.** New retains continue writing only to `user_<userId>`. Reads inspect `user_<userId>` plus mapped legacy banks until migration proof says compatibility can be removed.
3. **Prefer an operator script over an ad hoc SQL paste.** The merge needs mapping, dry-run, conflict reporting, transactions, and repeatable verification. A checked-in script gives us those guardrails.
4. **Use explicit mappings derived from agents, with override support.** The default mapping is `agents.human_pair_id -> user_<human_pair_id>` and candidate legacy banks are `agents.slug`, slugified `agents.name`, `agents.id`, and `user_<agents.id>`. Historical aliases like `loki` can be supplied through a small override file or CLI flag.
5. **Abort on ambiguous conflicts.** If a destination row with the same primary key differs materially from the source row, the script reports and stops in dry-run/apply. It should not synthesize replacement IDs because Hindsight relationships depend on stable IDs.
6. **Entity duplicates are merged by canonical name.** When source and destination contain the same canonical entity name, references move to the destination entity, counts/metadata are combined conservatively, duplicate links are deduped, and the source duplicate is deleted before remaining source entities are re-keyed.
7. **Wiki rows are derived and disposable.** After Hindsight banks are merged, use `wipeWikiScope`/cursor reset for each affected `(tenantId, userId)` and rebuild until compile jobs stop creating pending continuations.
8. **Unmapped banks are evidence, not targets.** Banks without a high-confidence user mapping are listed with counts and left untouched.

## Implementation Units

- U1. **Add Hindsight bank audit and mapping utility**

**Goal:** Produce a dry-run report that shows source legacy banks, destination user banks, row counts by table, conflicts, and unmapped banks.

**Requirements:** R1, R2, R6, R7, R8.

**Dependencies:** None.

**Files:**
- Add: `packages/api/scripts/hindsight-bank-merge.ts`
- Add: `packages/api/src/lib/memory/hindsight-bank-merge.ts`
- Add: `packages/api/src/lib/memory/hindsight-bank-merge.test.ts`

**Approach:**
- Query `agents` for user-owned agents with `human_pair_id`.
- Build destination bank ids as `user_<human_pair_id>`.
- Build candidate legacy bank ids from agent slug, slugified agent name, agent id, and `user_<agent.id>`.
- Accept optional explicit alias mappings for known historical names.
- Count rows by `bank_id` in every observed Hindsight table with a `bank_id` column.
- Count destination-bank rows separately so preserving new rows is visible.
- Detect conflicts in `documents`, `chunks`, `entities`, `memory_units`, and `memory_links`.
- Report unmapped non-empty banks, including large banks such as `atlas`.

**Test scenarios:**
- A user with both `fleet-caterpillar-456` and `user_<userId>` rows reports both counts.
- A historical alias override maps `loki` to Loki's `user_<userId>` destination.
- A non-empty `atlas` bank appears in `unmapped` and is not included in apply operations.
- Duplicate `entities` by canonical name are classified as mergeable conflicts.
- A same-id `documents` conflict with different content is classified as blocking.

- U2. **Implement guarded Hindsight bank merge apply mode**

**Goal:** Move mergeable legacy-bank data into destination user banks while preserving new destination rows and Hindsight relationships.

**Requirements:** R1, R2, R6, R7, R8.

**Dependencies:** U1.

**Files:**
- Modify: `packages/api/src/lib/memory/hindsight-bank-merge.ts`
- Modify: `packages/api/scripts/hindsight-bank-merge.ts`
- Modify: `packages/api/src/lib/memory/hindsight-bank-merge.test.ts`

**Approach:**
- Default to dry-run; require an explicit `--apply` flag for mutations.
- Run each source→destination bank pair inside a transaction with a scoped advisory lock.
- Ensure the destination bank row exists before moving dependent rows.
- Merge duplicate destination/source entities by normalized canonical name, redirecting references before deleting source duplicates.
- Merge or re-key documents before moving memory units so `(document_id, bank_id)` FKs remain valid.
- Re-key memory units, chunks, directives, mental models, webhooks, async operations, audit rows, and other bank-keyed support tables after conflicts are resolved.
- Deduplicate memory links after references move.
- Leave source bank metadata in place unless a later cleanup mode proves all source-bank table counts are zero.
- Re-running apply mode should be idempotent: second run reports zero source rows to move and no conflicts.

**Test scenarios:**
- Apply mode preserves pre-existing destination `memory_units` and moves source units.
- Entity duplicate merge redirects `unit_entities` and `memory_links` to the destination entity.
- Identical document conflicts are merged safely; non-identical document conflicts abort.
- Source-bank support rows re-key with the same transaction as memory units.
- Re-running the migration after success is a no-op.

- U3. **Keep dual-read Hindsight adapter compatibility**

**Goal:** Make GraphQL/UI reads usable before, during, and after the merge without changing write behavior.

**Requirements:** R2, R3, R10.

**Dependencies:** None.

**Files:**
- Modify: `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`
- Add/modify: `packages/api/src/lib/memory/adapters/hindsight-adapter.test.ts`

**Approach:**
- Resolve `user_<userId>` as the primary write bank.
- For read paths (`recall`, `inspect`, `export`, `listRecordsUpdatedSince`), also include mapped legacy banks derived from user-owned agents.
- Deduplicate by memory record id.
- Preserve each record's actual source `bank_id` in metadata for audit visibility.
- Keep this compatibility code after the bank merge; remove only in a later PR after operational counts prove source legacy banks are empty or no longer queried.

**Test scenarios:**
- `inspect` returns rows from both destination and legacy banks.
- `listRecordsUpdatedSince` returns legacy rows so the wiki cursor can rebuild before the merge is complete.
- `recall` queries all mapped banks and dedupes duplicate ids by score.
- Write paths still use only `user_<userId>`.

- U4. **Upgrade wiki wipe/rebuild orchestration for user scopes**

**Goal:** Wipe derived wiki state only, then rebuild each affected user scope until no compile continuation work remains.

**Requirements:** R4, R5, R10.

**Dependencies:** U2 or U3. U3 allows emergency rebuild before U2, but final verification should run after U2.

**Files:**
- Modify: `packages/api/scripts/wiki-wipe-and-rebuild.ts`
- Add: `packages/api/src/lib/wiki/rebuild-runner.ts`
- Add/modify: wiki rebuild tests under `packages/api/src/__tests__/`

**Approach:**
- Keep `wipeWikiScope` as the only deletion path; it deletes wiki rows/cursors/jobs and never touches Hindsight.
- Update CLI wording from agent-oriented `--owner` help text to user scope.
- Add a `--drain` mode that runs/observes compile jobs until no pending/running jobs remain for the scope and the cursor is current.
- Ensure failed compile jobs surface with errors instead of looking like an empty graph.
- Print before/after counts for pages, sections, links, unresolved mentions, compile jobs, and cursor state.

**Test scenarios:**
- Dry-run prints counts and mutates no rows.
- Wipe deletes only `wiki_*` rows for the requested `(tenantId, ownerId)`.
- Drain mode follows continuation jobs until the queue is empty.
- A failed continuation returns non-zero and includes the failing job id.

- U5. **Run migration/rebuild verification and UI validation**

**Goal:** Prove the data is visible in GraphQL, admin web, and mobile iOS after the merge/rebuild.

**Requirements:** R7, R10.

**Dependencies:** U1-U4.

**Files:**
- Modify: this plan status when complete.
- Optional: PR notes only; no product code unless validation exposes a UI bug.

**Approach:**
- Run Hindsight merge dry-run and capture source/destination counts.
- Apply only the mapped bank merges after the dry-run has no blocking conflicts.
- Re-run the audit and verify source legacy row counts are zero or explicitly explain any rows left behind.
- Wipe/rebuild wiki for affected users and drain jobs.
- Query GraphQL for `memoryRecords`, `memoryGraph`, `recentWikiPages`, and `wikiGraph`.
- Validate admin web on the local dev server and iOS simulator through the mobile app.

**Test scenarios:**
- Marco's destination bank includes the pre-existing `18` new rows plus migrated legacy rows.
- Cruz and GiGi destination banks become non-empty.
- Unmapped `atlas` remains untouched.
- Admin memory graph/table and wiki graph/table show non-empty data.
- Mobile memory list and wiki graph/table show non-empty data in the iOS simulator.

## System-Wide Impact

- **GraphQL/API:** Read behavior broadens temporarily across mapped banks; write behavior remains user-bank-only.
- **Hindsight:** Canonical external-store rows are merged in place. This is the highest-risk state mutation and requires dry-run/apply separation.
- **Wiki:** Derived tables are wiped and rebuilt. This is expected and reversible from Hindsight.
- **Admin/mobile:** No schema change expected; validation confirms the existing user-id keyed clients see data.
- **Operations:** Adds repeatable audit/merge tooling and creates an evidence trail for when dual-read compatibility can later be removed.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Incorrect bank mapping moves another user's memory. | Derive mappings from `agents.human_pair_id` and tenant, require explicit alias overrides for historical names, and report unmapped banks instead of guessing. |
| Destination already has new rows. | Merge into destination, never truncate it; dry-run reports destination counts before apply. |
| Entity/document conflicts corrupt relationships. | Classify conflicts first; merge only known-safe duplicates; abort on non-identical blocking conflicts. |
| New memory writes land during migration. | Writes already target destination bank; source→destination migration preserves destination rows. Use per-bank advisory locks for script idempotence. |
| Wiki rebuild stops after one batch. | Add drain mode/verification for pending continuation jobs and cursor progress. |
| Compatibility code hides incomplete migration forever. | Keep source-bank count reports in the PR and require a later removal PR only after counts prove legacy banks are empty or unused. |

## Verification Checklist

- `pnpm --filter @thinkwork/api exec vitest run packages/api/src/lib/memory/adapters/hindsight-adapter.test.ts`
- `pnpm --filter @thinkwork/api exec vitest run packages/api/src/lib/memory/hindsight-bank-merge.test.ts`
- `pnpm --filter @thinkwork/api exec tsc --noEmit --pretty false`
- Hindsight merge dry-run report saved in PR notes.
- Hindsight merge post-apply report shows preserved destination rows and migrated legacy rows.
- Wiki wipe/rebuild drain exits with no pending/running jobs for affected users.
- GraphQL local queries return non-empty `memoryRecords`, `memoryGraph`, `recentWikiPages`, and `wikiGraph`.
- Admin web validation covers `/memory?view=table`, `/memory?view=graph`, `/wiki?view=table`, and `/wiki?view=graph`.
- Mobile iOS simulator validation covers memory list/table and wiki graph/table.

## Completion Criteria

- Legacy mapped Hindsight banks are merged into `user_<userId>` without wiping Hindsight memory.
- New rows already in user banks are still present after migration.
- Derived wiki rows have been wiped and rebuilt from canonical memory.
- Web and mobile surfaces show force graphs and tables with data.
- Dual-read compatibility remains in source control with a documented future-removal condition.
