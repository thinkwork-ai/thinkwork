---
date: 2026-05-16
topic: wiki-brain-schema-extraction
---

# Wiki + Brain Schema Extraction

## Summary

Extract the wiki and brain (entity-pages) feature clusters out of `public.*` into two dedicated Postgres schemas — `wiki.*` and `brain.*` — consolidating table names, code modules, and resolver layout within each cluster as part of the move. Shipped as two sequential PRs that follow the hand-rolled migration pattern established by the `compliance` schema, plus a thin pattern doc that turns the work into a reusable template for future schema-extract candidates.

---

## Problem Frame

The `packages/database-pg/src/schema/` directory now holds ~55 files in a flat layout, and two of the largest files — `wiki.ts` (22.8 KB, 9 tables) and `tenant-entity-pages.ts` (8.9 KB, 5 tables) — define structurally similar features (pages, sections, links, aliases) that both live in `public.*`. The naming has accumulated redundancy: `public.wiki_pages` and `public.tenant_entity_pages` both repeat their domain prefix because they share a namespace. Consumer code mirrors the same flatness: `packages/api/src/lib/wiki/*`, `packages/api/src/lib/brain/*`, `packages/api/src/graphql/resolvers/wiki/*`, and wiki-related pieces inside `packages/api/src/graphql/resolvers/memory/*` are visually adjacent to every other concern.

The `compliance` schema (migration `0069_compliance_schema.sql`, 2026-05-06) already proved that Postgres-schema separation is viable in this codebase: `pgSchema("compliance")` in Drizzle source, hand-rolled SQL with `-- creates:` markers, drift gate enforced via `pnpm db:migrate-manual`. That migration was greenfield. What hasn't been done yet is the same pattern applied to *live, populated tables* with non-trivial consumer surface — and wiki + brain are the most obvious candidates to prove the pattern out and absorb the highest density of "schema noise" in one motion.

The cost of leaving this alone is structural: every new feature lands its tables alongside wiki and brain in `public.*`, and each round of "what does this codebase even look like?" reading pays a tax for two large feature clusters that have nothing to do with the rest of the schema.

---

## Key Flows

- F1. Schema-extract per cluster (applied independently to wiki, then brain)
  - **Trigger:** Engineer authors a hand-rolled SQL migration for the cluster (creates schema, moves tables, renames tables, drops redundant prefixes), and updates Drizzle source to `pgSchema("<name>")`.
  - **Actors:** Engineer (operator role)
  - **Steps:**
    1. Author migration with `-- creates: <schema>.<table>` markers for every table moved/renamed.
    2. Apply migration to dev via `psql -f`.
    3. Update Drizzle source (`packages/database-pg/src/schema/*`) to declare the schema and rename table identifiers.
    4. Audit and update every consumer surface (Drizzle queries, raw SQL in `lib/*` and `scripts/*`, Lambda handlers, mobile SDK queries) to use the new identifiers.
    5. Regenerate codegen in every consumer that has a `codegen` script.
    6. Apply migration to prod via `psql -f` before merge.
    7. Open PR; CI runs against schema-aware code; merge triggers deploy; drift gate validates that all `-- creates:` markers exist in the target DB.
  - **Outcome:** All tables for the cluster live in the new schema, internal naming has the redundant prefixes dropped, and every consumer queries the new fully-qualified names. The `public.*` namespace loses the cluster entirely (no shim views left behind).
  - **Covered by:** R1, R2, R3, R6, R7, R10

---

## Requirements

**Wiki schema move**
- R1. All 9 wiki tables move from `public.*` to `wiki.*` in a single hand-rolled migration, with the `wiki_` table-name prefix dropped during the move: `wiki.pages`, `wiki.page_sections`, `wiki.page_links`, `wiki.page_aliases`, `wiki.unresolved_mentions`, `wiki.section_sources`, `wiki.compile_jobs`, `wiki.compile_cursors`, `wiki.places`.
- R2. `packages/database-pg/src/schema/wiki.ts` declares `pgSchema("wiki")` and re-exports the renamed tables; consumer imports continue to work without explicit schema-aware import changes beyond the table-name updates that the rename forces.
- R3. Wiki resolver pieces currently colocated in `packages/api/src/graphql/resolvers/memory/*` that are functionally part of the wiki feature (e.g., `mobileWikiSearch.query.ts`, `recentWikiPages.query.ts`) relocate to `packages/api/src/graphql/resolvers/wiki/*` as part of the wiki PR.
- R4. The wiki PR audits and updates every consumer in this list (verified during planning, not exhaustive here): GraphQL resolvers under `resolvers/wiki/*` and `resolvers/memory/*`, library code under `packages/api/src/lib/wiki/*`, maintenance scripts under `packages/api/scripts/wiki-*.ts`, the `wiki-compile` Lambda, the `wiki-bootstrap-import` Lambda, and any wiki-related test files.

