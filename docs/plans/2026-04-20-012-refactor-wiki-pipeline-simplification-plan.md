---
title: "refactor: Wiki compile pipeline simplification (pre-aggregation-v2)"
type: refactor
status: active
date: 2026-04-20
origin: in-session adversarial review (architecture + simplicity agents, 2026-04-20)
---

# refactor: Wiki compile pipeline simplification (pre-aggregation-v2)

## Overview

Remove dead weight from the wiki compile pipeline before adding any new features. Two parallel adversarial reviews (simplicity + architecture) independently concluded that proposed cluster enrichment, an aggregation-applier module split, and a proposed body-prose alias sweep are all unjustified — and that several code paths already on `main` are unused. A subsequent plan-doc review narrowed this plan further: the original Units 3 (PlannerResult type split), 4 (link-backfill inline), and 5 (SQL GROUP BY collapse) were scope-cut because they refactor rather than delete, and none serves the stated deletion goal. They are documented as Deferred so the reasoning survives.

What's left is a tight 5-unit plan: pure deletions (Units 1–2), one small ops fix (`wipeWikiScope` FK, Unit 3), and two irreversible schema migrations (Units 4–5 — the `cluster` jsonb and `body_embedding` vector columns, each verified unused).

No product-visible behavior changes. Estimated reduction: ~180–230 lines of runtime TypeScript + ~25 schema lines, with two schema columns dropped.

## Problem Frame

The wiki compile pipeline shipped over ~20 PRs in the past week. Rapid iteration accumulated dead paths:

- Schema columns added in anticipation of features that never shipped (`wiki_unresolved_mentions.cluster`, `wiki_page_sections.body_embedding`)
- Code paths that emit output which is then explicitly filtered out (`tag_cluster` parent candidates → excluded from `TRUSTED_REASONS` in the linker)
- Hardcoded empty fields in LLM prompt input (`outboundSlugs: []` sent on every aggregation call, wasting tokens)
- An unused export (`emptyAggregationResult`) and an unused field on every section template (`placeholder`)
- An FK constraint (`wiki_unresolved_mentions.promoted_page_id_wiki_pages_id_fk`) that blocks `scripts/wiki-wipe-and-rebuild.ts` when any mention has been promoted — operator papercut, not a bug, but cheap to fix alongside the schema-migration PR

None of these block shipping. Together they obscure the actual pipeline. The user's goal — more links + better aggregation with a solid foundation — is better served by deleting first.

## Requirements Trace

- R1. Every deletion must be independently verified as unused (zero non-test readers/writers on `main`).
- R2. No product-visible structural behavior change: Marco/GiGi/Cruz compile output has identical page counts, link counts, and aggregation action types on a seeded rerun. LLM-generated prose may drift by a few tokens because Unit 1 removes an always-empty field (`outboundSlugs`) from the aggregation prompt, changing the input token sequence even though no information content changes. Pre/post prompt diffs should show only whitespace and empty-field token removal.
- R3. Full api test suite passes after each implementation unit.
- R4. Schema migrations are downgrade-safe (dropped columns contain zero non-NULL data verified via SQL before drop).
- R5. The plan resolves the adversarial agents' "red flags" without introducing new abstractions.

## Scope Boundaries

Explicit non-goals:

- **No new features.** This plan is deletion plus one small ops fix. Cluster enrichment, applier split, and body-prose sweep remain killed.
- **No behavior tuning.** No threshold changes, no prompt rewrites beyond removing always-empty fields.
- **No aggregation-applier refactor-by-file-move.** The 426-line `applyAggregationPlan` stays where it is. Any future split should be driven by a real feature that needs to touch one concern in isolation, not preemptive file churn.
- **No two-planner collapse, no PlannerResult type split.** Leaf vs. aggregation planner split stays. The shared `PlannerResult` shape with force-clear in `aggregation-planner.ts:279-281` stays too — the scope-guardian + adversarial reviewers argued the 100+ lines of churn doesn't pay for itself without a concrete incident motivating it. Revisit if that incident surfaces.
- **No `link-backfill.ts` inline.** The module stays. Adversarial review noted `wiki-lint.ts` is a deployed nightly Lambda that could plausibly become a second consumer (recurring backfill); inlining now risks un-inlining later.
- **No `computeLinkNeighborhoods` SQL collapse.** Replacing the correct N-query loop with a single `GROUP BY` is a performance refactor, not a deletion. Split out to a separate task if performance becomes measurably painful.
- **No metric pruning in this plan.** Several `wiki_compile_jobs.metrics` fields appear write-only, but verifying each against `packages/graphql`, `apps/admin`, `apps/mobile`, and CloudWatch-alarm terraform is its own sweep. Deferred entirely to a follow-up plan.

### Deferred to Separate Tasks

- **PlannerResult type split** (was Unit 3): dropped per review — 100+ LOC churn for a 3-line smell with no reported incident. Add when a real bug motivates it.
- **Link-backfill module inline** (was Unit 4): dropped per review — `wiki-lint` Lambda is a plausible 2nd consumer; inlining now risks rework.
- **computeLinkNeighborhoods SQL collapse** (was Unit 5): dropped per review — performance refactor, not a deletion. Ship separately if the N-query cost becomes measurable.
- **Cluster enrichment (Unit 6 of the original hierarchical-aggregation plan), applier split, body-prose sweep**: killed by adversarial review. The user-visible pain these targeted (GiGi linked% too low) is addressed instead by the Place capability brainstorm at `docs/brainstorms/2026-04-21-wiki-place-capability-requirements.md`, which uses structured journal-sourced `place_google_place_id` + lat/lon (85.9% coverage on GiGi) rather than LLM-inferred cluster promotion.
- **Backfill validation run** against Marco, GiGi, Cruz: **completed 2026-04-21.** Results: Marco at ceiling (389 → 389, 0 new edges, 67.8% linked% unchanged); GiGi near ceiling (1069 → 1081, +12 edges, 48.6% → 49.7%); Cruz at 100% linked% already. Current algorithms are efficient; the remaining gap needs a new signal (see Place brainstorm), not a re-run of existing emitters.
- **Revival gate for killed features**: the Place brainstorm supersedes the cluster-enrichment kill decision. No separate revival trigger is needed — structured place data is strictly better evidence than the re-deriving the same signal via LLM-authored mention clusters.

## Context & Research

### Relevant Code and Patterns

- `packages/api/src/lib/wiki/compiler.ts` — compile orchestration; `applyAggregationPlan` at line 1169 is 426 lines (not 1300 as claimed in `plans/2026-04-20-008-handoff-cluster-enrichment-and-applier-split.md`).
- `packages/api/src/lib/wiki/aggregation-planner.ts` — aggregation planner; force-clears `unresolvedMentions` and `promotions` on its own output at lines 280–281 (smell motivating Unit 3 here).
- `packages/api/src/lib/wiki/planner.ts` — leaf planner; owns `PlannerResult` today.
- `packages/api/src/lib/wiki/parent-expander.ts` — `tag_cluster` emitter at line 160.
- `packages/api/src/lib/wiki/deterministic-linker.ts` — `TRUSTED_REASONS = {"city","journal"}` at line 23 filters out `tag_cluster`.
- `packages/api/src/lib/wiki/link-backfill.ts` — 141-line callback-injection orchestrator used by one script + one test.
- `packages/api/src/lib/wiki/templates.ts` — `placeholder` field on 12 section templates, never read outside this file.
- `packages/database-pg/src/schema/wiki.ts:165` — `body_embedding: vector("body_embedding", 1024)`.
- `packages/database-pg/src/schema/wiki.ts:305` — `cluster: jsonb("cluster")`.

### Institutional Learnings

- `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md` — instruments before tuning; this plan is the instrumentation cleanup prerequisite.
- `docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md` — applies to mobile graph, not this plan; noted for awareness.

### Adversarial review findings (this session, 2026-04-20)