**Brain schema move**
- R5. All 6 brain tables (5 from `tenant-entity-pages.ts` + 1 from `tenant-entity-external-refs.ts`) move from `public.*` to `brain.*` in a single hand-rolled migration, with the `tenant_entity_` prefix dropped during the move: `brain.pages`, `brain.page_sections`, `brain.page_links`, `brain.page_aliases`, `brain.section_sources`, `brain.external_refs`.
- R6. `packages/database-pg/src/schema/tenant-entity-pages.ts` and `tenant-entity-external-refs.ts` consolidate into `packages/database-pg/src/schema/brain.ts` declaring `pgSchema("brain")`.
- R7. The brain PR audits and updates every consumer: library code under `packages/api/src/lib/brain/*`, the mobile SDK file `packages/react-native-sdk/src/brain.ts` (queries update internally; public API name does not change), any `tenant_entity_*` references in resolvers or scripts, and brain-related test files.
- R8. `lib/wiki/` and `lib/brain/` remain distinct module trees; nothing folds across the feature boundary.

**Migration mechanics (shared across both PRs)**
- R9. Each migration uses the hand-rolled SQL pattern (not Drizzle-generated): `CREATE SCHEMA IF NOT EXISTS <name>`, `ALTER TABLE public.<old> SET SCHEMA <name>`, `ALTER TABLE <name>.<old> RENAME TO <new>`, all wrapped in a transaction with `lock_timeout` / `statement_timeout` set defensively (mirroring `0069_compliance_schema.sql`).
- R10. Each migration declares `-- creates: <schema>.<table>` markers for every table in its new home, plus markers for indexes, constraints, and any other objects, so the drift gate (`pnpm db:migrate-manual`) can verify post-deploy.
- R11. Each migration is applied manually to dev and prod via `psql -f` before its PR merges; the PR itself contains the SQL file plus all consumer-code changes.
- R12. No compatibility views in `public.*` are created during transition — the move is atomic per PR, and the dev/prod migration apply happens before the PR merge so no deploy window queries the old names.

**Pattern doc**
- R13. PR 1 (wiki) lands a thin reusable pattern doc at `docs/solutions/database-issues/feature-schema-extraction-pattern.md` (exact filename to confirm in planning) covering: when a feature earns its own Postgres schema, the migration template, the `-- creates:` marker conventions, the Drizzle `pgSchema(...)` wiring, the deploy-order rule (psql before merge), and a consumer-audit checklist.
- R14. The pattern doc enumerates the next obvious schema-extract candidates as a non-binding "future applicants" list (e.g., routines, sandbox, evals, agents) so future sessions have a starting target list without being bound to it.

**PR sequencing and review surface**
- R15. The wiki PR (PR 1) ships first and lands the pattern doc; the brain PR (PR 2) ships second and references the pattern doc rather than re-deriving it.
- R16. Each PR is independently revertible: the migration and code changes for one cluster do not depend on the other cluster's migration having shipped.

---

## Acceptance Examples

- AE1. **Covers R1, R10, R11.** Given the wiki PR's migration `NNNN_wiki_schema_extraction.sql` declares `-- creates: wiki.pages` and 14 other markers, when the operator applies the migration to dev and prod via `psql -f` and then merges the PR, the deploy's `pnpm db:migrate-manual` drift-gate step passes and reports all 15 markers present in the target database.
- AE2. **Covers R10, R12.** Given a hypothetical wiki PR migration is *missing* one `-- creates:` marker for a table it actually moved, when the PR merges and the deploy's drift gate runs, the deploy fails with a report identifying the missing object — preventing the merge from completing silently.
- AE3. **Covers R3, R4.** Given the wiki PR relocates `resolvers/memory/mobileWikiSearch.query.ts` to `resolvers/wiki/mobileWikiSearch.query.ts` and updates the table references inside it to `wiki.pages`, when the mobile app issues a `mobileWikiSearch` query post-deploy, the resolver returns results identical in shape and content to pre-PR.
- AE4. **Covers R7.** Given the brain PR updates `packages/react-native-sdk/src/brain.ts` to query `brain.pages` internally, when a mobile client calls the SDK's `brain.enrich(...)` (or equivalent existing public API), the function signature, return type, and behavior are unchanged from pre-PR.

---

## Success Criteria

- A developer reading `packages/database-pg/src/schema/` can identify "wiki" and "brain" as cohesive feature clusters at a glance: each lives in one file declaring its own `pgSchema(...)`, instead of fifteen tables scattered across the flat `public.*` listing.
- A Postgres operator running `\dn` sees `wiki` and `brain` as named schemas alongside `compliance`; running `\dt wiki.*` and `\dt brain.*` returns coherent table lists with no `wiki_` or `tenant_entity_` prefixes inside.
- No deploy-time drift-gate failure or runtime "relation does not exist" error occurs across either PR's deploy. Mobile clients and admin SPA experience no behavioral change.
- The pattern doc at `docs/solutions/database-issues/...` is referenced by the brain PR's description; a future schema-extract session can read the doc and reach `psql -f` without having to grep prior PR diffs.

---

## Scope Boundaries