- **Simplicity reviewer**: identified 7 high-conviction deletions with file paths and LOC estimates. Pushed back on applier split (function is 426 lines, not 1300) and on any addition before stripping dead weight.
- **Architecture reviewer**: verdicted Unit 6 KILL (wiki_unresolved_mentions already enforces one-row-per-alias-family via unique index — the "cluster" the handoff proposes creating is semantically the same row that already exists), body-prose sweep KILL (`emitCoMentionLinks` is a strictly stronger signal), applier split DELAY.

Both reviews converged without cross-contamination. High confidence in deletion safety.

## Key Technical Decisions

- **Delete rather than refactor** where the reviewer identified dead paths. Refactoring dead code to "cleaner dead code" is zero-value work.
- **Two PRs, not one.** PR 1 bundles runtime-only changes (Units 1–3). PR 2 bundles schema migrations (Units 4–5). Separate review surfaces because schema migrations are irreversible and need per-environment verification.
- **Bundle `wipeWikiScope` FK fix into PR 2** (Unit 3), since it touches the same `wiki_unresolved_mentions` table as the cluster-column drop and the diff reviews cleanly together.
- **Do not consolidate metric `bump()` helper in this plan.** Simplicity reviewer noted `metrics.foo = (metrics.foo ?? 0) + 1` repeats ~20 times. A helper would be a clarifying simplification but it's a separate concern from deletion — deferred to avoid scope creep.

## Open Questions

### Resolved During Planning

- **Is `wiki_unresolved_mentions.cluster` column safe to drop?** Yes. Grep across `packages/api/src`, `packages/database-pg/src`, `packages/graphql/src`, `apps/` returned zero reads or writes in runtime code. Only hits were README noise unrelated to the column.
- **Is `body_embedding` column safe to drop?** Yes. Grep hits are schema definitions only — no writer, no reader, no consumer. Docs explicitly say "present but NULL in v1."
- **Is `emptyAggregationResult` truly unused?** Yes. Grep returned exactly one hit: its own `export` line in `aggregation-planner.ts:296`.
- **Does `outboundSlugs` field carry any signal?** No. Line 1153 hardcodes `outboundSlugs: []` on every row. The aggregation prompt at line 233 serializes the empty array into the LLM input, wasting tokens per job.
- **Is `tag_cluster` truly dead?** Yes. Emitted in `parent-expander.ts:160`, excluded from `TRUSTED_REASONS` in `deterministic-linker.ts:23`, never referenced downstream.
- **Is `link-backfill.ts` module used anywhere besides the script + test?** No. Exactly one import path: `scripts/wiki-link-backfill.ts:40` and the test file.
- **Is the pgvector extension still needed after dropping `body_embedding`?** Unknown without checking other tables. Drop column but keep the extension for now — extension removal is a separate coordination step.

### Deferred to Implementation

- **`wipeWikiScope` FK fix — exact transaction scope.** Whether to null `promoted_page_id` on all rows in scope, or only on promoted-then-archived rows, or to cascade-delete the unresolved-mention rows entirely. Planning-time choice for the implementer once they read the current wipe transaction.
- **Whether to drop `pgvector` extension in terraform.** If `body_embedding` was the only vector column, the extension can be removed; otherwise keep. Check after column drop — and defer actual removal to a separate terraform ticket regardless.

## Implementation Units

- [ ] **Unit 1: Delete unused exports, unused template fields, and always-empty prompt data**

**Goal:** Remove code and data whose only effect is clutter. Zero-risk deletions; each item independently verified.

**Requirements:** R1, R3

**Dependencies:** None.

**Files:**
- Modify: `packages/api/src/lib/wiki/aggregation-planner.ts` (remove `emptyAggregationResult` export at line 296; remove `outboundSlugs` from `AggregationLinkNeighborhood` interface at line 64; remove from prompt serialization at line 233)
- Modify: `packages/api/src/lib/wiki/compiler.ts` (remove `outboundSlugs` from `computeLinkNeighborhoods` return type at lines 1128–1144 and the empty-array literal at line 1153; the inbound-counting loop stays as-is — Unit 5 is a separate decision about whether to rewrite that loop)
- Modify: `packages/api/src/lib/wiki/templates.ts` (remove the `placeholder` field from the section template shape and from all 12 section definitions at lines 43–130)
- Test: `packages/api/src/__tests__/wiki-aggregation-planner.test.ts` (if it references removed fields)
- Test: `packages/api/src/__tests__/wiki-templates.test.ts` (if exists and references `placeholder`)

**Approach:**
- Single commit, mechanical deletions.
- Run the full api test suite; fix any test that references removed fields by deleting the irrelevant assertions (not by restoring the fields).

**Patterns to follow:**
- Existing `AggregationLinkNeighborhood` interface shape in `aggregation-planner.ts`.

**Test scenarios:**
- Integration: after the unit, a full compile job against a seeded scope produces the same page count and link count as before (spot-check on existing `wiki-compiler.test.ts` fixtures).
- No new tests; this is pure deletion and the existing suite is the regression surface.

**Verification:**
- `pnpm --filter @thinkwork/api test` passes.
- Grep confirms `emptyAggregationResult`, `outboundSlugs`, `placeholder:` produce zero hits across `packages/api/src` (non-test).

---

- [ ] **Unit 2: Remove `tag_cluster` parent-candidate emission**

**Goal:** Delete the emitter-plus-filter pattern where `parent-expander.ts` produces `tag_cluster` candidates that `deterministic-linker.ts` explicitly discards. Dead path.

**Requirements:** R1, R3

**Dependencies:** None.

**Files:**
- Modify: `packages/api/src/lib/wiki/parent-expander.ts` (remove `"tag_cluster"` from `ParentCandidateReason` union at line 20; delete the tag-cluster generator block at lines 153–167)
- Modify: `packages/api/src/lib/wiki/deterministic-linker.ts` (remove `TRUSTED_REASONS` filter if it collapses to a single allowed reason, or keep as documentation — implementer's call)
- Modify: `packages/api/src/__tests__/wiki-parent-expander.test.ts` (remove tag_cluster test cases)
- Modify: `packages/api/src/__tests__/wiki-deterministic-linker.test.ts` (remove "filtered as untrusted" cases if present)

**Approach:**
- Single commit, mechanical removal. The union narrows from `"city" | "journal" | "tag_cluster"` to `"city" | "journal"`.
- Grep for `"tag_cluster"` and `tag_cluster` (both forms) to confirm zero residual references.
- If the aggregation planner prompt mentions tag-based hubs as input context, that prose can stay — the prompt is about LLM guidance, not about the deterministic extractor's output.

**Patterns to follow:**
- Existing narrow-a-union pattern from similar deletions in the repo.

**Test scenarios:**
- Edge case: with a scope whose records share tags but no city or journal metadata, the compile produces zero deterministic parent candidates from tags (previously it would emit then immediately discard them; now it never emits).
- Happy path: existing city/journal parent-linking behavior on Marco-style data unchanged.

**Verification:**
- Grep for `tag_cluster` across `packages/api/src` returns zero hits (non-test, non-doc).
- `pnpm --filter @thinkwork/api test` passes.

---

- [ ] **Unit 3: Fix `wipeWikiScope` FK constraint on promoted mentions**

**Goal:** Unblock `scripts/wiki-wipe-and-rebuild.ts` for scopes where any `wiki_unresolved_mentions.promoted_page_id` is set. Today the FK to `wiki_pages` blocks the page delete; the operator workaround has been `DELETE FROM wiki_unresolved_mentions WHERE owner_id = X` before the wipe. This ships the fix inside `wipeWikiScope`'s existing transaction.

**Requirements:** R1, R3

**Dependencies:** None. Can land before or alongside Unit 4 (cluster column drop) — they touch the same table and PR reviews cleanly together.

**Files:**
- Modify: `packages/api/src/lib/wiki/repository.ts` (add a pre-archive step inside `wipeWikiScope`'s transaction that nulls `promoted_page_id` on `wiki_unresolved_mentions` rows for the scope — or cascade-deletes them, planning-time choice; see Deferred to Implementation)
- Modify: `packages/api/src/__tests__/wiki-repository-wipe.test.ts` (if it exists; otherwise extend the nearest wipe test to cover the promoted-mention case)

**Approach:**
- Read the current `wipeWikiScope` transaction first. Add the null-or-delete step BEFORE the page archive so the FK cascade doesn't block.
- Prefer `UPDATE ... SET promoted_page_id = NULL` over `DELETE` unless the planning-time choice goes the other way — preserving the mention row keeps the alias history for any future re-promote.
- Same transaction boundary as the existing wipe — do not introduce a new transaction.

**Patterns to follow:**
- Existing transaction pattern in `repository.ts::wipeWikiScope`.

**Test scenarios:**
- Happy path: scope with N pages, K of them referenced as `promoted_page_id` by unresolved mentions — wipe completes cleanly, FK doesn't fire.
- Edge case: scope with no promoted mentions — wipe behavior unchanged.
- Error path: wipe inside a transaction that rolls back (simulated) leaves both tables in original state.

**Verification:**
- Running `scripts/wiki-wipe-and-rebuild.ts` against a dev scope with promoted mentions completes without manual pre-delete step.
- Full api test suite passes.

---

- [ ] **Unit 4: Drop `wiki_unresolved_mentions.cluster` jsonb column**

**Goal:** Delete the schema slot that was added in anticipation of cluster enrichment, which the adversarial review killed (and which the Place capability supersedes — see `docs/brainstorms/2026-04-21-wiki-place-capability-requirements.md`).

**Requirements:** R1, R4

**Dependencies:** Units 1–3 merged (separate PR).

**Files:**
- Create: `packages/database-pg/drizzle/NNNN_drop_wiki_unresolved_mentions_cluster.sql` (new migration — `ALTER TABLE wiki_unresolved_mentions DROP COLUMN cluster;`)
- Modify: `packages/database-pg/src/schema/wiki.ts` (remove `cluster: jsonb("cluster")` at line 305 and the multi-line doc comment at lines 298–304)
- Modify: `packages/database-pg/drizzle/meta/_journal.json` and the new snapshot (drizzle-generated; run `pnpm --filter @thinkwork/database-pg db:generate`)

**Approach:**
- Pre-flight: run `SELECT count(*) FROM wiki_unresolved_mentions WHERE cluster IS NOT NULL;` against each environment (dev, then prod) before applying. If zero, proceed. If nonzero, investigate — nothing should be writing, but confirm before drop.
- Migration SQL uses `ALTER TABLE wiki_unresolved_mentions DROP COLUMN IF EXISTS cluster;` matching the existing drop-column precedent at `packages/database-pg/drizzle/0013_motionless_white_queen.sql:138-140`.
- **Close the TOCTOU gap inside the migration transaction**: include a `DO $$ BEGIN IF (SELECT count(*) FROM wiki_unresolved_mentions WHERE cluster IS NOT NULL) > 0 THEN RAISE EXCEPTION 'cluster column contains data; aborting drop'; END IF; END $$;` prelude before the `DROP COLUMN`. This prevents a concurrent writer between pre-flight time and migration-apply time from silently losing data.
- Single-commit migration with a clear name. No backfill needed — column is always NULL.
- Update schema + regenerate snapshot. Verify the generated migration matches the intended SQL.

**Execution note:** Run the pre-flight SQL against both dev and prod before adding the migration file. Do not assume zero. Confirm no in-flight worktree or PR proposes to populate `cluster` (the handoff at `plans/2026-04-20-008-handoff-cluster-enrichment-and-applier-split.md` is superseded by this plan and should not be revived without a new plan).

**Patterns to follow:**
- `packages/database-pg/drizzle/0013_motionless_white_queen.sql:138-140` — only prior `DROP COLUMN IF EXISTS` migration in this package. Match its `--> statement-breakpoint` separator and inline-comment style.

**Test scenarios:**
- Error path: verify schema tests or type-checks fail loudly if any code still references `cluster` (catches regression).
- Integration: migration runs cleanly in dev; `wiki_unresolved_mentions` row inserts and reads succeed post-migration.

**Verification:**
- Pre-flight query returns 0 against dev AND prod (not just dev).
- In-migration transaction guard passes (no `RAISE EXCEPTION` fired).
- Migration applied to dev without error; one full compile cycle runs post-migration without `column "cluster" does not exist` errors in CloudWatch.
- Only after dev confirmation, apply to prod with the same pre-flight + transaction guard.
- Grep for `\.cluster\b` and `"cluster"` in `packages/api/src/lib/wiki` and `packages/database-pg/src/schema` returns zero hits for the column (unrelated `cluster` string matches in URLs or docs are fine).
- Full api test suite passes.

---

- [ ] **Unit 5: Drop `wiki_page_sections.body_embedding` column**

**Goal:** Remove the pgvector column that was added pre-emptively and never populated.

**Requirements:** R1, R4

**Dependencies:** Units 1–3 merged. Ships in the same PR as Unit 4 (both schema migrations).

**Files:**
- Create: `packages/database-pg/drizzle/NNNN_drop_wiki_page_sections_body_embedding.sql` (new migration — `ALTER TABLE wiki_page_sections DROP COLUMN body_embedding;`)
- Modify: `packages/database-pg/src/schema/wiki.ts` (remove `body_embedding: vector("body_embedding", 1024)` at line 165; remove the local `vector` customType helper at lines 49–63 and its preceding comment block at lines 42–47 — `vector` is not an import, it's a `customType` defined in-file. Grep confirms `body_embedding` is the only column using it.)
- Modify: `packages/database-pg/drizzle/meta/_journal.json` and snapshot (drizzle-generated)

**Approach:**
- Pre-flight: `SELECT count(*) FROM wiki_page_sections WHERE body_embedding IS NOT NULL;` → expect 0. Run against each environment (dev, then prod) before applying.
- Migration SQL uses `ALTER TABLE wiki_page_sections DROP COLUMN IF EXISTS body_embedding;` matching the existing precedent.
- **Close the TOCTOU gap inside the migration transaction**: include a `DO $$ BEGIN IF (SELECT count(*) FROM wiki_page_sections WHERE body_embedding IS NOT NULL) > 0 THEN RAISE EXCEPTION 'body_embedding column contains data; aborting drop'; END IF; END $$;` prelude before the `DROP COLUMN`.
- Grep confirms `body_embedding` is the only column using the local `vector` customType. Remove the customType declaration at `schema/wiki.ts:49-63` plus the preceding comment block at lines 42–47 in the same commit.
- **Do not** touch the pgvector extension install. Extension removal requires terraform coordination across environments and is a separable concern.
- Leave the migration-0013 historical doc comment as-is (it accurately describes what that migration did; rewriting historical migration comments muddies the archaeological trail).

**Execution note:** Defer the pgvector extension removal itself to a separate ticket. Dropping a column does not require removing the extension; the two are separable.

**Patterns to follow:**
- `packages/database-pg/drizzle/0013_motionless_white_queen.sql:138-140` — `DROP COLUMN IF EXISTS` precedent.

**Test scenarios:**
- Error path: schema tests fail if any code still references `body_embedding` (catches regression).
- Integration: migration runs cleanly on dev; section inserts and selects succeed.

**Verification:**
- Pre-flight query returns 0 against dev AND prod (not just dev).
- In-migration transaction guard passes (no `RAISE EXCEPTION` fired).
- Migration applied to dev without error; one full compile cycle runs post-migration without `column "body_embedding" does not exist` errors in CloudWatch.
- Only after dev confirmation, apply to prod with the same pre-flight + transaction guard.
- Grep for `body_embedding` and `bodyEmbedding` in `packages/api/src` and `packages/graphql/src` returns zero hits.
- Full api test suite passes.

## System-Wide Impact

- **Interaction graph:** None of the deleted paths have runtime callers outside the wiki module. No middleware, no observers.
- **Error propagation:** No validator behavior changes in this plan (Unit 3 was the one that would have; dropped). All error semantics preserved. Unit 3 (new scope) adds an in-transaction step to `wipeWikiScope` — if it throws, the entire wipe rolls back, which is the existing behavior.
- **State lifecycle risks:** Units 4 and 5 drop schema columns. Pre-flight verification (both columns always NULL) + in-migration transaction guard are hard preconditions.
- **API surface parity:** No public API changes. `runLinkBackfill` export stays (Unit 4 inline dropped).
- **Integration coverage:** The full api suite exercises the cross-layer paths; no new integration tests needed. Unit 3 may add one new test for the `wipeWikiScope` FK-unblock path.
- **Unchanged invariants:** Two-planner split, `PlannerResult` shared type (with force-clear), alias dedup behavior, deterministic linker behavior, `applyAggregationPlan` structure, `computeLinkNeighborhoods` N-query loop, `link-backfill.ts` module, and every live metric with a consumer. This plan explicitly does not touch any of them.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Schema migration applied to prod before `main` is verified | Land Units 4 + 5 only after Units 1–3 have been on `main` for at least one full compile cycle on dev. Run pre-flight SQL per environment. |
| A hidden consumer of a "deleted" field exists that grep missed | Simplicity reviewer's claims were independently spot-checked this session (cluster, body_embedding, emptyAggregationResult, outboundSlugs, placeholder, tag_cluster — all confirmed unused). If a consumer surfaces during CI, treat that as a signal that the reviewer's claim was wrong, revert, and re-verify before re-proposing. |
| Unit 3's `wipeWikiScope` change accidentally cascade-deletes rows outside scope | Run in the existing wipe transaction; only touch `wiki_unresolved_mentions` rows whose `owner_id` matches the wipe target. Explicitly test this in the unit test. |
| Drizzle migration generation drift vs. hand-written `.sql` | Always run `pnpm --filter @thinkwork/database-pg db:generate` and commit the generated snapshot alongside the schema change. Do not hand-edit the `meta/*.json` files. |
| Metric pruning deferred | Not applicable in this plan — metric pruning beyond confirmed-unused fields is deferred entirely. |

## Documentation / Operational Notes

- **Commit messages**: `refactor(wiki): <what>` per unit. Each commit should cite the adversarial-review finding it closes so future archaeology shows the motivation.
- **PR description**: include a table of deletions + LOC saved, and link to this plan. Include a "How I verified each deletion is safe" section with the grep queries used.
- **Rollout**: no feature flags; these are deletions. The schema migrations (Units 4–5) need dev + prod application in sequence. Dev first, verify one compile cycle, then prod.
- **Monitoring**: after the schema migrations land, confirm no `ERROR: column "cluster" does not exist` or `ERROR: column "body_embedding" does not exist` in CloudWatch logs from stragglers. If any, the offending caller was missed — revert the migration (add the column back) and fix the caller.

## Sources & References

- **Handoff being superseded (its proposals killed)**: `plans/2026-04-20-008-handoff-cluster-enrichment-and-applier-split.md` (committed on main in #321). This plan replaces its recommendations; the handoff's cluster enrichment, applier split, and `wipeWikiScope` FK fix are treated as: cluster enrichment KILLED and superseded by Place capability, applier split KILLED, `wipeWikiScope` FK fix INCORPORATED as Unit 3 of this plan.
- **Successor brainstorm** (the productive replacement for the killed cluster-enrichment work): `docs/brainstorms/2026-04-21-wiki-place-capability-requirements.md` — grounded in measured evidence (85.9% place_google_place_id coverage on GiGi), uses structured journal-sourced data instead of LLM re-derivation.
- **Parent plan the deletions support**: `plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md` (status table at top is partially stale — `Unit 3b/3c/9/10` shipped in #294 after the refresh).
- **Related shipped PRs**: #285, #288, #294, #309, #311, #312, #318, #320.
- **Adversarial reviews** (this session, 2026-04-20 + plan-doc review 2026-04-21): simplicity + architecture + coherence + feasibility + product-lens + scope-guardian + adversarial-document. Scope narrowed from 7 units to 5 based on the plan-doc review findings. Full transcripts in session history.