- Other schema-extract candidates (routines, sandbox, evaluations, agents, mcp, webhooks, etc.) — the pattern doc names them as future applicants, but this brainstorm scopes only the wiki and brain moves. Each future cluster gets its own brainstorm or direct planning when its turn comes.
- Compliance-style role/permission isolation per schema (`wiki_writer`, `wiki_reader`, etc.) — out of scope. This move is purely about noise reduction and namespace clarity; access hardening is a separate problem with separate trade-offs.
- Code-side-only solution (e.g., reorganize `packages/database-pg/src/schema/` into subdirectories while leaving all tables in `public.*`) — considered and rejected. Postgres-level schemas matter for operators reading the live database via psql, dashboards, or backups; directory-level grouping would only help code readers.
- Functional changes to either feature (new fields, new queries, new behaviors) — explicit non-goal. "Keep features and functionality" is the user's framing.
- Mobile SDK public-API rename (e.g., `brain.ts` → `wiki.ts` or merged surface) — out of scope; only internal table references update.
- GraphQL type renames in `packages/database-pg/graphql/types/*.graphql` — out of scope. Those are API contracts; only their resolver internals change.
- Compatibility shims (views in `public.*` mirroring the new locations) — explicitly rejected; the atomic-per-PR pattern doesn't need them, and they would add carrying cost.

---

## Key Decisions

- **Two schemas, not one.** Wiki and brain stay peer schemas despite their structural similarity, because the libs (`lib/wiki/` vs `lib/brain/`) and the mobile SDK (`brain.ts` as a distinct public-API surface) already frame them as distinct features. Folding them into a single schema would create a worse boundary if brain v1 (or whatever the next iteration of entity enrichment looks like) diverges.
- **Full consolidation within each schema, pure relocation between.** Inside each cluster we rename tables to drop redundant prefixes and relocate misplaced resolver pieces; across clusters we do not move code modules. Accepts a larger per-PR blast radius for a cleaner end-state inside each namespace.
- **Atomic per PR, no compat views.** Each PR's migration is applied to dev and prod via `psql -f` *before* the PR merges, so there is no deploy window where Lambda code queries a name the database no longer has. Eliminates the carrying cost of a transitional shim layer.
- **Sequential PRs, wiki first.** The wiki cluster is larger (9 tables vs 6) and exercises the pattern more fully; landing it first lets the pattern doc be authored against real ground truth, and the brain PR consumes the doc as a real reader.
- **Pattern doc lands with PR 1, not deferred.** A future schema-extract session would otherwise re-derive the migration template, deploy-order rule, and consumer-audit checklist from PR diffs. One thin doc captures it while the context is fresh.

---

## Dependencies / Assumptions

- The `compliance` schema's migration `0069_compliance_schema.sql` is the working precedent for hand-rolled schema-creating migrations in this codebase, including the `-- creates:` marker format, the transactional wrapper, and the operator-targeted `psql -f` apply step. Both PRs structurally mirror it.
- Postgres preserves foreign-key constraints, indexes, and triggers automatically across `ALTER TABLE ... SET SCHEMA` and `ALTER TABLE ... RENAME TO`. Cross-schema FKs are supported. (Assumption: no current wiki or brain table has unusual constraint shapes that would block this. To verify in planning by reading the schema files in full.)
- The drift gate (`pnpm db:migrate-manual`, wired into `deploy.yml` per the manually-applied-migrations memory) runs on every deploy and fails the deploy if any `-- creates:` marker's target object is missing in the deployed database.
- Drizzle's `pgSchema("name").table(...)` declarations produce fully-qualified table references in generated SQL, so query generation transparently uses the new schema once source files declare it.
- No external system (data warehouse export, BI tool, ad-hoc dashboard) queries `public.wiki_*` or `public.tenant_entity_*` directly. (Assumption: to be verified in planning; if any exist, they need their own update plan or this assumption needs to be downgraded into a Resolve-Before-Planning question.)

---

## Outstanding Questions

### Resolve Before Planning

*(None — the brainstorm has converged on scope, naming, and migration pattern.)*

### Deferred to Planning

- [Affects R5][Technical] Should `brain.pages` retain that name, or rename to `brain.entities` to match the feature's domain language? Default is `brain.pages` for structural parallel with `wiki.pages`; revisit during planning if it reads poorly when the brain code is in front of you.
- [Affects R3][Technical] Which exact files under `packages/api/src/graphql/resolvers/memory/*` are wiki-functional and need to relocate vs. genuinely memory-resolver work that stays put? Determined during the wiki PR's consumer audit.
- [Affects R13][Technical] Exact filename and location of the pattern doc — `docs/solutions/database-issues/feature-schema-extraction-pattern.md` is the proposed default, but the existing `docs/solutions/<category>/` convention may suggest a slightly different category name.
- [Affects R9, R10][Needs research] Full enumeration of indexes, constraints, triggers, and functions on wiki and brain tables, so every one gets a `-- creates:` marker. To be done by reading the current schema files and `\d <table>` output in dev.
- [Affects R4, R7][Needs research] Full consumer audit — every file that queries `wiki_*` or `tenant_entity_*` (Drizzle, sql-tagged raw SQL, psql scripts, codegen outputs). Initial scan identified ~40 files; planning should produce the exhaustive list.
